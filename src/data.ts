import type { SourceNotes } from './provenance'
import { aggregateDataset } from './engine'
export type Row = Record<string, string | null>
export type ImportOrigin = { format: string; fileHash: string; sheet?: string; page?: number; headerRow: number; method: string; warnings: string[]; locations: string[]; reviewed: boolean; pageImage?: string }
export type Dataset = { sourceNotes?: SourceNotes; originalFileHash?: string; originalFileName?: string; preparation?: { parentHash: string; steps: string[] }; sourceRecords?: number[]; origin?: ImportOrigin; title: string; sourceUrl: string; rows: Row[]; headers: string[]; loadedAt: string; fingerprint: string; isPublic: boolean }
export type Profile = { key: string; kind: '数值' | '文本' | '时间候选'; missing: number; numeric: number; nonempty: number }
export type RateDefinition = { successValue: string; eligibleValues: string[] }
export type Mapping = { rate?: RateDefinition; x: string; metric: string; filter: string; value: string; from: string; to: string; unit: string; aggregate: 'sum' | 'average' | 'count' | 'distinct' | 'min' | 'max'; timeBucket?: 'none' | 'month' | 'year'; conditions?: { field: string; operator: 'eq' | 'gte' | 'lte'; value: string }[] }
export type RateCounts = { numerator: number; denominator: number; excluded: number }
export type AnalysisScope = { datasetHash: string; loadedAt: string; parentAnalysisId: number; parentTitle: string; label: string; rowIds: number[]; baseline: { metric: string; aggregate: Mapping['aggregate']; unit: string; value: number; rate?: RateDefinition; counts?: RateCounts } }
export type Point = { scopeRowIds?: number[]; excludedRowIds?: number[]; rate?: RateCounts; label: string; value: number; rowIds: number[] }
export type Analysis = { scope?: AnalysisScope; rateSummary?: RateCounts & { value: number }; unavailableGroups?: { label: string; excluded: number; rowIds: number[] }[]; sql?: string; parameters?: (string | number | null)[]; id: number; question: string; mapping: Mapping; points: Point[]; usedRows: number; skipped: number; matched: number; createdAt: string; datasetHash: string; finding: string; operations: string[]; ai?: { goal: string; taskId: string; taskTitle: string; model: string; plannedAt: string } }
export const PUBLIC_DATA_URL = 'https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv'
export const PUBLIC_SOURCE_URL = 'https://github.com/owid/energy-data'
export const initialQuestion = '2015—2022 年中国可再生能源发电量如何变化？'

export function parseCSV(input: string) {
  const text = input.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (quoted) {
      if (c === '"' && next === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === '"') {
      if (field.length || closed) throw new Error('CSV 引号位置错误，请使用标准 UTF-8 CSV。')
      quoted = true
    } else if (c === ',') { row.push(field); field = ''; closed = false }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && next === '\n') i++
      row.push(field); if (row.some(v => v.trim())) records.push(row)
      row = []; field = ''; closed = false
    } else {
      if (closed && c.trim()) throw new Error('CSV 闭合引号后存在非分隔字符。')
      if (!closed) field += c
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合，请检查文件。')
  if (field || row.length || closed) { row.push(field); if (row.some(v => v.trim())) records.push(row) }
  if (records.length < 2) throw new Error('文件需要包含标题行和至少一行非空数据。')
  const headers = records.shift()!.map(h => h.trim())
  if (headers.some(h => !h)) throw new Error('存在空列名，请补充列名后上传。')
  if (new Set(headers).size !== headers.length) throw new Error('存在重复列名，请先重命名，避免数据覆盖。')
  if (headers.length > 200) throw new Error('当前 Demo 支持最多 200 列。')
  if (records.length > 100_000) throw new Error('当前 Demo 支持最多 100,000 行，请拆分文件。')
  const rows = records.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`第 ${i + 2} 个非空记录的列数与标题不一致。`)
    return Object.fromEntries(headers.map((key, j) => [key, values[j] === '' ? null : values[j]])) as Row
  })
  return { headers, rows }
}

