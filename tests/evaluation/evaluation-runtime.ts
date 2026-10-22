import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import initSqlJs from 'sql.js'
import { parseCSV } from '../../src/data'
import type { Dataset, Point, Mapping } from '../../src/data'
import { datasetContext } from '../../src/ai'
import { installSQL, runAggregate } from '../../src/analytics'
import { evaluatePlan } from './plan-evaluation.mjs'

const registry = JSON.parse(readFileSync(resolve('tests/evaluation/cases.json'), 'utf8'))
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

export function loadEvaluationCase(caseId: string) {
  const item = registry.cases.find((candidate: { id: string }) => candidate.id === caseId)
  if (!item?.modelEvaluation) throw new Error('Unknown or unconfigured evaluation case: ' + caseId)
  const raw = readFileSync(resolve(item.fixture))
  const provenance = JSON.parse(readFileSync(resolve(item.provenance), 'utf8'))
  const fingerprint = sha256(raw)
  if (fingerprint !== (provenance.fixtureSha256 || provenance.fixtureSHA256)) throw new Error('Fixture hash mismatch: ' + caseId)
  const dataset: Dataset = {
    ...parseCSV(raw.toString('utf8')), fingerprint, title: provenance.title || provenance.name,
    sourceUrl: provenance.sourceUrl || provenance.sourceCsv, isPublic: true, loadedAt: '2026-10-17',
  }
  if (provenance.sourceSnapshotFile || provenance.sourceResponseFile) {
    const sourcePath = resolve(item.provenance, '..', provenance.sourceSnapshotFile || provenance.sourceResponseFile)
    if (sha256(readFileSync(sourcePath)) !== (provenance.sourceSnapshotSha256 || provenance.sourceResponseSha256)) throw new Error('Source snapshot hash mismatch: ' + caseId)
  }
  const expectations = item.modelEvaluation.targets.map((target: { id: string; x: string; metric: string; equals?: Record<string, string>; values: Record<string, number> }) => {
    const points: Point[] = Object.entries(target.values).map(([label, value]) => ({
      label, value,
      rowIds: dataset.rows.flatMap((row, index) => row[target.x] === label && Object.entries(target.equals || {}).every(([key, expected]) => row[key] === expected) ? [index + 2] : []),
    }))
    if (points.some(point => !point.rowIds.length)) throw new Error('Gold source row is missing: ' + target.id)
    return { id: target.id, x: target.x, metric: target.metric, points }
  })
  return { caseId, dataset, expectations, modelEvaluation: item.modelEvaluation, request: {
    question: item.modelEvaluation.question,
    context: item.modelEvaluation.context,
    includeSamples: true, includeCategories: true,
    dataset: datasetContext(dataset, true, true),
  } }
}

export async function evaluateCapturedPlan(payload: unknown, caseId: string) {
  const fixture = loadEvaluationCase(caseId)
  const SQL = await initSqlJs({ locateFile: file => resolve('node_modules/sql.js/dist', file) })
  const database = new SQL.Database()
  try {
    installSQL(database, fixture.dataset)
    return evaluatePlan(payload, {
      ...fixture, reviewRubric: fixture.modelEvaluation.humanReview,
      execute: (task: { id: string; title: string; mapping: Mapping }) => runAggregate(database, fixture.dataset, task.mapping, task.title, 1),
    })
  } finally {
    database.close()
  }
}

export const evaluationCaseIds = registry.cases.filter((item: { modelEvaluation?: unknown }) => item.modelEvaluation).map((item: { id: string }) => item.id)
