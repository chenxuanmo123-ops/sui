import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs from 'sql.js'
import type { SqlJsStatic } from 'sql.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCSV } from '../src/data'
import type { Dataset } from '../src/data'
import type { HistoryTurn, PlanResponse, Task } from '../src/ai'
import { installSQL, runAggregate, runExplore } from '../src/analytics'
import { appendHistory, buildHistoryTurn, executePlan, evidenceFacts, inspectPlanFilters, datasetContext, mergeRepairPlan, mergeExecution, HISTORY_LIMITS } from '../src/ai'

// Only replace the browser Worker boundary. Every task runs real SQLite over the SEC fixture.
const worker = vi.hoisted(() => ({ aggregateDataset: vi.fn(), exploreDataset: vi.fn() }))
vi.mock('../src/engine', () => worker)
const raw = readFileSync(resolve('tests/fixtures/evaluation/financial/apple-sec-company-facts-fy2021-2023.csv'), 'utf8')
const provenance = JSON.parse(readFileSync(resolve('tests/fixtures/evaluation/financial/provenance.json'), 'utf8'))
const dataset: Dataset = {
  ...parseCSV(raw), title: 'SEC Apple 年度披露事实', sourceUrl: provenance.sourceUrl,
  loadedAt: '2026-10-17', fingerprint: createHash('sha256').update(raw).digest('hex'), isPublic: true,
}
function task(id: string, title: string, value: string): Task {
  return { id, title, rationale: '按披露期间查看该指标，不跨期累加余额', chart: 'bar', mapping: {
    x: 'period_label', metric: 'value', filter: 'metric', value,
    from: '', to: '', unit: 'USD', aggregate: 'sum', timeBucket: 'none', conditions: [],
  } }
}
function response(tasks = [task('revenue', '年度收入', 'revenues'), task('cash', '期末现金', 'cash_and_cash_equivalents')]): PlanResponse {
  return {
    datasetHash: dataset.fingerprint, model: 'explicit-test-plan', providerName: '测试计划（非模型评测）', generatedAt: '2026-10-17T00:00:00.000Z',
    plan: { goal: '查看年度财务指标', scene: 'SEC 披露事实', grain: '每行一个披露期间的一个指标', fieldRoles: [], assumptions: [], questions: [], limitations: ['描述性结果'], tasks },
  }
}
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: file => resolve('node_modules/sql.js/dist', file) })
  expect(dataset.fingerprint).toBe(provenance.fixtureSha256)
})
beforeEach(() => {
  worker.aggregateDataset.mockReset()
  worker.aggregateDataset.mockImplementation(async (data, mapping, question, id) => {
    const database = new SQL.Database()
    try { installSQL(database, data); return runAggregate(database, data, mapping, question, id) }
    finally { database.close() }
  })
  // The scatter path runs the same read-only SQLite engine through runExplore.
  worker.exploreDataset.mockReset()
  worker.exploreDataset.mockImplementation(async (data, spec) => {
    const database = new SQL.Database()
    try { installSQL(database, data); return runExplore(database, data, spec) }
    finally { database.close() }
  })
})

