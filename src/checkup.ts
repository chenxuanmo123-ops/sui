import { aggregateNames, compareLabels, formatNumber, numberValue } from './data'
import type { Dataset, Mapping } from './data'
import { inspectQuality } from './preparation'
import type { FieldSummary } from './preparation'
import type { ExploreSpec } from './analytics'

/**
 * Deterministic, model-free data checkup.
 *
 * Every role and every suggested question is derived from the imported values
 * and the same strict numeric parser used by the SQL engine. Nothing here is a
 * business fact: roles are candidates, and the UI keeps the "confirm the
 * meaning" step visible.
 */

export type CheckupRole = 'time' | 'measure' | 'category' | 'binary' | 'identifier' | 'text'

export type CheckupTime = {
  granularity: 'year' | 'month' | 'date' | 'mixed'
  valid: number
  distinct: number
  min: string
  max: string
  gaps: number
}

export type CheckupBinary = {
  values: string[]
  successValue?: string
  positiveLabel?: string
  /** True when the labels themselves name an outcome (是/否, TRUE/FALSE). */
  explicit?: boolean
}

export type CheckupField = {
  key: string
  role: CheckupRole
  roleLabel: string
  detail: string
  missing: number
  nonempty: number
  unique: number
  numeric: number
  top: { value: string; count: number }[]
  min: number | null
  max: number | null
  median: number | null
  outliers: number
  time?: CheckupTime
  binary?: CheckupBinary
}

export type CheckupQuestion = {
  id: string
  kind: 'trend' | 'rate' | 'rank' | 'count' | 'top' | 'correlation'
  title: string
  question: string
  why: string
  chart: 'line' | 'bar'
  execution:
    | { kind: 'aggregate'; mapping: Mapping }
    | { kind: 'explore'; spec: ExploreSpec }
}

export type CheckupWarning = {
  tone: 'info' | 'warn'
  title: string
  detail: string
}

export type Checkup = {
  rows: number
  fields: number
  completeness: number
  missingCells: number
  duplicateRows: number
  timeField: CheckupField | null
  measures: CheckupField[]
  categories: CheckupField[]
  binaries: CheckupField[]
  identifiers: CheckupField[]
  highCardinality: CheckupField[]
  all: CheckupField[]
  warnings: CheckupWarning[]
  questions: CheckupQuestion[]
  summary: string
}

const YEAR = /^\d{4}$/
const MONTH = /^\d{4}[-/]\d{1,2}$/
const DATE = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T ].*)?$/
const ID_HEADER = /(^|[_\s-])(id|code|no|uuid|guid|instant|index|rowid|row|编号|序号|编码|代码|单号|订单号)([_\s-]|$)/i
// A bare four-digit value is ambiguous: 2024 is a year, but 1248 is also a
// daily ride count. Only a year-named column is treated as a year field.
const YEAR_HEADER = /(^|[_\s-])(year|yr|年份?|年度?)([_\s-]|$)/i
const CALENDAR_HEADER = /^(yr|year|mnth|month|day|weekday|week|hour|date|年份?|年度?|月份?|星期|日期|时间)$/i
const MEASURE_HEADER = /(score|rating|amount|revenue|sales|price|value|total|count|cnt|qty|quantity|rate|ratio|percent|pct|index|评分|得分|金额|收入|销售额|价格|数量|总量|人数|次数)/i
const OUTCOME_HEADER = /(revenue|purchase|buy|order|convert|conversion|churn|retain|retention|success|fail|click|fraud|default|target|label|outcome|result|是否|成交|转化|留存|流失|成功|失败|购买|下单|违约|欺诈|结果)/i

const ROLE_LABELS: Record<CheckupRole, string> = {
  time: '时间字段',
  measure: '数值指标',
  category: '分类维度',
  binary: '二值结果',
  identifier: '编号 / 标识',
  text: '高基数文本',
}

