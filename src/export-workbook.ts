// Export the calculated result area as a spreadsheet. Every number here is
// copied from `result.points` / `dataset`; nothing is rounded, filled in or
// recomputed. Columns mirror ResultTable so the file and the on-screen table
// describe the same result.
import { aggregateNames, download } from './data'
import type { Analysis, Dataset, Mapping } from './data'
import { rateBaseline } from './follow-up'
import type { AnalysisBundle } from './AnalysisResults'

export type ResultExportOptions = {
  /** Reader-facing field name; defaults to the stored key. */
  fieldLabel?: (key: string) => string
  /** Reader-facing group name; defaults to the stored value. */
  valueLabel?: (field: string, value: string) => string
  dataset?: Dataset
}

type Cell = string | number | null

const field = (opts: ResultExportOptions, key: string) => opts.fieldLabel ? opts.fieldLabel(key) : key
const value = (opts: ResultExportOptions, key: string, raw: string) => opts.valueLabel ? opts.valueLabel(key, raw) : raw

const OPERATOR_TEXT: Record<NonNullable<Mapping['conditions']>[number]['operator'], string> = { eq: '=', gte: '≥', lte: '≤', empty: '为空', notEmpty: '非空' }

function conditionText(condition: NonNullable<Mapping['conditions']>[number], opts: ResultExportOptions) {
  const name = field(opts, condition.field)
  return condition.operator === 'empty' || condition.operator === 'notEmpty' ? name + ' ' + OPERATOR_TEXT[condition.operator] : name + ' ' + OPERATOR_TEXT[condition.operator] + ' ' + JSON.stringify(condition.value)
}

function rangeText(mapping: Mapping) {
  if (!mapping.from && !mapping.to) return '不限'
  return (mapping.from || '最早') + ' — ' + (mapping.to || '最晚')
}

function bucketText(mapping: Mapping) {
  return mapping.timeBucket === 'month' ? '按月' : mapping.timeBucket === 'year' ? '按年' : '保持原始分组'
}

const resultTitle = (result: Analysis) => result.ai?.taskTitle || result.question

/** Keep file and sheet names usable on Windows without touching the content. */
export function safeName(text: string, max = 40) {
  const cleaned = text.replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  return (cleaned || '分析结果').slice(0, max)
}

/** Excel sheet names: no []:*?/\, at most 31 characters, unique per workbook. */
export function sheetName(text: string, used: Set<string>) {
  const base = (text.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || '分析结果').slice(0, 31)
  let name = base, index = 2
  while (used.has(name)) {
    const suffix = ' (' + index++ + ')'
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(name)
  return name
}

/** Header row plus one row per calculated group, in calculation order. */
export function resultSheetRows(result: Analysis, opts: ResultExportOptions = {}): Cell[][] {
  const { mapping } = result
  const renamed = result.points.some(point => value(opts, mapping.x, point.label) !== point.label)
  const baseline = rateBaseline(result)
  const header: Cell[] = ['分组']
  if (renamed) header.push('原始分组值')
  header.push('结果' + (mapping.unit && !mapping.metric.includes(mapping.unit) ? '（' + mapping.unit + '）' : ''))
  if (mapping.rate) header.push('分子', '分母', '排除')
  if (baseline !== undefined) header.push('较来源分组（百分点）')
  header.push('来源记录数')
  const rows: Cell[][] = [header]
  const row = (label: string, resultCell: Cell, rate: Analysis['points'][number]['rate'], sourceCount: number) => {
    const cells: Cell[] = [value(opts, mapping.x, label)]
    if (renamed) cells.push(label)
    cells.push(resultCell)
    if (mapping.rate) cells.push(rate ? rate.numerator : null, rate ? rate.denominator : null, rate ? rate.excluded : null)
    if (baseline !== undefined) cells.push(typeof resultCell === 'number' ? resultCell - baseline : '无法计算')
    cells.push(sourceCount)
    return cells
  }
  for (const point of result.points) {
    // A zero denominator means the ratio is undefined, not 0%. The table shows
    // such groups as 无法计算; the sheet must not invent a 0 either.
    const undefinedRatio = !!point.rate && point.rate.denominator === 0
    rows.push(row(point.label, undefinedRatio ? '无法计算' : point.value, point.rate, point.rowIds.length))
  }
  for (const group of result.unavailableGroups ?? []) {
    rows.push(row(group.label, '无法计算', undefined, group.rowIds.length))
  }
  return rows
}

/** Key/value sheet that states the口径 and the snapshot the numbers came from. */
export function resultMetaRows(result: Analysis, opts: ResultExportOptions = {}, options: { header?: boolean } = {}): Cell[][] {
  const { mapping } = result
  const rows: Cell[][] = options.header === false ? [] : [['项目', '内容']]
  rows.push(
    ['分析问题', result.question],
    ['任务标题', result.ai?.taskTitle || '（手动计算）'],
    ['数据集', opts.dataset?.title ?? '（未提供数据快照）'],
    ['数据快照 SHA-256', result.datasetHash],
    ['分组字段', field(opts, mapping.x) + (field(opts, mapping.x) === mapping.x ? '' : '（' + mapping.x + '）')],
    ['指标字段', field(opts, mapping.metric)],
    ['汇总方式', aggregateNames[mapping.aggregate]],
    ['单位', mapping.unit || '单位未声明'],
    ['筛选条件', mapping.filter ? field(opts, mapping.filter) + ' = ' + value(opts, mapping.filter, mapping.value) : '不筛选'],
    ['分组范围', rangeText(mapping)],
    ['时间分桶', bucketText(mapping)],
    ['附加条件', mapping.conditions?.length ? mapping.conditions.map(c => conditionText(c, opts)).join('；') : '无'],
  )
  if (mapping.rate) {
    rows.push(
      ['分子定义', field(opts, mapping.metric) + ' = ' + JSON.stringify(mapping.rate.successValue)],
      ['分母定义', JSON.stringify(mapping.rate.eligibleValues)],
      ['比例口径', '分子记录数 ÷ 分母记录数 × 100；分母为零的分组标记为「无法计算」，不写 0%'],
    )
  }
  rows.push(
    ['有效记录数', result.usedRows],
    ['分组数', result.points.length],
    ['无法计算分组数', result.unavailableGroups?.length ?? 0],
    ['计算时间', result.createdAt],
    ['导出时间', new Date().toLocaleString('zh-CN', { hour12: false })],
    ['说明', '数值来自本地 SQLite / sql.js 计算，未经 AI 生成；空值与不可解析值按缺失处理，不按 0 计入。'],
  )
  return rows
}

/** One row per calculated task in an AI analysis bundle. */
export function bundleSummaryRows(dataset: Dataset, bundle: AnalysisBundle): Cell[][] {
  const rows: Cell[][] = [['序号', '任务标题', '分析问题', '指标', '单位', '分组数', '有效记录数', '来源记录数', '快照一致']]
  bundle.results.forEach((result, index) => {
    rows.push([
      index + 1,
      resultTitle(result),
      result.question,
      result.mapping.metric,
      result.mapping.unit || '单位未声明',
      result.points.length,
      result.usedRows,
      result.points.reduce((total, point) => total + point.rowIds.length, 0),
      result.datasetHash === dataset.fingerprint ? '是' : '否',
    ])
  })
  return rows
}

const SOURCE_ROW_LIMIT = 20000

/** Group → record ID sheet; refused above the limit with an explicit note. */
export function sourceRows(result: Analysis, opts: ResultExportOptions = {}): Cell[][] {
  const total = result.points.reduce((sum, point) => sum + point.rowIds.length, 0) + (result.unavailableGroups ?? []).reduce((sum, group) => sum + group.rowIds.length, 0)
  if (total > SOURCE_ROW_LIMIT) return [['说明'], ['来源记录共 ' + total + ' 条，超过 2 万条未导出明细；请在「检查 SQL 与来源」中按分组查看。']]
  const rows: Cell[][] = [['分组', '记录ID', '来源位置']]
  const push = (label: string, ids: number[]) => {
    for (const id of ids) rows.push([value(opts, result.mapping.x, label), id, opts.dataset?.origin?.locations[id - 2] ?? null])
  }
  for (const point of result.points) push(point.label, point.rowIds)
  for (const group of result.unavailableGroups ?? []) push(group.label, group.rowIds)
  return rows
}

function assertSnapshot(result: Analysis, dataset?: Dataset) {
  if (dataset && result.datasetHash !== dataset.fingerprint) throw new Error('结果与当前数据快照不一致，已停止导出。请重新计算后再导出。')
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function columnWidths(rows: Cell[][]) {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, index) => {
    const length = cell === null ? 0 : String(cell).length
    widths[index] = Math.max(widths[index] ?? 8, Math.min(48, length + 2))
  })
  return widths.map(wch => ({ wch }))
}