describe('计划任务隔离与证据绑定（真实 SEC 数据和 SQLite，非模型质量分数）', () => {
  it('计算前本地提示不存在的筛选值，不改写计划，也不调用计算引擎', () => {
    const plan = response()
    const original = JSON.stringify(plan)
    expect(inspectPlanFilters(dataset, plan.plan)).toEqual([{
      taskId: 'revenue', title: '年度收入', message: expect.stringContaining('metric = "revenues"'),
    }])
    expect(JSON.stringify(plan)).toBe(original)
    expect(worker.aggregateDataset).not.toHaveBeenCalled()
  })

  it('等值条件单独存在但组合无记录时提示，现金原口径仍不受影响', () => {
    const invalid = task('invalid', '不存在的现金期间组合', 'cash_and_cash_equivalents')
    invalid.mapping.conditions = [{ field: 'period_label', operator: 'eq', value: 'FY2021' }]
    const warnings = inspectPlanFilters(dataset, response([invalid, task('cash', '期末现金', 'cash_and_cash_equivalents')]).plan)
    expect(warnings).toEqual([{ taskId: 'invalid', title: invalid.title, message: expect.stringContaining('组合当前没有匹配') }])
  })

  it('条件值检查保持精确匹配，范围与日期检查留给 SQL', () => {
    const wrongCase = task('case', '大小写不同', 'Revenue')
    const condition = task('condition', '额外条件错误', 'cash_and_cash_equivalents')
    condition.mapping.conditions = [{ field: 'period_label', operator: 'eq', value: 'FY2099' }]
    const range = task('range', '越界范围不被误标为等值错误', 'revenue')
    range.mapping.from = 'FY2099'
    expect(inspectPlanFilters(dataset, response([wrongCase, condition, range]).plan).map(warning => warning.taskId)).toEqual(['case', 'condition'])
  })

  it('首任务无匹配时保留后续现金结果、独立 ID、SQL 和来源行', async () => {
    const execution = await executePlan(dataset, response(), '查看年度财务指标', 10)
    expect(execution.results).toHaveLength(1)
    const cash = execution.results[0]
    expect(cash.ai).toMatchObject({ taskId: 'cash', taskTitle: '期末现金' })
    expect(cash.id).toBe(11)
    expect(cash.points).toEqual([
      { label: 'FY2022', value: 23646000000, rowIds: [4], scopeRowIds: [4] },
      { label: 'FY2023', value: 29965000000, rowIds: [5], scopeRowIds: [5] },
    ])
    expect(cash.sql).toContain('SUM(strict_number')
    expect(cash.parameters).toContain('cash_and_cash_equivalents')
    expect(execution.failures).toEqual([{ taskId: 'revenue', title: '年度收入', error: expect.any(String) }])
    expect(execution.failures[0].error).not.toBe('')
    expect(worker.aggregateDataset).toHaveBeenCalledTimes(2)
  })

  it('后续任务失败也不丢失前面的成功结果', async () => {
    const tasks = [task('cash', '期末现金', 'cash_and_cash_equivalents'), task('revenue', '年度收入', 'revenues')]
    const execution = await executePlan(dataset, response(tasks), '查看年度财务指标', 20)
    expect(execution.results.map(result => [result.id, result.ai?.taskId])).toEqual([[20, 'cash']])
    expect(execution.failures.map(failure => failure.taskId)).toEqual(['revenue'])
  })

  it('全部失败时保留结构化错误供修正，不生成成功结果或证据', async () => {
    const execution = await executePlan(dataset, response([task('bad', '收入值拼写错误', 'revenues')]), '', 1)
    expect(execution.results).toEqual([])
    expect(execution.failures).toEqual([{ taskId: 'bad', title: '收入值拼写错误', error: expect.stringContaining('没有有效数值') }])
    expect(evidenceFacts(response().plan, execution.results)).toEqual([])
  })

  it('快照不符或计划 ID 重复时，在任何 SQL 执行前拒绝', async () => {
    await expect(executePlan(dataset, { ...response(), datasetHash: 'stale-hash' }, '', 1)).rejects.toThrow('数据已变化')
    await expect(executePlan(dataset, response([task('cash', '期末现金', 'cash_and_cash_equivalents'), task('cash', '重复任务', 'revenue')]), '', 1)).rejects.toThrow('标识缺失或重复')
    expect(worker.aggregateDataset).not.toHaveBeenCalled()
  })

  it('部分成功后的事实只引用现金任务及其真实结果，不错绑失败的收入任务', async () => {
    const plan = response()
    const execution = await executePlan(dataset, plan, '', 10)
    const facts = evidenceFacts(plan.plan, execution.results)
    expect(facts.map(fact => [fact.id, fact.taskId, fact.analysisId, fact.label])).toEqual([
      ['cash:fact0', 'cash', 11, 'FY2022'], ['cash:fact1', 'cash', 11, 'FY2023'],
    ])
    expect(facts.every(fact => fact.text.startsWith('期末现金；'))).toBe(true)
    expect(facts.every(fact => fact.text.includes('数据快照=' + dataset.fingerprint))).toBe(true)
    expect(facts[0].text).toContain('23,646,000,000')
    expect(facts[1].text).toContain('29,965,000,000')
  })

  it('结果顺序变化时按任务 ID 保持证据绑定', async () => {
    const plan = response([task('revenue', '年度收入', 'revenue'), task('cash', '期末现金', 'cash_and_cash_equivalents')])
    const execution = await executePlan(dataset, plan, '', 10)
    const facts = evidenceFacts(plan.plan, [...execution.results].reverse())
    expect(facts[0]).toMatchObject({ taskId: 'cash', analysisId: 11 })
    expect(facts.at(-1)).toMatchObject({ taskId: 'revenue', analysisId: 10 })
  })

  it('拒绝缺失、未知或重复的任务证据绑定，禁止数组下标兜底', async () => {
    const plan = response()
    const { results: [cash] } = await executePlan(dataset, plan, '', 10)
    expect(() => evidenceFacts(plan.plan, [{ ...cash, ai: undefined }])).toThrow('缺少唯一')
    expect(() => evidenceFacts(plan.plan, [{ ...cash, ai: { ...cash.ai!, taskId: 'unknown' } }])).toThrow('缺少唯一')
    expect(() => evidenceFacts(plan.plan, [cash, cash])).toThrow('缺少唯一')
    expect(() => evidenceFacts({ ...plan.plan, tasks: [...plan.plan.tasks, plan.plan.tasks[0]] }, [cash])).toThrow('重复任务')
    expect(() => evidenceFacts(plan.plan, [{ ...cash, points: [] }])).toThrow('计算结果为空')
  })
})

