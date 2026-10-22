import type { Analysis, Point } from './data'
import { rateBaseline } from './follow-up'
export type ChartSort = 'original' | 'desc' | 'asc'
export type ChartReference = { value: number; label: string }
export function orderPoints(points: Point[], order: ChartSort): Point[] {
  return order === 'original' ? points : points.map((p, index) => ({p, index})).sort((a,b) => (order === 'desc' ? b.p.value-a.p.value : a.p.value-b.p.value) || a.index-b.index).map(({p})=>p)
}
/** Tick-domain tests use numerical boundary inputs, not invented business records. */
export function chartDomain(values: number[], reference?: number) {
  const valid = values.filter(Number.isFinite)
  if (reference !== undefined && Number.isFinite(reference)) valid.push(reference)
  const min = Math.min(0, ...valid), max = Math.max(0, ...valid)
  const span = max-min || 1
  const rough = span/4, power = 10 ** Math.floor(Math.log10(rough))
  const fraction = rough/power
  const factor = [1,2,2.5,5,10].find(n=>n>=fraction) ?? 10
  const step = factor*power
  // Retain real extrema if extremely small or large numbers prevent a finite nice scale.
  if (!Number.isFinite(step) || !step || !Number.isFinite(span)) return {min,max:max===min?min+1:max,ticks:[min,max]}
  const low = Math.floor(min/step)*step, high = Math.ceil((max===min?1:max)/step)*step
  const ticks = Array.from({length:Math.min(12,Math.round((high-low)/step)+1)},(_,i)=>Number((low+i*step).toPrecision(14)))
  return {min:low,max:high,ticks}
}
/** Keep fractional ticks such as 2.5 visible instead of rounding them to 3. */
export function tickPrecision(step: number) {
  if (!Number.isFinite(step) || step === 0) return 0
  for (let digits=0;digits<8;digits++) {
    if (Math.abs(step-Number(step.toFixed(digits)))<=Math.abs(step)*1e-10) return digits
  }
  return 8
}
export function chartScale(domain: {min:number;max:number}) {
  const magnitude = Math.max(Math.abs(domain.min),Math.abs(domain.max))
  return magnitude>=1e12?{divisor:1e12,label:'万亿'}:magnitude>=1e8?{divisor:1e8,label:'亿'}:magnitude>=1e4?{divisor:1e4,label:'万'}:{divisor:1,label:''}
}

export function analysisReference(result: Analysis): ChartReference | undefined {
  if (!result.rateSummary) return undefined
  const parent = rateBaseline(result)
  return {value:parent ?? result.rateSummary.value,label:parent === undefined?'当前范围总体比例':'来源分组比例'}
}