async function workbookBytes(sheets: { name: string; rows: Cell[][] }[]) {
  const XLSX = await import('xlsx')
  const book = XLSX.utils.book_new()
  const used = new Set<string>()
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows)
    worksheet['!cols'] = columnWidths(sheet.rows)
    XLSX.utils.book_append_sheet(book, worksheet, sheetName(sheet.name, used))
  }
  return XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

export async function resultWorkbookBytes(result: Analysis, opts: ResultExportOptions = {}) {
  assertSnapshot(result, opts.dataset)
  return workbookBytes([
    { name: resultTitle(result), rows: resultSheetRows(result, opts) },
    { name: '口径与来源', rows: resultMetaRows(result, opts) },
    { name: '来源记录', rows: sourceRows(result, opts) },
  ])
}

export async function bundleWorkbookBytes(dataset: Dataset, bundle: AnalysisBundle) {
  for (const result of bundle.results) assertSnapshot(result, dataset)
  const sheets = [{ name: '分析汇总', rows: bundleSummaryRows(dataset, bundle) }]
  const meta: Cell[][] = [['项目', '内容']]
  bundle.results.forEach((result, index) => {
    meta.push(['', ''], ['任务 ' + (index + 1) + '：' + resultTitle(result), ''], ...resultMetaRows(result, { dataset }, { header: false }))
  })
  for (const result of bundle.results) sheets.push({ name: resultTitle(result), rows: resultSheetRows(result, { dataset }) })
  sheets.push({ name: '口径与来源', rows: meta })
  return workbookBytes(sheets)
}

export async function exportResultWorkbook(result: Analysis, opts: ResultExportOptions = {}) {
  const bytes = await resultWorkbookBytes(result, opts)
  download(bytes, XLSX_MIME, '数鉴-' + safeName(resultTitle(result)) + '-结果.xlsx')
}

export async function exportBundleWorkbook(dataset: Dataset, bundle: AnalysisBundle) {
  const bytes = await bundleWorkbookBytes(dataset, bundle)
  download(bytes, XLSX_MIME, '数鉴-本轮分析结果.xlsx')
}

const quote = (cell: Cell) => '"' + (cell === null ? '' : String(cell)).replace(/"/g, '""') + '"'

/** Same columns as the sheet, as UTF-8 CSV with a BOM for Excel. */
export function resultCSV(result: Analysis, opts: ResultExportOptions = {}) {
  return '﻿' + resultSheetRows(result, opts).map(row => row.map(quote).join(',')).join('\r\n')
}