describe('任务进度与中止恢复（真实 SEC 数据）', () => {
 it('每个任务报告独立运行及结束状态，失败不阻塞下一任务', async () => {
  const progress: string[] = []
  await executePlan(dataset, response(), '', 10, { onProgress: event => progress.push(event.taskId + ':' + event.status) })
  expect(progress).toEqual(['revenue:running', 'revenue:failed', 'cash:running', 'cash:completed'])
 })
 it('开始前中止不启动计算、不生成空结果或失败结论', async () => {
  const controller = new AbortController(); controller.abort()
  const execution = await executePlan(dataset, response(), '', 10, { signal: controller.signal })
  expect(execution).toEqual({ results: [], explores: [], failures: [], cancelled: true, pendingTaskIds: ['revenue', 'cash'] })
  expect(worker.aggregateDataset).not.toHaveBeenCalled()
 })
 it('完成现金后停止仅保留真实现金证据，继续时不重算成功任务', async () => {
  const original = response([task('cash', '期末现金', 'cash_and_cash_equivalents'), task('revenue', '年度收入', 'revenue')])
  const controller = new AbortController()
  const first = await executePlan(dataset, original, '', 10, { signal: controller.signal, onProgress: event => { if (event.status === 'completed') controller.abort() } })
  expect(first.cancelled).toBe(true); expect(first.pendingTaskIds).toEqual(['revenue']); expect(first.failures).toEqual([])
  expect(first.results[0].points.map(point => point.value)).toEqual([23646000000, 29965000000])
  expect(first.results[0].points.flatMap(point => point.rowIds)).toEqual([4, 5])
  const next = await executePlan(dataset, { ...original, plan: { ...original.plan, tasks: [original.plan.tasks[1]] } }, '', 11)
  const combined = mergeExecution(first.results, next, original)
  expect(worker.aggregateDataset).toHaveBeenCalledTimes(2)
  expect(combined.map(result => [result.id, result.ai?.taskId])).toEqual([[10, 'cash'], [11, 'revenue']])
  expect(evidenceFacts(original.plan, combined).some(fact => fact.taskId === 'revenue')).toBe(true)
 })
 it('正在执行的任务收到中止信号时，不把中止当作计算失败', async () => {
  const controller = new AbortController()
  worker.aggregateDataset.mockImplementationOnce((_d, _m, _q, _id, _scope, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('stop', 'AbortError')), { once: true })))
  const running = executePlan(dataset, response(), '', 10, { signal: controller.signal })
  controller.abort()
  const stopped = await running
  expect(stopped.results).toEqual([]); expect(stopped.failures).toEqual([]); expect(stopped.pendingTaskIds).toEqual(['revenue', 'cash'])
  expect(worker.aggregateDataset).toHaveBeenCalledTimes(1)
 })
})
describe('类别字典授权与失败修正（真实 SEC 数据）', () => {
  it('默认不传样本或类别值；类别字典可单独授权且保留精确原值', () => {
    const plain = datasetContext(dataset, false)
    expect(plain.columns.every(column => !('examples' in column) && !('categoryValues' in column))).toBe(true)
    const dictionary = datasetContext(dataset, false, true)
    const metric = dictionary.columns.find(column => column.field === 'metric')!
    expect(metric.categoryValuesComplete).toBe(true)
    expect(metric.categoryValues).toEqual([...new Set(dataset.rows.map(row => row.metric).filter(Boolean))])
    expect(metric.categoryValues).toContain('revenue')
    expect(metric.categoryValues).not.toContain('revenues')
    expect(dictionary.columns.every(column => !('examples' in column))).toBe(true)
    expect(dictionary.columns.find(column => column.field === 'value')?.categoryValues).toBeUndefined()
    const sampleOnly = datasetContext(dataset, true)
    expect(sampleOnly.columns.every(column => !('categoryValues' in column))).toBe(true)
  })
  it('只把用户纠正过的字段角色作为 confirmedRole 发送，未纠正列保持类型候选', () => {
    const confirmed = datasetContext(dataset, false, false, { metric: 'category', value: 'measure' })
    const metric = confirmed.columns.find(column => column.field === 'metric')!
    expect(metric.confirmedRole).toBe('category')
    expect(metric.typeCandidate).toBeDefined()
    expect(confirmed.columns.filter(column => column.field !== 'metric' && column.field !== 'value').every(column => !('confirmedRole' in column))).toBe(true)
    expect(datasetContext(dataset, false).columns.every(column => !('confirmedRole' in column))).toBe(true)
    expect(datasetContext(dataset, true, true, { metric: 'category' }).columns.find(column => column.field === 'metric')?.confirmedRole).toBe('category')
  })
  it('超出长度或基数的列整体省略，不能把截断列表标成完整字典', () => {
    const long = { ...dataset, rows: dataset.rows.map((row, i) => ({ ...row, metric: i ? row.metric : 'x'.repeat(121) })) }
    expect(datasetContext(long, false, true).columns.find(column => column.field === 'metric')?.categoryValues).toBeUndefined()
    const many = { ...dataset, rows: Array.from({ length: 17 }, (_, i) => ({ ...dataset.rows[i % dataset.rows.length], metric: 'unit-test-only-' + i })) }
    expect(datasetContext(many, false, true).columns.find(column => column.field === 'metric')?.categoryValues).toBeUndefined()
  })
  it('只替换失败任务，保留成功口径和原问题，拒绝快照或 ID 错绑', () => {
    const original = response()
    const failure = [{ taskId: 'revenue', title: '年度收入', error: '没有有效数值' }]
    const fixed = response([task('revenue', '年度收入', 'revenue')])
    const merged = mergeRepairPlan(original, fixed, failure)
    expect(merged.plan.tasks[1]).toBe(original.plan.tasks[1])
    expect(merged.plan.goal).toBe(original.plan.goal)
    expect(merged.plan.tasks[0].mapping.value).toBe('revenue')
    expect(original.plan.tasks[0].mapping.value).toBe('revenues')
    expect(() => mergeRepairPlan(original, { ...fixed, datasetHash: 'b'.repeat(64) }, failure)).toThrow('快照')
    expect(() => mergeRepairPlan(original, response([task('cash', '错误替换成功任务', 'revenue')]), failure)).toThrow('失败任务')
    expect(() => mergeRepairPlan(original, response([]), failure)).toThrow('失败任务')
    expect(() => mergeRepairPlan(original, fixed, [...failure, ...failure])).toThrow('失败任务')
  })
  it('修正后只重算失败收入，现金成功结果复用，合并证据仍逐任务绑定', async () => {
    const original = response()
    const first = await executePlan(dataset, original, '', 10)
    const fixed = response([task('revenue', '年度收入', 'revenue')])
    const mergedPlan = mergeRepairPlan(original, fixed, first.failures)
    const second = await executePlan(dataset, fixed, '', 12)
    const combined = mergeExecution(first.results, second, mergedPlan)
    expect(worker.aggregateDataset).toHaveBeenCalledTimes(3)
    expect(combined.map(result => [result.id, result.ai?.taskId])).toEqual([[11, 'cash'], [12, 'revenue']])
    expect(combined[1].points.map(point => point.value)).toEqual([365817000000, 394328000000, 383285000000])
    const facts = evidenceFacts(mergedPlan.plan, combined)
    expect(facts.filter(fact => fact.taskId === 'cash').every(fact => fact.analysisId === 11)).toBe(true)
    expect(facts.filter(fact => fact.taskId === 'revenue').every(fact => fact.analysisId === 12)).toBe(true)
    expect(() => mergeExecution(first.results, { results: first.results, failures: [] }, mergedPlan)).toThrow('绑定不符')
    expect(() => mergeExecution([], { results: [{ ...second.results[0], datasetHash: 'b'.repeat(64) }], failures: [] }, mergedPlan)).toThrow('绑定不符')
    expect(() => mergeExecution([], second, original)).toThrow('绑定不符')
  })
})

