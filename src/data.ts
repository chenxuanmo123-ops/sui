import type { SourceNotes } from './provenance'
import { aggregateDataset } from './engine'
import type { TimeTrend } from './statistics'
export type Row = Record<string, string | null>
export type ImportOrigin = { format: string; fileHash: string; sheet?: string; page?: number; headerRow: number; method: string; warnings: string[]; locations: string[]; reviewed: boolean; pageImage?: string }
export type Dataset = { sourceNotes?: SourceNotes; originalFileHash?: string; originalFileName?: string; preparation?: { parentHash: string; steps: string[] }; sourceRecords?: number[]; origin?: ImportOrigin; title: string; sourceUrl: string; rows: Row[]; headers: string[]; loadedAt: string; fingerprint: string; isPublic: boolean }
export type Profile = { key: string; kind: '数值' | '文本' | '时间候选'; missing: number; numeric: number; nonempty: number }
export type RateDefinition = { successValue: string; eligibleValues: string[] }
export type Aggregate = 'sum' | 'average' | 'count' | 'distinct' | 'min' | 'max' | 'median' | 'p25' | 'p75'
export type Mapping = { rate?: RateDefinition; x: string; metric: string; filter: string; value: string; from: string; to: string; unit: string; aggregate: Aggregate; timeBucket?: 'none' | 'month' | 'year'; conditions?: { field: string; operator: 'eq' | 'gte' | 'lte'; value: string }[] }
export type RateCounts = { numerator: number; denominator: number; excluded: number }
export type AnalysisScope = { datasetHash: string; loadedAt: string; parentAnalysisId: number; parentTitle: string; label: string; rowIds: number[]; baseline: { metric: string; aggregate: Mapping['aggregate']; unit: string; value: number; rate?: RateDefinition; counts?: RateCounts } }
export type Point = { scopeRowIds?: number[]; excludedRowIds?: number[]; rate?: RateCounts; label: string; value: number; rowIds: number[] }
export type Analysis = { scope?: AnalysisScope; unitSource?: 'user'; rateSummary?: RateCounts & { value: number }; unavailableGroups?: { label: string; excluded: number; rowIds: number[] }[]; sql?: string; parameters?: (string | number | null)[]; id: number; question: string; mapping: Mapping; points: Point[]; usedRows: number; skipped: number; matched: number; createdAt: string; datasetHash: string; finding: string; operations: string[]; trend?: TimeTrend; ai?: { goal: string; taskId: string; taskTitle: string; model: string; plannedAt: string } }
// Pin the upstream commit so the same button always loads the same bytes and
// evidence snapshots stay reproducible. This is the commit used by the
// verified fixtures in tests/fixtures/owid-provenance.json.
export const PUBLIC_DATA_COMMIT = 'e7897aed55b514b8d16e0a3d8f1518789ac3de31'
export const PUBLIC_DATA_URL = 'https://raw.githubusercontent.com/owid/energy-data/' + PUBLIC_DATA_COMMIT + '/owid-energy-data.csv'
export const PUBLIC_SOURCE_URL = 'https://github.com/owid/energy-data/tree/' + PUBLIC_DATA_COMMIT
// The file is ~9 MB, so raw.githubusercontent.com often stalls or resets here
// before the browser finishes downloading it. The mirrors below serve the same
// pinned commit; a download is accepted only when its SHA-256 matches
// PUBLIC_DATA_SHA256, so a slow or dishonest mirror cannot change the evidence.
// Order matters: the first reachable candidate wins, and later ones are tried
// when an earlier one stops making progress.
export const PUBLIC_DATA_MIRRORS: { label: string; url: string }[] = [
  { label: 'jsDelivr', url: 'https://cdn.jsdelivr.net/gh/owid/energy-data@' + PUBLIC_DATA_COMMIT + '/owid-energy-data.csv' },
  { label: 'gh-proxy', url: 'https://gh-proxy.com/' + PUBLIC_DATA_URL },
  { label: 'ghproxy', url: 'https://ghproxy.net/' + PUBLIC_DATA_URL },
  { label: 'GitHub 原始地址', url: PUBLIC_DATA_URL },
]
export const PUBLIC_DATA_BYTES = 9229369
export const PUBLIC_DATA_SHA256 = '266f2e2baad7975351bc9bb4aa061d22b1da9fe4c47d51d2ac6071e01e171f76'
// Workspaces saved before the pin still carry the branch URL.
export const PUBLIC_SOURCE_LEGACY = 'https://github.com/owid/energy-data'
export const initialQuestion = '2015—2022 年中国可再生能源发电量如何变化？'

const CSV_DELIMITERS = [',', ';', '\t'] as const
export type TextDecoding = { text: string; encoding: string; warning?: string }

// Browser imports go through bytes, not File.text(): Excel on Chinese Windows
// writes GBK/ANSI CSV by default, and UTF-16 files also exist. Never replace
// characters silently — either decode with a known encoding or reject.
export function decodeTextBytes(bytes: Uint8Array): TextDecoding {
  const bom = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : ''
  if (bom) return { text: new TextDecoder(bom).decode(bytes), encoding: bom, warning: '检测到 ' + bom.toUpperCase() + ' 字节序标记，已按该编码解码。' }
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' } }
  catch {
    try {
      return { text: new TextDecoder('gb18030', { fatal: true }).decode(bytes), encoding: 'gb18030', warning: '文件不是 UTF-8，已按 GB18030 / GBK 解码（中文 Windows Excel 的常见默认编码）；请核对表头与中文内容。' }
    } catch { throw new Error('无法识别文件编码：既不是 UTF-8，也不是 GBK / GB18030。请将文件另存为 UTF-8 CSV 后重试。') }
  }
}