const PAIRS: [string, string][] = [
  ['TRUE', 'FALSE'], ['True', 'False'], ['true', 'false'],
  ['YES', 'NO'], ['Yes', 'No'], ['yes', 'no'], ['Y', 'N'], ['T', 'F'],
  ['是', '否'], ['已', '未'], ['成交', '未成交'], ['通过', '未通过'],
  ['成功', '失败'], ['留存', '流失'], ['男', '女'],
]

/** Returns the raw positive value for a recognisable two-value outcome. */
export function recognizeBinary(values: string[]): CheckupBinary | null {
  const set = new Set(values)
  if (values.length !== 2 || set.size !== 2) return null
  for (const [positive, negative] of PAIRS) {
    if (set.has(positive) && set.has(negative)) {
      return { values: [...values], successValue: positive, positiveLabel: positive, explicit: true }
    }
  }
  const zero = values.find(value => numberValue(value) === 0)
  const one = values.find(value => numberValue(value) === 1)
  if (zero !== undefined && one !== undefined) {
    return { values: [...values], successValue: one, positiveLabel: '取值为 1', explicit: false }
  }
  return null
}

function timeInfo(dataset: Dataset, key: string, summary: FieldSummary): CheckupTime | undefined {
  let year = 0, month = 0, date = 0, valid = 0
  const labels: string[] = []
  for (const row of dataset.rows) {
    const raw = row[key]?.trim()
    if (!raw) continue
    if (DATE.test(raw)) { date++; valid++; labels.push(raw) }
    else if (MONTH.test(raw)) { month++; valid++; labels.push(raw) }
    else if (YEAR.test(raw) && YEAR_HEADER.test(key) && Number(raw) >= 1900 && Number(raw) <= 2100) {
      year++; valid++; labels.push(raw)
    }
  }
  const nonempty = dataset.rows.length - summary.missing
  if (!nonempty || summary.unique < 2 || valid / nonempty < 0.8) return undefined
  const granularity: CheckupTime['granularity'] = date / valid >= 0.8 ? 'date' : month / valid >= 0.8 ? 'month' : year / valid >= 0.8 ? 'year' : 'mixed'
  labels.sort(compareLabels)
  const min = labels[0], max = labels.at(-1)!
  const distinct = new Set(labels).size
  let gaps = 0
  if (granularity === 'year') {
    const span = Number(max) - Number(min) + 1
    if (Number.isFinite(span)) gaps = Math.max(0, span - distinct)
  } else if (granularity === 'month') {
    const index = (value: string) => {
      const match = value.match(/^(\d{4})[-/](\d{1,2})/)
      return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : NaN
    }
    const span = index(max) - index(min) + 1
    if (Number.isFinite(span)) gaps = Math.max(0, span - distinct)
  }
  return { granularity, valid, distinct, min, max, gaps }
}