export function numberValue(value: string | null | undefined): number {
  if (value === null || value === undefined || !value.trim()) return NaN
  const trimmed = value.trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return NaN
  return Number(trimmed)
}
export function formatNumber(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value)
}
export function profileDataset(dataset: Dataset): Profile[] {
  return dataset.headers.map(key => {
    let missing = 0, numeric = 0
    for (const row of dataset.rows) {
      if (row[key] === null || !row[key]?.trim()) missing++
      else if (Number.isFinite(numberValue(row[key]))) numeric++
    }
    const nonempty = dataset.rows.length - missing
    const isNumeric = nonempty > 0 && numeric / nonempty >= 0.9
    const time = /(^year$|date|日期|时间|年份|月份)/i.test(key)
    return { key, missing, numeric, nonempty, kind: time ? '时间候选' : isNumeric ? '数值' : '文本' }
  })
}
export function defaultMapping(dataset: Dataset, profiles: Profile[]): Mapping {
  if (dataset.isPublic) return { x: 'year', metric: 'renewables_electricity', filter: 'country', value: 'China', from: '2015', to: '2022', unit: 'TWh', aggregate: 'sum' }
  return { x: profiles.find(p => p.kind === '时间候选')?.key ?? profiles.find(p => p.kind === '文本')?.key ?? dataset.headers[0], metric: profiles.find(p => p.kind === '数值')?.key ?? '', filter: '', value: '', from: '', to: '', unit: '', aggregate: 'sum' }
}
export function compareLabels(a: string, b: string): number {
  const an = numberValue(a), bn = numberValue(b)
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
  if (/^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/.test(a) && /^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/.test(b)) {
    const parts = (s: string) => s.split(/[-/]/).map(Number)
    const aa = parts(a), bb = parts(b)
    return (aa[0] - bb[0]) || (aa[1] - bb[1]) || ((aa[2] ?? 1) - (bb[2] ?? 1))
  }
  return a.localeCompare(b, 'zh-CN', { numeric: true })
}
export function summarize(points: Point[], unit: string) {
  const first = points[0], suffix = unit ? ` ${unit}` : ''
  if (points.length === 1) return `${first.label} 的汇总结果为 ${formatNumber(first.value)}${suffix}。只有一个分组，无法判断变化趋势。`
  const sorted = [...points].sort((a, b) => a.value - b.value)
  const low = sorted[0], high = sorted.at(-1)!
  return `按当前口径，最高分组为 ${high.label}（${formatNumber(high.value)}${suffix}），最低为 ${low.label}（${formatNumber(low.value)}${suffix}）。该比较不代表时间趋势或因果关系。`

}
export function bucketLabel(raw: string, bucket: Mapping['timeBucket']): string {
  if (!bucket || bucket === 'none') return raw.trim();
  const m = raw.trim().match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?)?)?$/);
  if (!m || (bucket === 'month' && !m[2])) throw new Error('日期不能按所选粒度分桶，请确认标准年月日格式。');
  const year = Number(m[1]), month = Number(m[2] ?? 1), day = Number(m[3] ?? 1);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error('日期字段包含无效日期，未进行静默转换。');
  return bucket === 'year' ? m[1] : m[1] + '-' + String(month).padStart(2, '0');
}
export async function analyze(dataset: Dataset, mapping: Mapping, question: string, id: number, scope?: AnalysisScope): Promise<Analysis> {
  return aggregateDataset(dataset, mapping, question, id, scope)
}
export const aggregateNames = { sum: '求和', average: '均值', count: '记录数', distinct: '非空去重数', min: '最小值', max: '最大值' } as const

export function parsePublicQuestion(text: string, base: Mapping): Mapping {
  if (/为什么|原因|预测|贡献|归因|占比/.test(text)) throw new Error('此规则工具仅支持公开能源数据的字段与范围映射。业务分析请使用上方 AI 辅助工作区；本工具不能回答原因、贡献或预测问题。')
  const countries: [RegExp, string][] = [[/中国|China/i, 'China'], [/美国|United States/i, 'United States'], [/印度|India/i, 'India'], [/德国|Germany/i, 'Germany'], [/英国|United Kingdom/i, 'United Kingdom'], [/法国|France/i, 'France'], [/日本|Japan/i, 'Japan']]
  const metrics: [RegExp, string][] = [[/太阳能|光伏/, 'solar_electricity'], [/风能|风电/, 'wind_electricity'], [/可再生(?:能源)?/, 'renewables_electricity']]
  const selectedCountries = countries.filter(([pattern]) => pattern.test(text))
  const selectedMetrics = metrics.filter(([pattern]) => pattern.test(text))
  if (selectedCountries.length > 1 || selectedMetrics.length > 1) throw new Error('当前每次只分析一个地区和一个指标。请拆成不同分析分支，或手动确认字段口径。')
  const years = text.match(/\b(?:19|20)\d{2}\b/g) ?? []
  if (years.length > 2 || /\d{4}\s*年?\s*[和、,，]\s*\d{4}/.test(text)) throw new Error('请使用一个年份或明确的起止年份范围；当前不支持多个离散年份。')
  let remainder = text
  for (const [pattern] of [...countries, ...metrics]) remainder = remainder.replace(new RegExp(pattern.source, 'gi'), '')
  remainder = remainder.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/发电量|发电|能源|增长|变化|趋势|下降|多少|如何|怎么样|怎样|情况|对比|比较|查看|分析|请问|请|显示|期间|年度|年|从|到|至|的|在|为|是|看|了|吗|呢|求和|平均值|平均/g, '').replace(/[\s\p{P}\p{S}]/gu, '')
  if (remainder || (!selectedCountries.length && !selectedMetrics.length && !years.length && !/增长|变化|趋势|下降|多少|发电|平均|求和/.test(text))) throw new Error('问题超出规则解析范围。支持七个地区、年份范围及可再生/太阳能/风能发电量；其他问题请通过字段口径分析。')
  if (!['renewables_electricity', 'solar_electricity', 'wind_electricity'].includes(base.metric) && !selectedMetrics.length) throw new Error('请明确选择可再生、太阳能或风能发电指标。')
  if (base.filter !== 'country' && !selectedCountries.length) throw new Error('请明确指定一个地区。')
  const m = { ...base }
  if (selectedMetrics.length) m.metric = selectedMetrics[0][1]
  if (selectedCountries.length) { m.filter = 'country'; m.value = selectedCountries[0][1] }
  if (years.length) { m.from = years[0]!; m.to = years[1] ?? years[0]! }
  if (/平均/.test(text)) m.aggregate = 'average'
  if (/求和/.test(text)) m.aggregate = 'sum'
  m.x = 'year'; m.unit = 'TWh'
  return m
}
export function escapeHTML(text: string) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!) }
export async function fingerprint(text: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buffer)].map(v => v.toString(16).padStart(2, '0')).join('')
}
export function download(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