// Count fields on one physical line without splitting inside quotes, so a comma
// inside a quoted field cannot outvote the real separator.
function delimiterColumns(line: string, delimiter: string) {
  let fields = 1, quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) { if (c === '"') { if (line[i + 1] === '"') i++; else quoted = false } }
    else if (c === '"') quoted = true
    else if (c === delimiter) fields++
  }
  return fields
}

export function detectDelimiter(input: string) {
  const lines = input.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim()).slice(0, 20)
  let best: string = ',', bestMatches = 0, bestColumns = 1
  for (const delimiter of CSV_DELIMITERS) {
    const header = delimiterColumns(lines[0] ?? '', delimiter)
    if (header < 2) continue
    const matches = lines.filter(line => delimiterColumns(line, delimiter) === header).length
    if (matches > bestMatches || (matches === bestMatches && header > bestColumns)) { best = delimiter; bestMatches = matches; bestColumns = header }
  }
  return best
}

export function parseCSV(input: string, delimiter?: string) {
  const text = input.replace(/^\uFEFF/, '')
  const separator = delimiter && delimiter.length === 1 ? delimiter : detectDelimiter(text)
  const records: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (quoted) {
      if (c === '"' && next === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === '"') {
      if (field.length || closed) throw new Error('CSV 引号位置错误，请检查分隔符与引号是否符合标准 CSV。')
      quoted = true
    } else if (c === separator) { row.push(field); field = ''; closed = false }
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
export function summarize(points: Point[], unit: string, timeOrdered = false) {
  const first = points[0], suffix = unit ? ` ${unit}` : ''
  if (points.length === 1) return `${first.label} 的汇总结果为 ${formatNumber(first.value)}${suffix}。只有一个分组，无法判断变化趋势。`
  if (timeOrdered) {
    const last = points.at(-1)!
    return `按时间顺序共 ${points.length} 个分组：从 ${first.label}（${formatNumber(first.value)}${suffix}）到 ${last.label}（${formatNumber(last.value)}${suffix}）。这是描述性汇总，不代表因果或预测。`
  }
  const sorted = [...points].sort((a, b) => a.value - b.value)
  const low = sorted[0], high = sorted.at(-1)!
  return `按当前口径，最高分组为 ${high.label}（${formatNumber(high.value)}${suffix}），最低为 ${low.label}（${formatNumber(low.value)}${suffix}）。该比较不代表时间趋势或因果关系。`

}
export function normalizeUnit(unit: string) { return unit.trim().slice(0, 40) }

// A declared unit is user metadata, not a new computation. Rates keep their
// fixed percent denominator. For other analyses the deterministic description
// is re-rendered with the same calculated points and the declared unit, so the
// chart, table, conclusion and exports agree without changing any value.
export function withDeclaredUnit(analysis: Analysis, unit: string): Analysis {
  if (analysis.mapping.rate) return analysis
  const next = normalizeUnit(unit)
  if (analysis.mapping.unit === next && analysis.unitSource === 'user') return analysis
  const scope = analysis.scope ? { ...analysis.scope, baseline: { ...analysis.scope.baseline, unit: next } } : undefined
  const result: Analysis = {
    ...analysis,
    mapping: { ...analysis.mapping, unit: next },
    ...(scope ? { scope } : {}),
    finding: summarize(analysis.points, next, Boolean(analysis.trend)),
  }
  delete result.unitSource
  if (next) result.unitSource = 'user'
  return result
}
export function bucketLabel(raw: string, bucket: Mapping['timeBucket']): string {
  if (!bucket || bucket === 'none') return raw.trim();
  const m = raw.trim().match(/^(\d{4})(?:[-/](\d{1,2})(?:[-/](\d{1,2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?)?)?$/);
  if (!m || (bucket === 'month' && !m[2])) throw new Error('日期不能按所选粒度分桶，请确认标准年月日格式。');
  const year = Number(m[1]), month = Number(m[2] ?? 1), day = Number(m[3] ?? 1);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) throw new Error('日期字段包含无效日期，未进行静默转换。');
  return bucket === 'year' ? m[1] : m[1] + '-' + String(month).padStart(2, '0');
}
export async function analyze(dataset: Dataset, mapping: Mapping, question: string, id: number, scope?: AnalysisScope, signal?: AbortSignal): Promise<Analysis> {
  return aggregateDataset(dataset, mapping, question, id, scope, signal)
}
export const aggregateNames = { sum: '求和', average: '均值', count: '记录数', distinct: '非空去重数', min: '最小值', max: '最大值', median: '中位数', p25: '下四分位 P25', p75: '上四分位 P75' } as const

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
  if (/中位/.test(text)) m.aggregate = 'median'
  else if (/下四分位|P25/i.test(text)) m.aggregate = 'p25'
  else if (/上四分位|P75/i.test(text)) m.aggregate = 'p75'
  else if (/平均/.test(text)) m.aggregate = 'average'
  else if (/求和/.test(text)) m.aggregate = 'sum'
  m.x = 'year'; m.unit = 'TWh'
  return m
}
export function escapeHTML(text: string) { return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!) }
export async function fingerprint(text: string) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buffer)].map(v => v.toString(16).padStart(2, '0')).join('')
}
export function download(content: string | Uint8Array, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