function buildField(dataset: Dataset, key: string, summary: FieldSummary): CheckupField {
  const time = timeInfo(dataset, key, summary)
  const nonempty = dataset.rows.length - summary.missing
  const values = summary.top.map(item => item.value)
  // A 0/1 "yr" is a calendar index, not a success/failure outcome. Reserving
  // binary for non-calendar columns avoids suggestions such as "share of
  // yr = 1 by season".
  const binary = summary.unique === 2 && !CALENDAR_HEADER.test(key) ? recognizeBinary(values) : null
  const numericShare = nonempty ? summary.numeric / nonempty : 0
  const uniqueShare = nonempty ? summary.unique / nonempty : 0
  const nearUnique = nonempty >= 20 && uniqueShare >= 0.98
  const identifier = nearUnique && (ID_HEADER.test(key) || summary.numeric === 0)
  let integerValues = 0
  for (const row of dataset.rows) {
    const raw = row[key]?.trim()
    if (!raw) continue
    const value = numberValue(raw)
    if (Number.isFinite(value) && Number.isInteger(value)) integerValues++
  }
  // Small integer codes (season=1..4, weathersit=1..4) are dimensions, not
  // quantities. A named score/amount/count stays a measure even when small.
  const integerCoded = !time && !binary && !identifier && summary.unique <= 20 &&
    numericShare >= 0.9 && integerValues === summary.numeric && !MEASURE_HEADER.test(key)
  const measure = !identifier && !integerCoded && numericShare >= 0.9
  const category = summary.unique >= 1 && summary.unique <= 50
  const role: CheckupRole = time ? 'time' : binary ? 'binary' : identifier ? 'identifier' : integerCoded ? 'category' : measure ? 'measure' : category ? 'category' : 'text'

  let detail = ''
  if (role === 'time' && time) {
    const granularity = time.granularity === 'year' ? '按年' : time.granularity === 'month' ? '按月' : time.granularity === 'date' ? '按日期（可归到年/月）' : '混合日期格式'
    detail = `${granularity}分组，覆盖 ${time.min}–${time.max}${time.gaps ? '；缺 ' + time.gaps + ' 个时间点' : ''}`
  } else if (role === 'measure') {
    detail = `${formatNumber(summary.numeric, 0)} 个可解析数值${summary.outliers ? '，' + formatNumber(summary.outliers, 0) + ' 个 IQR 离群候选' : ''}`
  } else if (role === 'binary' && binary) {
    detail = `两种取值：${binary.values.join(' / ')}${binary.successValue ? '；可计算「' + binary.positiveLabel + '」占比' : ''}`
  } else if (role === 'category') {
    detail = `${formatNumber(summary.unique, 0)} 个不同取值${summary.top[0] ? '，最多：' + summary.top[0].value + '（' + formatNumber(summary.top[0].count, 0) + ' 条）' : ''}`
  } else if (role === 'identifier') {
    detail = '几乎每行都不同，可能是编号；不要直接求和'
  } else {
    detail = `${formatNumber(summary.unique, 0)} 个不同取值，基数较高，暂不作为默认分组`
  }

  return {
    key, role, roleLabel: ROLE_LABELS[role], detail,
    missing: summary.missing, nonempty, unique: summary.unique,
    numeric: summary.numeric, top: summary.top, min: summary.min, max: summary.max,
    median: summary.median, outliers: summary.outliers,
    ...(time ? { time } : {}), ...(binary ? { binary } : {}),
  }
}

function measureScore(field: CheckupField) {
  if (/(^|[_\s-])(cnt|count)([_\s-]|$)/i.test(field.key)) return 3
  if (/(amount|revenue|sales|price|value|total|count|qty|quantity|金额|收入|销售额|价格|数量|总量|发电量|产量|人数|次数)/i.test(field.key)) return 3
  if (/(rate|ratio|percent|pct|score|index|率|占比|百分比|比例|评分|得分|指数)/i.test(field.key)) return 2
  return 1
}

function primaryMeasure(fields: CheckupField[]) {
  return [...fields].sort((a, b) => measureScore(b) - measureScore(a) || b.numeric - a.numeric || a.unique - b.unique)[0]
}

function preferredAggregate(field: CheckupField): Mapping['aggregate'] {
  if (/(rate|ratio|percent|pct|score|index|率|占比|百分比|比例|评分|得分|指数)/i.test(field.key)) return 'average'
  // Counts are additive: a monthly "次数 / cnt" should be the total for the
  // bucket, not the median of per-row values.
  if (/(^|[_\s-])(cnt|count)([_\s-]|$)|次数|人数|数量|qty|quantity/i.test(field.key)) return 'sum'
  // A zero (or floor) median with positive values above it means the median is
  // pinned to the floor and would make every group look identical. Mean keeps
  // the suggested comparison informative; the UI still shows the chosen method.
  if (field.median !== null && field.median === field.min && field.max !== null && field.max > field.median) return 'average'
  if (field.numeric >= 20 && field.outliers >= Math.max(5, field.numeric * 0.02)) return 'median'
  return 'sum'
}

