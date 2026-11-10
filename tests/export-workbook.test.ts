import { beforeAll, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseCSV } from '../src/data'
import type { Dataset, Mapping } from '../src/data'
import { installSQL, runAggregate } from '../src/analytics'
import { bundleSummaryRows, bundleWorkbookBytes, resultCSV, resultMetaRows, resultSheetRows, resultWorkbookBytes, safeName, sheetName } from '../src/export-workbook'
import type { AnalysisBundle } from '../src/AnalysisResults'
let SQL: Awaited<ReturnType<typeof initSqlJs>>
const raw = readFileSync(resolve('tests/fixtures/uci-online-shoppers.csv'), 'utf8')
const data: Dataset = { ...parseCSV(raw), title: 'UCI Online Shoppers 原始公开文件', sourceUrl: 'https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset', fingerprint: createHash('sha256').update(raw).digest('hex'), loadedAt: '2026-10-19', isPublic: false }
const mapping: Mapping = { x: 'VisitorType', metric: 'Revenue', aggregate: 'count', unit: '%', filter: '', value: '', from: '', to: '', rate: { successValue: 'TRUE', eligibleValues: ['TRUE', 'FALSE'] } }
beforeAll(async () => { SQL = await initSqlJs({ locateFile: f => resolve('node_modules/sql.js/dist', f) }) })
function calculate(m: Mapping = mapping, d: Dataset = data, id = 1) {
  const db = new SQL.Database()
  try { installSQL(db, d); return runAggregate(db, d, m, '哪些访问群体转化率较高', id) } finally { db.close() }
}

it('导出表逐行等于计算结果：分组、比例、分子、分母、排除、来源记录数', () => {
  const result = calculate()
  result.ai = { goal: '真实公开数据', taskId: 'visitor', taskTitle: '访客类型转化率', model: 'test-only', plannedAt: '2026-10-19' }
  const rows = resultSheetRows(result)
  expect(rows[0]).toEqual(['分组', '结果（%）', '分子', '分母', '排除', '来源记录数'])
  expect(rows.slice(1)).toEqual(result.points.map(p => [p.label, p.value, p.rate!.numerator, p.rate!.denominator, p.rate!.excluded, p.rowIds.length]))
  // Numbers stay numeric so Excel can keep calculating on them.
  expect(typeof rows[1][1]).toBe('number')
  expect(typeof rows[1][2]).toBe('number')
})

it('分母为零的分组标记为无法计算，不写 0%', () => {
  const masked: Dataset = { ...data, rows: data.rows.map(row => row.VisitorType === 'Other' ? { ...row, Revenue: null } : row) }
  const result = calculate(mapping, masked)
  const rows = resultSheetRows(result)
  const other = rows.find(row => row[0] === 'Other')!
  expect(other[1]).toBe('无法计算')
  expect(other[2]).toBeNull()
  expect(other[3]).toBeNull()
  expect(rows.some(row => row[0] === 'Other' && row[1] === 0)).toBe(false)
})

it('显示名与原始值不同时补一列原始分组值', () => {
  const result = calculate()
  const rows = resultSheetRows(result, { valueLabel: (_field, value) => value === 'New_Visitor' ? '新访客' : value })
  expect(rows[0].slice(0, 3)).toEqual(['分组', '原始分组值', '结果（%）'])
  const renamed = rows.find(row => row[0] === '新访客')!
  expect(renamed[1]).toBe('New_Visitor')
  // No rename → no extra column.
  expect(resultSheetRows(result)[0]).not.toContain('原始分组值')
})

it('口径页写明快照、计算时间和不编造数字的说明', () => {
  const result = calculate()
  const rows = resultMetaRows(result, { dataset: data })
  const flat = rows.map(row => row[0] + '=' + row[1])
  expect(flat).toContain('数据快照 SHA-256=' + data.fingerprint)
  expect(flat).toContain('计算时间=' + result.createdAt)
  expect(flat.some(row => row.startsWith('说明=') && row.includes('未经 AI 生成') && row.includes('不按 0 计入'))).toBe(true)
  expect(flat).toContain('分母定义=["TRUE","FALSE"]')
  expect(flat).toContain('分组数=' + result.points.length)
})

