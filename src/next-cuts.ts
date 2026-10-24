import type { Analysis, Mapping } from './data'
import type { Checkup, CheckupField } from './checkup'

/**
 * Alternative cuts of the same measure: same metric, unit, filters and
 * conditions, only the grouping field changes. Every cut is recomputed by the
 * local SQLite engine, so the numbers stay evidence-bound.
 */
export type NextCut = {
  id: string
  kind: 'category' | 'time'
  label: string
  why: string
  mapping: Mapping
}

const DEFAULT_LIMIT = 3

function inUse(field: string, mapping: Mapping) {
  return field === mapping.x || field === mapping.metric || field === mapping.filter
}

function timeBucketFor(field: CheckupField): Mapping['timeBucket'] {
  if (!field.time) return 'none'
  const granularity = field.time.granularity
  if (granularity === 'year' || granularity === 'mixed') return 'none'
  const first = Number(field.time.min.slice(0, 4))
  const last = Number(field.time.max.slice(0, 4))
  const years = last - first + 1
  // Three years or less still reads as monthly points; longer spans would be
  // unreadable as a monthly line and hide the yearly shape.
  return Number.isFinite(years) && years > 0 && years <= 3 ? 'month' : 'year'
}

function timeLabel(field: CheckupField, bucket: Mapping['timeBucket']) {
  if (bucket === 'month') return '按月看同一指标的变化'
  if (bucket === 'year') return '按年看同一指标的变化'
  return `改用「${field.key}」看同一指标的变化`
}

export function buildNextCuts(result: Analysis, checkup: Checkup, limit = DEFAULT_LIMIT): NextCut[] {
  const mapping = result.mapping
  const cuts: NextCut[] = []

  const time = checkup.timeField
  if (time && !inUse(time.key, mapping)) {
    const timeBucket = timeBucketFor(time)
    cuts.push({
      id: 'time:' + time.key,
      kind: 'time',
      label: timeLabel(time, timeBucket),
      why: `${time.key} 覆盖 ${time.time?.min ?? '未知'}–${time.time?.max ?? '未知'}。换到时间维度只是改变分组方式，指标、筛选和汇总方式都不变，仍然不能据此判断原因。`,
      mapping: { ...mapping, x: time.key, timeBucket },
    })
  }

  const alternatives = [...checkup.categories, ...checkup.binaries]
    .filter(field => !inUse(field.key, mapping) && field.unique >= 2 && field.unique <= 50)
    // Fewer categories read better on a chart; category fields come before
    // yes/no outcomes, which are usually better treated as a rate.
    .sort((a, b) => (a.role === b.role ? a.unique - b.unique : a.role === 'category' ? -1 : 1))

  for (const field of alternatives) {
    if (cuts.length >= limit) break
    cuts.push({
      id: 'category:' + field.key,
      kind: 'category',
      label: `按「${field.key}」看`,
      why: `${field.key} 有 ${field.unique} 个取值。用同一指标、同一筛选条件和同一汇总方式重新分组，结果由本地 SQLite 重新计算。`,
      mapping: { ...mapping, x: field.key, timeBucket: 'none' },
    })
  }

  return cuts.slice(0, limit)
}
