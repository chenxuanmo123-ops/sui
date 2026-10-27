import { formatNumber } from './data'
import type { Analysis } from './data'

/**
 * Deterministic reading of a computed result.
 *
 * These sentences are generated from the Analysis object, never from a model.
 * "Meaning" and "use" are explicitly phrased as possibilities and next steps,
 * because the imported table alone cannot establish a business mechanism.
 */

export type InsightKey = 'observed' | 'meaning' | 'use' | 'need' | 'limit'
export type InsightSection = { key: InsightKey; title: string; body: string }
export type InsightBrief = {
  headline: string
  tone: 'up' | 'down' | 'flat' | 'mixed'
  sections: InsightSection[]
}

const periodName = (period: 'year' | 'month') => period === 'year' ? '年' : '月'

function sentence(text: string) {
  const trimmed = text.trim()
  return /[。！？]$/.test(trimmed) ? trimmed : trimmed + '。'
}

function extremes(points: Analysis['points']) {
  return points.reduce((result, point) => ({
    high: point.value > result.high.value ? point : result.high,
    low: point.value < result.low.value ? point : result.low,
  }), { high: points[0], low: points[0] })
}

export function buildInsight(result: Analysis): InsightBrief {
  const { points, mapping, trend, rateSummary } = result
  const unit = mapping.unit ? ' ' + mapping.unit : ''
  if (!points.length) {
    return {
      headline: '当前口径没有可计算的分组。',
      tone: 'mixed',
      sections: [
        { key: 'observed', title: '数据观察', body: sentence(result.finding || '没有生成有效结果') },
        { key: 'limit', title: '不能得出什么', body: '没有有效结果时，不能推断趋势、差异或业务含义。请先检查字段、筛选值和范围。' },
      ],
    }
  }

  const { high, low } = extremes(points)
  const rateHigh = rateSummary ? Math.max(...points.map(point => point.value)) : null
  const rateLow = rateSummary ? Math.min(...points.map(point => point.value)) : null
  const uniform = points.length > 1 && points.every(point => point.value === points[0].value)
  // COUNT(*) counts rows, not the selected metric's values. Naming the metric
  // here would imply a sum of that column, so use the actual numerator.
  const measure = mapping.aggregate === 'count' ? '记录数' : '「' + mapping.metric + '」'

  let headline = `${mapping.x} 各组的${measure}：最高 ${high.label}（${formatNumber(high.value, 2)}${unit}），最低 ${low.label}（${formatNumber(low.value, 2)}${unit}）。`
  let tone: InsightBrief['tone'] = 'mixed'

  if (points.length === 1) {
    headline = `只有一个分组 ${high.label}，汇总值为 ${formatNumber(high.value, 2)}${unit}；无法比较组间差异或判断趋势。`
    tone = 'flat'
  } else if (rateSummary && rateHigh !== null && rateLow !== null) {
    headline = `总体比例为 ${formatNumber(rateSummary.value, 2)}%；${points.length} 个分组中最高 ${high.label}（${formatNumber(rateHigh, 2)}%），最低 ${low.label}（${formatNumber(rateLow, 2)}%）。`
  } else if (uniform && !trend) {
    // e.g. a zero-inflated metric aggregated by median: every group can land
    // on the same floor value. Reporting a "highest" and "lowest" would invent
    // a comparison that the result does not support.
    headline = `${points.length} 个分组的${measure}都为 ${formatNumber(high.value, 2)}${unit}；当前口径下没有可区分的组间差异。`
    tone = 'flat'
  } else if (trend) {
    const direction = trend.slope > 0 ? '上升' : trend.slope < 0 ? '下降' : '基本持平'
    const strength = trend.r2 >= 0.5 ? '' : '，但线性解释力有限'
    // Four decimals on a monthly total are noise for a reader; keep just
    // enough precision to see direction and size.
    const slopeDigits = Math.abs(trend.slope) >= 1000 ? 0 : Math.abs(trend.slope) >= 10 ? 1 : 2
    headline = `按 ${trend.n} 个时间分组拟合，「${mapping.metric}」整体${direction}，平均每${periodName(trend.period)}变化 ${trend.slope >= 0 ? '+' : ''}${formatNumber(trend.slope, slopeDigits)}${unit}${strength}（R² ${formatNumber(trend.r2, 3)}）。`
    tone = trend.r2 < 0.5 ? 'mixed' : trend.slope > 0 ? 'up' : trend.slope < 0 ? 'down' : 'flat'
  }

  // The chart keeps the engine's one-line finding; do not repeat it verbatim.
  const scope = rateSummary
    ? `本次按 ${mapping.x} 比较「${mapping.metric} = ${mapping.rate?.successValue ?? ''}」的记录占比`
    : `本次按 ${mapping.x} ${mapping.aggregate === 'count' ? '统计' : '汇总'}${measure}`
  const observed = [
    `${scope}，包含 ${points.length} 个分组，纳入 ${formatNumber(result.usedRows, 0)} 条有效来源记录，跳过空分组或非数值 ${formatNumber(result.skipped, 0)} 条。`,
  ]
  if (trend) observed.push(`趋势使用 ${trend.n} 个时间分组做最小二乘拟合，R² 为 ${formatNumber(trend.r2, 3)}；这是描述性拟合，不是预测或显著性检验。`)
  if (rateSummary) {
    const unavailable = result.unavailableGroups?.length ?? 0
    observed.push(`总体比例按总分子 ${formatNumber(rateSummary.numerator, 0)} ÷ 总分母 ${formatNumber(rateSummary.denominator, 0)} 计算，排除 ${formatNumber(rateSummary.excluded, 0)} 条未知或缺失结果${unavailable ? `；另有 ${unavailable} 个分组分母为零，未显示为 0%` : ''}。`)
  }

  let meaning: string
  if (trend) {
    // Monthly totals still contain the within-year cycle. Without this caveat a
    // seasonal dataset can read as a steady long-term rise.
    const seasonal = mapping.timeBucket === 'month' ? '按月汇总未做季节调整，年内周期也会进入拟合；' : ''
    meaning = trend.r2 < 0.5
      ? `${seasonal}线性拟合较弱，数据更像波动而不是稳定上升或下降；把它概括成“持续增长/下降”会过度解读。`
      : `${seasonal}如果单位、统计范围和记录方式在观察期内没有变化，这种${trend.slope > 0 ? '上升' : trend.slope < 0 ? '下降' : '持平'}可能对应规模扩大、收缩或结构变化；也可能来自覆盖范围、单位或记录方式变化。单凭这张表无法区分。`
  } else if (uniform) {
    meaning = '各组在当前口径下得到相同结果。这可能是指标本身没有差异，也可能是聚合方式把差异压平了（例如中位数被最小值固定）；当前结果不能区分这两种情况。'
  } else if (rateSummary) {
    meaning = `不同 ${mapping.x} 组之间的比例差异，可能对应人群构成、流程或记录口径不同；当前结果没有控制这些因素，不能把差异归因于某一项措施。`
  } else if (mapping.aggregate === 'count') {
    meaning = `组间记录数不同，可能对应实际规模、数据覆盖或记录方式差异；记录数本身不能证明每组包含相同的实体或范围。`
  } else {
    meaning = `组间数值差异可能来自规模、构成或记录方式不同，也可能是样本量差异；当前没有做加权或控制变量，不能说明差异从何而来。`
  }

  let use: string
  if (trend) {
    use = '可用于判断是否需要按地区、类别或渠道拆分，定位异常时间点，以及决定下一步补充哪些数据；不能用来预测未来，也不能评价政策或措施效果。'
  } else if (uniform) {
    use = '可用于确认当前口径无法区分这些组，并据此更换指标、聚合方式或拆分维度；不能据此判断各组业务表现相同。'
  } else if (rateSummary) {
    use = '可用于比较各组当前比例、发现分母过小或缺失集中的组，并确定优先核查对象；不能把比例差异当作干预效果。'
  } else if (mapping.aggregate === 'count') {
    use = '可用于快速了解记录主要集中在哪里，发现覆盖不足或记录异常的类别；不能把记录数当作业务规模或用户数。'
  } else {
    use = '可用于定位最高/最低组、发现异常值，并安排下一步核查；不能直接用于绩效评价、资源分配或因果判断。'
  }

  const need: string[] = ['每行代表的实体与统计范围']
  if (!mapping.unit) need.push('指标单位和数量级（当前未声明）')
  if (trend) need.push('同口径的历史版本或外部对照，用来区分真实变化与口径变化')
  if (trend && mapping.timeBucket === 'month') need.push('同月对照或季节调整后的序列，用来区分长期变化与年内周期')
  if (rateSummary) need.push('“未知/缺失”的业务含义，以及分母是否应包含它们')
  if (!trend && !rateSummary) need.push('分组字段的业务定义，以及是否需要按规模加权')
  need.push('至少一个能区分组间差异的对照维度或业务记录')

  return {
    headline, tone,
    sections: [
      { key: 'observed', title: '数据观察', body: observed.join('') },
      { key: 'meaning', title: '可能意味着什么', body: meaning },
      { key: 'use', title: '可以拿来做什么', body: use },
      { key: 'need', title: '还需要什么', body: '还需要：' + need.join('；') + '。' },
      { key: 'limit', title: '不能得出什么', body: '不能得出：原因或因果影响、未来预测、总体代表性、统计显著性。当前结果是描述性汇总；组间差异或线性同步不等于因果。' },
    ],
  }
}
