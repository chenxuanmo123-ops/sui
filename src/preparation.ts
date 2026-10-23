import { numberValue } from './data'
import type { Dataset, Row } from './data'
export type FieldSummary = { field: string; missing: number; numeric: number; unique: number; whitespace: number; min: number | null; max: number | null; mean: number | null; median: number | null; q1: number | null; q3: number | null; outliers: number; top: { value: string; count: number }[] }
export type QualitySummary = { duplicateRows: number; fields: FieldSummary[] }
export type QualityIssue = 'missing' | 'nonnumeric' | 'whitespace' | 'outlier' | 'duplicate'
export type QualityRecord = { index: number; sourceRecord: number; location: string; value: string | null }
export type NumericBin = { lower: number; upper: number; count: number; inclusiveUpper: boolean }
export function numericDistribution(d: Dataset, field: string, count = 8): { bins: NumericBin[]; numeric: number; excluded: number } {
 if (!d.headers.includes(field)) throw new Error('字段不存在')
 if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('分箱数需为 1 至 30 的整数')
 const values = d.rows.map(row => numberValue(row[field])).filter(Number.isFinite)
 if (!values.length) return { bins: [], numeric: 0, excluded: d.rows.length }
 let min = values[0], max = values[0]
 for (const value of values) { min = Math.min(min, value); max = Math.max(max, value) }
 const size = min === max ? 1 : count
 const scale = Math.max(Math.abs(min), Math.abs(max)) || 1
 const low = min / scale, high = max / scale
 const edge = (i: number) => i === 0 ? min : i === size ? max : (low * (1 - i / size) + high * (i / size)) * scale
 const bins = Array.from({ length: size }, (_, i) => ({ lower: edge(i), upper: edge(i + 1), count: 0, inclusiveUpper: i === size - 1 }))
 for (const value of values) { let index = 0; while (index < size - 1 && value >= bins[index].upper) index++; bins[index].count++ }
 return { bins, numeric: values.length, excluded: d.rows.length - values.length }
}
export function qualityRecords(d: Dataset, field: string, issue: QualityIssue, summary: FieldSummary, page = 0, pageSize = 25) {
 if (!d.headers.includes(field) || summary.field !== field) throw new Error('字段或质量快照不匹配')
 if (!Number.isInteger(page) || page < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('分页参数无效')
 const records: QualityRecord[] = [], seen = new Set<string>(); let total = 0
 const iqr = summary.q1 === null || summary.q3 === null ? null : summary.q3 - summary.q1
 d.rows.forEach((row, index) => {
  const value = row[field], missing = value == null || !value.trim(), number = numberValue(value); let matches = false
  if (issue === 'duplicate') { const key = JSON.stringify(d.headers.map(header => row[header])); matches = seen.has(key); seen.add(key) }
  else if (issue === 'missing') matches = missing
  else if (issue === 'nonnumeric') matches = !missing && !Number.isFinite(number)
  // One primary class per cell: a whitespace-only value is missing, not whitespace.
  // This keeps the record list consistent with FieldSummary.whitespace.
  else if (issue === 'whitespace') matches = value != null && value.trim() !== '' && value !== value.trim()
  else if (issue === 'outlier') matches = summary.numeric >= 4 && iqr !== null && Number.isFinite(number) && (number < summary.q1! - 1.5 * iqr || number > summary.q3! + 1.5 * iqr)
  if (!matches) return
  if (total >= page * pageSize && records.length < pageSize) records.push({ index, sourceRecord: d.sourceRecords?.[index] ?? index + 2, location: d.origin?.locations[index] ?? String(d.sourceRecords?.[index] ?? index + 2), value })
  total++
 })
 return { total, records }
}
export function quantile(sorted: number[],p:number) {if(!sorted.length)return null;const i=(sorted.length-1)*p,a=Math.floor(i);const fraction=i-a;return sorted[a]*(1-fraction)+sorted[Math.ceil(i)]*fraction}
export function inspectQuality(d: Dataset): QualitySummary {
 const seen=new Set<string>();let duplicateRows=0
 for(const r of d.rows){const key=JSON.stringify(d.headers.map(h=>r[h]));if(seen.has(key))duplicateRows++;seen.add(key)}
 const fields=d.headers.map(field=>{
  let missing=0,whitespace=0;const values:number[]=[],frequency=new Map<string,number>()
  for(const r of d.rows){const raw=r[field];if(raw==null||!raw.trim()){missing++;continue}if(raw!==raw.trim())whitespace++;frequency.set(raw,(frequency.get(raw)??0)+1);const n=numberValue(raw);if(Number.isFinite(n))values.push(n)}
  values.sort((a,b)=>a-b);const q1=quantile(values,.25),q3=quantile(values,.75),iqr=q1==null||q3==null?null:q3-q1
  return {field,missing,numeric:values.length,unique:frequency.size,whitespace,min:values[0]??null,max:values.at(-1)??null,mean:values.length?values.reduce((a,b)=>a+b/values.length,0):null,median:quantile(values,.5),q1,q3,outliers:iqr==null||values.length<4?0:values.filter(n=>n<q1!-1.5*iqr||n>q3!+1.5*iqr).length,top:[...frequency].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([value,count])=>({value,count}))}
 });return {duplicateRows,fields}
}
export type CleaningSpec = { field: string; trim: boolean; numeric: boolean; markers: string; dropMissing: boolean; deduplicate: boolean }
export type CleaningPreview = { rows: Row[]; sourceRecords: number[]; changedCells: number; removedRows: number; failedNumeric: number; steps: string[]; examples: { record: number; before: string | null; after: string | null }[]; locations?: string[] }
export function previewCleaning(d:Dataset,s:CleaningSpec): CleaningPreview {
 if(!d.headers.includes(s.field))throw new Error('请选择需要处理的字段')
 const markers=new Set(s.markers.split('\n').filter(v=>v.length>0)),seen=new Set<string>(),output:Row[]=[],sourceRecords:number[]=[],locations:string[]=[],examples:CleaningPreview['examples']=[]
 let changedCells=0,removedRows=0,failedNumeric=0
 d.rows.forEach((r,i)=>{const next={...r},before=next[s.field];let after=before
  if(after!=null){if(s.trim)after=after.trim();if(markers.has(after))after=null
   if(s.numeric&&after!=null&&after.trim()){
    // Only explicitly selected, correctly grouped thousands separators may be removed.
    const trimmed=after.trim();if(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed))after=trimmed.replaceAll(',','')
    else if(!Number.isFinite(numberValue(trimmed)))failedNumeric++
   }
  }
  next[s.field]=after
  if(before!==after){changedCells++;if(examples.length<12)examples.push({record:d.sourceRecords?.[i]??i+2,before,after})}
  const key=JSON.stringify(d.headers.map(h=>next[h]));const remove=(s.dropMissing&&(after==null||!after.trim()))||(s.deduplicate&&seen.has(key));seen.add(key)
  if(remove){removedRows++;return}output.push(next);sourceRecords.push(d.sourceRecords?.[i]??i+2);if(d.origin)locations.push(d.origin.locations[i]??'')
 })
 const steps=[s.trim?'修剪「'+s.field+'」首尾空白':'',markers.size?'将「'+s.field+'」明确指定的缺失标记置空':'',s.numeric?'规范「'+s.field+'」严格千分位数字（无法识别的文本保留）':'',s.dropMissing?'删除「'+s.field+'」为空的记录':'',s.deduplicate?'删除完全相同的整行重复记录，保留第一条':''].filter(Boolean)
 return {rows:output,sourceRecords,changedCells,removedRows,failedNumeric,steps,examples,...(d.origin?{locations}:{})}
}