function monthSpan(min: string, max: string) {
  const parse = (value: string) => {
    const match = value.match(/^(\d{4})[-/](\d{1,2})/)
    return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : NaN
  }
  const span = parse(max) - parse(min) + 1
  return Number.isFinite(span) && span > 0 ? span : 0
}

function timeBucket(field: CheckupField): 'none' | 'year' | 'month' {
  if (!field.time) return 'none'
  if (field.time.granularity === 'month') return field.time.distinct <= 36 ? 'month' : 'year'
  // Daily data usually carries more than two years of rows; grouping by year
  // would collapse a two-year daily table to two points. Keep monthly buckets
  // while the span is manageable, and fall back to years for long histories.
  if (field.time.granularity === 'date') return monthSpan(field.time.min, field.time.max) <= 36 ? 'month' : 'year'
  return 'year'
}

function baseMapping(overrides: Partial<Mapping>): Mapping {
  return { x: '', metric: '', filter: '', value: '', from: '', to: '', unit: '', aggregate: 'sum', timeBucket: 'none', conditions: [], ...overrides }
}

function questionWhy(field: CheckupField) {
  return field.role === 'time' && field.time
    ? `${field.key} 有 ${formatNumber(field.time.valid, 0)} 个可解析时间值（${field.time.min}–${field.time.max}）`
    : field.detail
}