// The scatter path is exercised against the published copy of the UCI day.csv,
// so the expected Pearson r matches the documented real-data demo.
const bikeRaw = readFileSync(resolve('docs/real-demo/day.csv'), 'utf8')
const bike: Dataset = { ...parseCSV(bikeRaw), title: 'UCI Bike Sharing day.csv', sourceUrl: 'https://archive.ics.uci.edu/dataset/275/bike+sharing+dataset', loadedAt: '2026-10-30', fingerprint: createHash('sha256').update(bikeRaw).digest('hex'), isPublic: true }
function planFor(target: Dataset, tasks: Task[]): PlanResponse {
  return { datasetHash: target.fingerprint, model: 'explicit-test-plan', providerName: '测试计划（非模型评测）', generatedAt: '2026-10-30T00:00:00.000Z', plan: { goal: '查看两个数值字段的线性同步程度', scene: '公开日数据', grain: '每行一天', fieldRoles: [], assumptions: [], questions: [], limitations: ['只描述线性同步，不是因果'], tasks } }
}
describe('散点任务（真实 CSV 与 SQLite，非模型评测）', () => {
  const scatter: Task = { id: 'relation', title: '温度与租车量的线性同步', rationale: '按全部有效配对计算，不写成因果', chart: 'scatter', scatter: { x: 'temp', y: 'cnt', filter: '', value: '' } }
  it('返回全部有效配对的 Pearson 与散点列，不进入聚合结果或证据事实', async () => {
    const execution = await executePlan(bike, planFor(bike, [scatter]), '温度和租车量是否一起变化', 30)
    expect(execution.results).toEqual([])
    expect(execution.failures).toEqual([])
    expect(execution.explores).toHaveLength(1)
    const result = execution.explores[0].result
    expect(result.spec.kind).toBe('scatter')
    expect(result.columns).toEqual(['temp', 'cnt'])
    expect(result.correlation?.n).toBe(731)
    expect(result.correlation?.r).toBeCloseTo(0.627494, 6)
    expect(result.sql).toContain('strict_number')
  })
  it('同一字段的散点任务失败并如实报告，不产生结果', async () => {
    const same: Task = { ...scatter, scatter: { x: 'temp', y: 'temp', filter: '', value: '' } }
    const execution = await executePlan(bike, planFor(bike, [same]), '', 31)
    expect(execution.explores).toEqual([])
    expect(execution.failures[0].error).toContain('两个不同的数值字段')
  })
})

