export type TrendPoint = { x: number; y: number }
export type LinearTrend = { slope: number; intercept: number; r2: number; n: number }
export type TimeTrend = LinearTrend & { period: 'year' | 'month' }

// Ordinary least squares on the displayed points. This is a descriptive fit,
// not a forecast, significance test, or causal estimate.
export function linearTrend(points: TrendPoint[]): LinearTrend | null {
  const valid = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
  if (valid.length < 3) return null
  const n = valid.length
  const meanX = valid.reduce((sum, point) => sum + point.x, 0) / n
  const meanY = valid.reduce((sum, point) => sum + point.y, 0) / n
  let sxx = 0, sxy = 0, syy = 0
  for (const point of valid) {
    const dx = point.x - meanX, dy = point.y - meanY
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  if (!(sxx > 0) || !(syy > 0)) return null
  const slope = sxy / sxx
  return { slope, intercept: meanY - slope * meanX, r2: Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy))), n }
}

// Year labels map to the year; month labels map to months since year 0 so the
// slope is read as "per year" or "per month" without assuming equal gaps.
export function timeIndex(label: string, bucket: 'year' | 'month'): number | null {
  const match = bucket === 'year' ? label.match(/^(\d{4})$/) : label.match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  return bucket === 'year' ? year : year * 12 + Number(match[2]) - 1
}