it('工作表名不超过 31 字符且重名自动去重', () => {
  const used = new Set<string>()
  const long = sheetName('这是一个非常非常长的任务标题用于验证工作表名称截断行为', used)
  expect(long.length).toBeLessThanOrEqual(31)
  expect(sheetName('访客类型转化率', used)).toBe('访客类型转化率')
  expect(sheetName('访客类型转化率', used)).toBe('访客类型转化率 (2)')
  expect(safeName('a/b:c*d?e"f<g>h|i')).not.toMatch(/[\\/:*?"<>|]/)
})

it('写出的工作簿能被独立读回，单元格与导出行一致', async () => {
  const XLSX = await import('xlsx')
  const result = calculate()
  result.ai = { goal: '真实公开数据', taskId: 'visitor', taskTitle: '访客类型转化率', model: 'test-only', plannedAt: '2026-10-19' }
  const bytes = await resultWorkbookBytes(result, { dataset: data })
  const book = XLSX.read(bytes, { type: 'array' })
  expect(book.SheetNames).toEqual(['访客类型转化率', '口径与来源', '来源记录'])
  const sheet = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['访客类型转化率'], { header: 1 })
  expect(sheet[0]).toEqual(['分组', '结果（%）', '分子', '分母', '排除', '来源记录数'])
  const first = result.points[0]
  expect(sheet[1]).toEqual([first.label, first.value, first.rate!.numerator, first.rate!.denominator, first.rate!.excluded, first.rowIds.length])
  const sources = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['来源记录'], { header: 1 })
  expect(sources[0]).toEqual(['分组', '记录ID', '来源位置'])
  expect(sources.slice(1).map(row => row[1])).toEqual(result.points.flatMap(point => point.rowIds))
})

it('整轮分析导出汇总加每个任务一张表', async () => {
  const XLSX = await import('xlsx')
  const first = calculate()
  first.ai = { goal: '真实公开数据', taskId: 'visitor', taskTitle: '访客类型转化率', model: 'test-only', plannedAt: '2026-10-19' }
  const second = calculate({ ...mapping, x: 'Weekend' }, data, 2)
  second.ai = { goal: '真实公开数据', taskId: 'weekend', taskTitle: '周末转化率', model: 'test-only', plannedAt: '2026-10-19' }
  const bundle = { response: { plan: { goal: '真实公开数据' } }, results: [first, second], facts: [], review: null, failures: [] } as unknown as AnalysisBundle
  const summary = bundleSummaryRows(data, bundle)
  expect(summary[0]).toEqual(['序号', '任务标题', '分析问题', '指标', '单位', '分组数', '有效记录数', '来源记录数', '快照一致'])
  expect(summary[1][8]).toBe('是')
  const book = XLSX.read(await bundleWorkbookBytes(data, bundle), { type: 'array' })
  expect(book.SheetNames).toEqual(['分析汇总', '访客类型转化率', '周末转化率', '口径与来源'])
})

it('CSV 与表格同列同值，使用 BOM 便于 Excel 打开', () => {
  const result = calculate()
  const csv = resultCSV(result)
  expect(csv.charCodeAt(0)).toBe(0xFEFF)
  const lines = csv.slice(1).split('\r\n')
  expect(lines[0]).toBe('"分组","结果（%）","分子","分母","排除","来源记录数"')
  const first = result.points[0]
  expect(lines[1]).toBe(['"' + first.label + '"', first.value, first.rate!.numerator, first.rate!.denominator, first.rate!.excluded, first.rowIds.length].map(v => typeof v === 'string' ? v : '"' + v + '"').join(','))
  expect(csv).not.toContain('source_record_ids')
})

it('快照不一致时拒绝导出，不生成旧数据表格', async () => {
  const result = calculate()
  await expect(resultWorkbookBytes(result, { dataset: { ...data, fingerprint: 'changed' } })).rejects.toThrow('快照')
})