describe('对话上下文（有界、截断、最多四轮）', () => {
  it('截断超长字段并只保留最近四轮', () => {
    const turn = buildHistoryTurn(
      ' 问题 '.repeat(400), '目标'.repeat(300),
      Array.from({ length: 8 }, (_, i) => '任务' + i),
      Array.from({ length: 5 }, (_, i) => ({ label: '标签' + i, text: '值'.repeat(300) })),
      '范围'.repeat(200),
    )
    expect(turn.question.length).toBe(HISTORY_LIMITS.question)
    expect(turn.goal.length).toBe(HISTORY_LIMITS.goal)
    expect(turn.tasks).toHaveLength(HISTORY_LIMITS.tasks)
    expect(turn.tasks[0].length).toBeLessThanOrEqual(HISTORY_LIMITS.task)
    expect(turn.facts).toHaveLength(HISTORY_LIMITS.facts)
    expect(turn.facts[0].text.length).toBe(HISTORY_LIMITS.factText)
    expect(turn.scopeLabel?.length).toBe(HISTORY_LIMITS.scope)
    let history: HistoryTurn[] = []
    for (let i = 0; i < 6; i++) history = appendHistory(history, buildHistoryTurn('问题' + i, '目标', ['任务'], []))
    expect(history).toHaveLength(HISTORY_LIMITS.turns)
    expect(history[0].question).toBe('问题2')
    expect(history[3].question).toBe('问题5')
  })
  it('过滤空任务标题与空计算摘要，不把空轮次伪装成上下文', () => {
    const turn = buildHistoryTurn('q', 'g', ['', '  ', 'ok'], [{ label: ' ', text: 'x' }, { label: 'a', text: ' ' }, { label: 'b', text: 'c' }])
    expect(turn.tasks).toEqual(['ok'])
    expect(turn.facts).toEqual([{ label: 'b', text: 'c' }])
    expect(turn.scopeLabel).toBeUndefined()
  })
})