export function buildCheckup(dataset: Dataset): Checkup {
  const quality = inspectQuality(dataset)
  const all = dataset.headers.map(key => buildField(dataset, key, quality.fields.find(field => field.field === key)!))
  const timeField = all.find((field): field is CheckupField & { time: CheckupTime } => field.role === 'time' && !!field.time) ?? null
  const measures = all.filter(field => field.role === 'measure')
  const categories = all.filter(field => field.role === 'category' && field.unique >= 2)
  const binaries = all.filter((field): field is CheckupField & { binary: CheckupBinary } => field.role === 'binary' && !!field.binary?.successValue)
  const identifiers = all.filter(field => field.role === 'identifier')
  const highCardinality = all.filter(field => field.role === 'text' && field.unique > 50 && field.unique <= 500)
  const missingCells = quality.fields.reduce((total, field) => total + field.missing, 0)
  const completeness = dataset.rows.length && dataset.headers.length
    ? 1 - missingCells / (dataset.rows.length * dataset.headers.length)
    : 0

  const warnings: CheckupWarning[] = []
  if (missingCells) warnings.push({ tone: 'info', title: '存在空值', detail: `${formatNumber(missingCells, 0)} 个空值单元格。计算时会排除缺失值，不会自动当作 0。` })
  if (quality.duplicateRows) warnings.push({ tone: 'warn', title: '存在完全重复行', detail: `${formatNumber(quality.duplicateRows, 0)} 行与前面记录完全相同。可能是重复记录，也可能业务上允许重复；系统不会自动删除。` })
  if (identifiers.length) warnings.push({ tone: 'info', title: '可能有编号字段', detail: `${identifiers.slice(0, 3).map(field => field.key).join('、')} 几乎每行都不同，求和或平均通常没有业务意义。` })
  if (highCardinality.length) warnings.push({ tone: 'info', title: '高基数字段', detail: `${highCardinality.slice(0, 3).map(field => field.key).join('、')} 取值很多；直接全量分组容易超过 200 组上限，建议先排序看前几项或加筛选。` })
  const constant = all.filter(field => field.nonempty > 0 && field.unique === 1)
  if (constant.length) warnings.push({ tone: 'info', title: '常量字段', detail: `${constant.slice(0, 3).map(field => field.key).join('、')} 只有一个取值，分组后不会产生差异。` })
  if (!timeField) warnings.push({ tone: 'info', title: '没有可验证的时间字段', detail: '无法自动生成时间趋势；仍可做分类比较和记录数分布。' })
  else if (timeField.time!.gaps) warnings.push({ tone: 'info', title: '时间范围不连续', detail: `${timeField.key} 覆盖 ${timeField.time!.min}–${timeField.time!.max}，但缺少 ${timeField.time!.gaps} 个预期时间点；趋势线不会自动补齐。` })
  if (!measures.length) warnings.push({ tone: 'info', title: '没有稳定的数值指标', detail: '只能先做记录数分布，或先清理金额/数量字段中的单位、千分位和缺失。' })
  warnings.push({ tone: 'info', title: '单位需要你确认', detail: '系统不自动猜测货币、百分比或数量级；没有声明单位时，图表只显示原始数值。' })

  const questions: CheckupQuestion[] = []
  const add = (question: CheckupQuestion) => {
    if (questions.length < 4 && !questions.some(item => item.id === question.id)) questions.push(question)
  }
  const primary = measures.length ? primaryMeasure(measures) : null

  if (timeField && primary) {
    const bucket = timeBucket(timeField)
    const aggregate = preferredAggregate(primary)
    add({
      id: `trend:${timeField.key}:${primary.key}`,
      kind: 'trend',
      title: `按 ${timeField.key} 看 ${primary.key} 怎么变化`,
      question: `按 ${timeField.key} 分组，${aggregateNames[aggregate]} ${primary.key}，观察时间上的变化。`,
      why: `${questionWhy(timeField)}；${primary.key} 有 ${formatNumber(primary.numeric, 0)} 个可解析数值。按${bucket === 'month' ? '月' : '年'}汇总，趋势只描述这些聚合值。`,
      chart: 'line',
      execution: {
        kind: 'aggregate',
        mapping: baseMapping({ x: timeField.key, metric: primary.key, aggregate, timeBucket: bucket }),
      },
    })
  }

  const rateGrouping = [
    ...categories.filter(field => field.unique >= 2 && field.unique <= 12)
      .sort((a, b) => Number(CALENDAR_HEADER.test(a.key)) - Number(CALENDAR_HEADER.test(b.key)) || Number(/(type|segment|channel|region|country|category|类别|渠道|地区|类型)/i.test(b.key)) - Number(/(type|segment|channel|region|country|category|类别|渠道|地区|类型)/i.test(a.key)) || a.unique - b.unique),
    ...(timeField && timeField.time!.distinct <= 24 ? [timeField] : []),
  ][0]
  const outcomes = binaries.filter(field => field.binary?.explicit || OUTCOME_HEADER.test(field.key))
  if (outcomes.length && rateGrouping) {
    const outcome = outcomes[0]
    const binary = outcome.binary!
    add({
      id: `rate:${rateGrouping.key}:${outcome.key}`,
      kind: 'rate',
      title: `按 ${rateGrouping.key} 看 ${outcome.key} = ${binary.successValue} 的比例`,
      question: `按 ${rateGrouping.key} 分组，计算 ${outcome.key} 等于 ${binary.successValue} 的记录占比。`,
      why: `${outcome.key} 只有两种可枚举取值（${binary.values.join(' / ')}）；分母只纳入这两种取值，缺失和未知会排除并单独报告。`,
      chart: 'bar',
      execution: {
        kind: 'aggregate',
        mapping: baseMapping({
          x: rateGrouping.key,
          metric: outcome.key,
          aggregate: 'count',
          unit: '%',
          timeBucket: rateGrouping.role === 'time' ? timeBucket(rateGrouping) : 'none',
          rate: { successValue: binary.successValue!, eligibleValues: binary.values },
        }),
      },
    })
  }

  if (categories.length && primary) {
    const category = [...categories].sort((a, b) => Number(CALENDAR_HEADER.test(a.key)) - Number(CALENDAR_HEADER.test(b.key)) || a.unique - b.unique || measureScore(b) - measureScore(a))[0]
    const aggregate = preferredAggregate(primary)
    add({
      id: `rank:${category.key}:${primary.key}:${aggregate}`,
      kind: 'rank',
      title: `${category.key} 之间，${primary.key} 差多少`,
      question: `按 ${category.key} 分组，${aggregateNames[aggregate]} ${primary.key}，比较各组水平。`,
      why: `${category.key} 有 ${formatNumber(category.unique, 0)} 个不同取值；${primary.key} 有 ${formatNumber(primary.numeric, 0)} 个可解析数值。使用${aggregateNames[aggregate]}，不会把缺失值当作 0。`,
      chart: 'bar',
      execution: {
        kind: 'aggregate',
        mapping: baseMapping({ x: category.key, metric: primary.key, aggregate }),
      },
    })
  }

  if (!primary && categories.length) {
    const category = categories[0]
    add({
      id: `count:${category.key}`,
      kind: 'count',
      title: `记录主要集中在哪些 ${category.key}`,
      question: `按 ${category.key} 分组，统计每组的记录数。`,
      why: `${category.key} 有 ${formatNumber(category.unique, 0)} 个不同取值；当前没有稳定的数值指标，因此只做记录数分布。`,
      chart: 'bar',
      execution: {
        kind: 'aggregate',
        mapping: baseMapping({ x: category.key, metric: category.key, aggregate: 'count', unit: '条' }),
      },
    })
  }

  if (primary && !categories.length && highCardinality.length) {
    const field = highCardinality[0]
    const aggregate = preferredAggregate(primary)
    add({
      id: `top:${field.key}:${primary.key}:${aggregate}`,
      kind: 'top',
      title: `按 ${field.key} 看 ${primary.key} 的前 20 名`,
      question: `按 ${field.key} 分组，${aggregateNames[aggregate]} ${primary.key}，按结果降序查看前 20 项。`,
      why: `${field.key} 有 ${formatNumber(field.unique, 0)} 个不同取值；先看前 20 名，图上会明确标注未显示项，不把截断当作完整排名。`,
      chart: 'bar',
      execution: {
        kind: 'explore',
        spec: { kind: 'bar', x: field.key, y: primary.key, metric: primary.key, aggregate, filter: '', value: '', bucket: 'none', sort: 'desc', limit: 20 },
      },
    })
  }

  if (measures.length >= 2) {
    const first = primaryMeasure(measures)
    const second = measures.filter(field => field.key !== first.key).sort((a, b) => b.numeric - a.numeric)[0]
    add({
      id: `correlation:${first.key}:${second.key}`,
      kind: 'correlation',
      title: `${first.key} 与 ${second.key} 是否同步变化`,
      question: `计算 ${first.key} 与 ${second.key} 的 Pearson 相关系数，并查看散点分布。`,
      why: `两列都有足够的可解析数值；结果只描述线性同步程度，并会按全部有效配对计算，不是因果结论。`,
      chart: 'bar',
      execution: {
        kind: 'explore',
        spec: { kind: 'scatter', x: first.key, y: second.key, metric: second.key, aggregate: 'count', filter: '', value: '', bucket: 'none', sort: 'label', limit: 100 },
      },
    })
  }

  const timeText = timeField
    ? `，${timeField.key} 是可验证的${timeField.time!.granularity === 'year' ? '年度' : timeField.time!.granularity === 'month' ? '月度' : '日期'}字段（${timeField.time!.min}–${timeField.time!.max}）`
    : '，没有发现可验证的时间字段'
  const summary = `这份数据有 ${formatNumber(dataset.rows.length, 0)} 行、${dataset.headers.length} 个字段${timeText}；${measures.length} 个字段可作为数值指标，${categories.length} 个字段适合作为分类维度。下面是可以直接执行的描述性问题，字段含义和单位仍需你核对。`

  return {
    rows: dataset.rows.length, fields: dataset.headers.length, completeness, missingCells,
    duplicateRows: quality.duplicateRows, timeField, measures, categories, binaries,
    identifiers, highCardinality, all, warnings: warnings.slice(0, 8), questions, summary,
  }
}
