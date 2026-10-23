import type { Database, SqlValue } from 'sql.js'
import { bucketLabel, compareLabels, numberValue, summarize, aggregateNames } from './data'
import type { Analysis, AnalysisScope, Dataset, Mapping } from './data'
import { validateScope, validateScopedMapping } from './follow-up'
import { exportColumnNames } from './sql-names'
import { linearTrend, timeIndex } from './statistics'
import type { TimeTrend } from './statistics'
export type ChartKind = 'line' | 'bar' | 'scatter' | 'heatmap' | 'table'
export type ExploreSpec = { kind: ChartKind; x: string; y: string; metric: string; aggregate: Mapping['aggregate']; filter: string; value: string; bucket: Mapping['timeBucket']; sort: 'label' | 'desc'; limit: number }
export type ExploreResult = { columns: string[]; rows: (string | number | null)[][]; rowIds: number[][]; sql: string; parameters: SqlValue[]; total: number; excluded: number; truncated: boolean; datasetHash: string; spec: ExploreSpec; trend?: TimeTrend }
export const col = (d: Dataset, key: string) => { const i = d.headers.indexOf(key); if (i < 0) throw new Error('字段不存在：' + key); return '"c' + i + '"' }
export function installSQL(db: Database, d: Dataset) {
 db.create_function('strict_number', (v: SqlValue) => { const n = numberValue(v === null ? null : String(v)); return Number.isFinite(n) ? n : null })
 db.create_function('compare_labels', (a: SqlValue,b: SqlValue) => compareLabels(String(a), String(b)))
 db.create_function('time_bucket', (v: SqlValue,b: SqlValue) => bucketLabel(String(v), String(b) as Mapping['timeBucket']))
 db.run('CREATE TABLE data ("_record" INTEGER PRIMARY KEY, ' + d.headers.map((_,i) => '"c'+i+'" TEXT').join(', ') + ')')
 // The console exposes original header names when they are unambiguous. The
 // compiled analysis SQL keeps using data.cN, so this view is additive.
 const readable = exportColumnNames(d, '_record')
 db.run('CREATE VIEW readable AS SELECT "_record" AS "_record"' + readable.map((name,i) => ', "c'+i+'" AS '+'"'+name.replaceAll('"','""')+'"').join('') + ' FROM data')
 db.run('BEGIN'); const stmt = db.prepare('INSERT INTO data VALUES (' + Array(d.headers.length+1).fill('?').join(',') + ')')
 try { d.rows.forEach((r,i) => stmt.run([i+2,...d.headers.map(h=>r[h] ?? null)])); db.run('COMMIT'); db.run('PRAGMA query_only = ON') } catch(e) { db.run('ROLLBACK'); throw e } finally { stmt.free() }
}
const preamble = (d: Dataset) => d.headers.map((h,i) => '-- c'+i+' = '+JSON.stringify(h)).join('\n') + '\n'
function rows(db: Database, sql: string, params: SqlValue[] = []) { const result = db.exec(sql,params); return result[0]?.values ?? [] }
function agg(metric: string, aggregate: Mapping['aggregate']) {
 const expressions: Partial<Record<Mapping['aggregate'], string>> = {sum:`SUM(strict_number(${metric}))`, average:`AVG(strict_number(${metric}))`, count:"COUNT(*)", distinct:`COUNT(DISTINCT CASE WHEN TRIM(${metric}) <> '' THEN ${metric} ELSE NULL END)`, min:`MIN(strict_number(${metric}))`, max:`MAX(strict_number(${metric}))`}
 const expression = expressions[aggregate]
 if (!expression) throw new Error('不支持的聚合方式'); return expression
}
const percentileP = { median: 0.5, p25: 0.25, p75: 0.75 } as const
type PercentileAggregate = keyof typeof percentileP
const isPercentile = (aggregate: Mapping['aggregate']): aggregate is PercentileAggregate => Object.hasOwn(percentileP, aggregate)
// Linear interpolation, the same definition as numpy.quantile / DuckDB quantile_cont.
// rank = 1 + (n - 1) * p; the lower and (when fractional) upper order statistics are averaged with the fraction.
const percentileExpression = () => `SUM(CASE WHEN is_lower = 1 THEN value ELSE 0 END) + (MAX(p_rank) - CAST(MAX(p_rank) AS INTEGER)) * (SUM(CASE WHEN is_lower = 0 THEN value ELSE 0 END) - SUM(CASE WHEN is_lower = 1 THEN value ELSE 0 END))`
const percentileCTE = (groups: string, join: string, p: number, valid: string, source: string) => `ranked AS (SELECT ${groups}, _record, strict_number(raw_value) AS value, ROW_NUMBER() OVER (PARTITION BY ${groups} ORDER BY strict_number(raw_value)) AS rn, COUNT(*) OVER (PARTITION BY ${groups}) AS n FROM ${source} WHERE ${valid}), bounds AS (SELECT ${groups}, n, 1.0 + (n - 1) * ${p.toFixed(2)} AS p_rank FROM ranked GROUP BY ${groups}, n), picked AS (SELECT ${groups.replace(/(^|, )/g, '$1r.')}, r._record, r.value, b.p_rank, CASE WHEN r.rn = CAST(b.p_rank AS INTEGER) THEN 1 ELSE 0 END AS is_lower FROM ranked r JOIN bounds b ON ${join} WHERE r.rn = CAST(b.p_rank AS INTEGER) OR (b.p_rank > CAST(b.p_rank AS INTEGER) AND r.rn = CAST(b.p_rank AS INTEGER) + 1))`

export function runAggregate(db: Database, d: Dataset, m: Mapping, question: string, id: number, rowScope?: AnalysisScope): Analysis {
 if(rowScope) { validateScope(d,rowScope); validateScopedMapping(m,rowScope) }
 const x=col(d,m.x), metric=col(d,m.metric)
 if (m.x===m.metric && m.aggregate!=='count') throw new Error('分组字段和指标不能是同一列，请重新选择。')
 if (m.from && m.to && compareLabels(m.from,m.to)>0) throw new Error('起点不能晚于终点。')
 const params: SqlValue[]=[m.timeBucket ?? 'none']; const predicates: string[]=[]
 if(rowScope) predicates.push('_record IN ('+rowScope.rowIds.join(',')+')')
 if (m.filter) { if(!m.value) throw new Error('请选择筛选值'); predicates.push(col(d,m.filter)+' = ?'); params.push(m.value) }
 for(const c of m.conditions ?? []) { if(!['eq','gte','lte'].includes(c.operator)) throw new Error('无效筛选条件'); const ccol=col(d,c.field); predicates.push(c.operator==='eq' ? ccol+' = ?' : ccol+' IS NOT NULL AND compare_labels('+ccol+', ?) '+(c.operator==='gte'?'>=':'<=')+' 0'); params.push(c.value) }
 const cte=`WITH scoped AS (SELECT _record, ${x} AS raw_label, ${metric} AS raw_value, CASE WHEN TRIM(COALESCE(${x}, '')) <> '' THEN time_bucket(${x}, ?) ELSE NULL END AS label FROM data${predicates.length ? ' WHERE ' + predicates.join(' AND ') : ''}), selected AS (SELECT * FROM scoped WHERE label IS NOT NULL`
 let scope=cte
 if(m.from) {scope+=' AND compare_labels(label, ?) >= 0';params.push(m.from)}
 if(m.to) {scope+=' AND compare_labels(label, ?) <= 0';params.push(m.to)}
 scope+=')'
 if (m.rate) {
  const {successValue,eligibleValues}=m.rate
  if(m.x===m.metric||m.aggregate!=='count'||m.unit!=='%'||!successValue?.trim()||!Array.isArray(eligibleValues)||!eligibleValues.length||eligibleValues.length>16||eligibleValues.some(v=>typeof v!=='string'||!v.trim())||new Set(eligibleValues).size!==eligibleValues.length||!eligibleValues.includes(successValue)) throw new Error('比例必须明确分子原值、分母取值集合，并使用 count 与 %。')
  if(m.filter===m.metric||m.conditions?.some(c=>c.field===m.metric)) throw new Error('比例不能预先筛选结果列，避免分母失真。')
  const scored=scope+', scored AS (SELECT *, CASE WHEN raw_value = ? THEN 1 ELSE 0 END AS success, CASE WHEN raw_value IN ('+eligibleValues.map(()=>'?').join(',')+') THEN 1 ELSE 0 END AS eligible FROM selected)'
  const rateParams=[...params,successValue,...eligibleValues]
  const sql=scored+' SELECT label, SUM(success) AS numerator, SUM(eligible) AS denominator, COUNT(*) - SUM(eligible) AS excluded, 100.0 * SUM(success) / NULLIF(SUM(eligible),0) AS value, GROUP_CONCAT(CASE WHEN eligible=1 THEN _record END) AS source_records, GROUP_CONCAT(_record) AS all_records FROM scored GROUP BY label LIMIT 201'
  const result=rows(db,sql,rateParams)
  if(result.length>200) throw new Error('分组超过 200 个，请缩小范围。')
  const ids=(v:SqlValue)=>v===null?[]:String(v).split(',').map(Number)
  const points=result.filter(r=>r[4]!==null).map(r=>({label:String(r[0]),value:Number(r[4]),rowIds:ids(r[5]),scopeRowIds:ids(r[6]),excludedRowIds:ids(r[6]).filter(id=>d.rows[id-2][m.metric]===null||!eligibleValues.includes(d.rows[id-2][m.metric]!)),rate:{numerator:Number(r[1]),denominator:Number(r[2]),excluded:Number(r[3])}})).sort((a,b)=>compareLabels(a.label,b.label))
  if(!points.length) throw new Error('比例分母为零：没有符合分母口径的记录，无法计算，不会显示为 0%。')
  const unavailableGroups=result.filter(r=>r[4]===null).map(r=>({label:String(r[0]),excluded:Number(r[3]),rowIds:ids(r[6])}))
  const stats=rows(db,scope+' SELECT (SELECT COUNT(*) FROM selected), (SELECT COUNT(*) FROM scoped WHERE label IS NULL)',params)[0]
  const numerator=points.reduce((n,p)=>n+p.rate.numerator,0),denominator=points.reduce((n,p)=>n+p.rate.denominator,0),excluded=result.reduce((n,r)=>n+Number(r[3]),0)
  const rateSummary={numerator,denominator,excluded,value:100*numerator/denominator}
  return {scope:rowScope ? structuredClone(rowScope) : undefined,id,question,mapping:structuredClone(m),points,unavailableGroups,rateSummary,usedRows:denominator,matched:Number(stats[0]),skipped:Number(stats[1])+excluded,createdAt:new Date().toISOString(),datasetHash:d.fingerprint,finding:'当前范围总体比例 '+rateSummary.value.toFixed(2)+'%；分子 '+numerator+' / 分母 '+denominator+'，排除未知或缺失结果 '+excluded+' 条。分组差异仅表示描述性关联。',sql:preamble(d)+sql,parameters:rateParams as (string|number|null)[],operations:['SQLite / sql.js 真实参数化只读查询','比例 = '+JSON.stringify(successValue)+' 记录数 / '+JSON.stringify(eligibleValues)+' 记录数 × 100','总体比例使用总分子 / 总分母，不平均分组比例','分母为零的分组另列为无法计算，不显示为 0%','数据快照：'+d.fingerprint]}
 }
 const numeric=!['count','distinct'].includes(m.aggregate)
 const valid=numeric?'strict_number(raw_value) IS NOT NULL':m.aggregate==='distinct'?"NULLIF(TRIM(raw_value), '') IS NOT NULL":'1=1'
 let sql=''
 if(isPercentile(m.aggregate)) sql=scope+', '+percentileCTE('label','b.label = r.label',percentileP[m.aggregate],valid,'selected')+', records AS (SELECT label, GROUP_CONCAT(_record) AS all_records FROM ranked GROUP BY label) SELECT picked.label, '+percentileExpression()+' AS value, rec.all_records AS source_records FROM picked JOIN records rec ON rec.label = picked.label GROUP BY picked.label LIMIT 201'
 else sql=scope+' SELECT label, '+agg('raw_value',m.aggregate)+' AS value, GROUP_CONCAT(_record) AS source_records FROM selected WHERE '+valid+' GROUP BY label LIMIT 201'
 const result=rows(db,sql,params)
 if(!result.length) throw new Error('当前口径没有有效数值。请检查字段、筛选值和范围；缺失值不会按 0 处理。')
 if(result.length>200) throw new Error('分组超过 200 个，请缩小范围或选择更粗的分组。')
 const allGroupRows=new Map(rows(db,scope+' SELECT label, GROUP_CONCAT(_record) FROM selected GROUP BY label',params).map(r=>[String(r[0]),String(r[1]).split(',').map(Number)]))
 const points=result.map(r=>({label:String(r[0]),value:Number(r[1]),rowIds:String(r[2]).split(',').map(Number),scopeRowIds:allGroupRows.get(String(r[0]))})).sort((a,b)=>compareLabels(a.label,b.label))
 if(points.some(p=>!Number.isFinite(p.value))) throw new Error('计算结果超出有效数值范围。')
 let trend: TimeTrend | undefined
 if((m.timeBucket==='year'||m.timeBucket==='month') && points.length>=3) {
  const period=m.timeBucket
  const fitted=linearTrend(points.map(p=>{const x=timeIndex(p.label,period);return {x:x??NaN,y:p.value}}).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))
  if(fitted) trend={...fitted,period}
 }
 const stats=rows(db,scope+' SELECT (SELECT COUNT(*) FROM selected), (SELECT COUNT(*) FROM scoped WHERE label IS NULL) + (SELECT COUNT(*) FROM selected WHERE NOT ('+valid+'))',params)[0]
 return {scope:rowScope ? structuredClone(rowScope) : undefined,id,question,mapping:structuredClone(m),points,usedRows:points.reduce((n,p)=>n+p.rowIds.length,0),matched:Number(stats[0]),skipped:Number(stats[1]),createdAt:new Date().toISOString(),datasetHash:d.fingerprint,finding:summarize(points,m.unit),sql:preamble(d)+sql,parameters:params as (string|number|null)[],operations:['SQLite / sql.js 真实执行参数化只读查询', '数据快照：'+d.fingerprint, aggregateNames[m.aggregate]+'；空值不替换为零', 'SQL 列映射及参数见下方，来源记录号对应当前快照'],...(trend?{trend}:{})}
}
export function runExplore(db: Database,d: Dataset,s: ExploreSpec): ExploreResult {
 if(!['line','bar','scatter','heatmap','table'].includes(s.kind) || !['label','desc'].includes(s.sort) || !Number.isInteger(s.limit) || s.limit<1 || s.limit>200) throw new Error('图表配置无效')
 const x=col(d,s.x),params:SqlValue[]=[],filters:string[]=[]
 if(s.filter){filters.push(col(d,s.filter)+' = ?');params.push(s.value)}
 let sql='', columns:string[]=[], valid=''
 const filtered='FROM data'+(filters.length?' WHERE '+filters.join(' AND '):'')
 const total=Number(rows(db,'SELECT COUNT(*) '+filtered,params)[0][0])
 if(s.kind==='scatter') {
  const y=col(d,s.y); if(s.x===s.y)throw new Error('散点图需要选择两个不同的数值字段')
  valid='strict_number('+x+') IS NOT NULL AND strict_number('+y+') IS NOT NULL'
  sql='SELECT strict_number('+x+'), strict_number('+y+'), CAST(_record AS TEXT) '+filtered+(filters.length?' AND ':' WHERE ')+valid+' ORDER BY _record LIMIT '+(s.limit+1);columns=[s.x,s.y]
 }else{
  const metric=col(d,s.metric);const label='time_bucket('+x+', ?)';params.unshift(s.bucket??'none')
  const numeric=!['count','distinct'].includes(s.aggregate)
  valid=`NULLIF(TRIM(${x}), '') IS NOT NULL`+(numeric?` AND strict_number(${metric}) IS NOT NULL`:s.aggregate==='distinct'?` AND NULLIF(TRIM(${metric}), '') IS NOT NULL`:'')
  let group=label;columns=[s.x,aggregateNames[s.aggregate]+' · '+s.metric]
  if(s.kind==='heatmap'){const y=col(d,s.y);valid+=` AND NULLIF(TRIM(${y}), '') IS NOT NULL`;group+=', '+y;columns=[s.x,s.y,columns[1]]}
  if(isPercentile(s.aggregate)){
   const ycol=col(d,s.y),pgroup=s.kind==='heatmap'?'label, '+ycol:'label'
   const join=s.kind==='heatmap'?'b.label = r.label AND b.'+ycol+' = r.'+ycol:'b.label = r.label'
   const recordJoin=s.kind==='heatmap'?'rec.label = picked.label AND rec.'+ycol+' = picked.'+ycol:'rec.label = picked.label'
   const validInBase='label IS NOT NULL AND strict_number(raw_value) IS NOT NULL'+(s.kind==='heatmap'?` AND NULLIF(TRIM(${ycol}), '') IS NOT NULL`:'')
   const base='SELECT '+label+' AS label'+(s.kind==='heatmap'?', '+ycol:'')+', _record, '+metric+' AS raw_value '+filtered
   const qualified=pgroup.split(', ').map(part=>'picked.'+part).join(', ')
   sql='WITH base AS ('+base+'), '+percentileCTE(pgroup,join,percentileP[s.aggregate],validInBase,'base')+', records AS (SELECT '+pgroup+', GROUP_CONCAT(_record) AS all_records FROM ranked GROUP BY '+pgroup+') SELECT '+qualified+', '+percentileExpression()+' AS value, rec.all_records FROM picked JOIN records rec ON '+recordJoin+' GROUP BY '+qualified+' ORDER BY '+(s.sort==='desc'?'value DESC, 1':'1')+' LIMIT '+(s.limit+1)
  }else sql='SELECT '+group+', '+agg(metric,s.aggregate)+' AS value, GROUP_CONCAT(_record) '+filtered+(filters.length?' AND ':' WHERE ')+valid+' GROUP BY '+(s.kind==='heatmap'?'1,2':'1')+' ORDER BY '+(s.sort==='desc'?'value DESC, 1':'1')+' LIMIT '+(s.limit+1)
 }
 const output=rows(db,sql,params);const truncated=output.length>s.limit; const limited=output.slice(0,s.limit)
 if(limited.some(r=>r.slice(0,-1).some(v=>typeof v==='number'&&!Number.isFinite(v))))throw new Error('计算结果超出有效数值范围，请缩小范围或核对单位')
 // Count valid rows independently; do not confuse display limits with excluded data.
 const validCount=Number(rows(db,'SELECT COUNT(*) '+filtered+(filters.length?' AND ':' WHERE ')+valid,s.filter?[s.value]:[])[0][0])
 let trend: TimeTrend | undefined
 if (s.kind==='line' && (s.bucket==='year' || s.bucket==='month')) {
  const period=s.bucket
  const fitted=linearTrend(limited.map(r=>{const x=timeIndex(String(r[0]??''),period);const y=Number(r[1]);return {x:x??NaN,y}}).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))
  if (fitted) trend={...fitted,period}
 }
 return {columns,rows:limited.map(r=>r.slice(0,-1) as (string|number|null)[]),rowIds:limited.map(r=>String(r.at(-1)).split(',').map(Number)),sql:preamble(d)+sql,parameters:params,total,excluded:total-validCount,truncated,datasetHash:d.fingerprint,spec:structuredClone(s),...(trend?{trend}:{})}
}
export type ComparisonSpec={period:string;dimension:string;metric:string;aggregate:'sum'|'count';baselineFrom:string;baselineTo:string;currentFrom:string;currentTo:string}
export type ComparisonResult={spec:ComparisonSpec;sql:string;parameters:SqlValue[];groups:{label:string;baseline:number|null;current:number|null;delta:number|null;rate:number|null;contribution:number|null;baselineIds:number[];currentIds:number[]}[];baselineTotal:number|null;currentTotal:number|null;delta:number|null;excluded:number;comparable:boolean;datasetHash:string}
export function runCompare(db:Database,d:Dataset,s:ComparisonSpec):ComparisonResult{
 if(!['sum','count'].includes(s.aggregate))throw new Error('对比诊断仅支持可加的求和与记录数')
 if([s.baselineFrom,s.baselineTo,s.currentFrom,s.currentTo].some(v=>!v.trim()))throw new Error('请填写两个期间的起止边界')
 if(compareLabels(s.baselineFrom,s.baselineTo)>0||compareLabels(s.currentFrom,s.currentTo)>0)throw new Error('期间起点不能晚于终点')
 if(!(compareLabels(s.baselineTo,s.currentFrom)<0||compareLabels(s.currentTo,s.baselineFrom)<0))throw new Error('两个期间不能重叠')
 const time=col(d,s.period),dimension=col(d,s.dimension),metric=col(d,s.metric)
 const params=[s.baselineFrom,s.baselineTo,s.currentFrom,s.currentTo]
 const cte=`WITH scoped AS (SELECT _record, ${dimension} AS label, ${metric} AS raw_value, CASE WHEN ${time} IS NOT NULL AND compare_labels(${time}, ?) >= 0 AND compare_labels(${time}, ?) <= 0 THEN 'baseline' WHEN ${time} IS NOT NULL AND compare_labels(${time}, ?) >= 0 AND compare_labels(${time}, ?) <= 0 THEN 'current' ELSE NULL END AS period FROM data), selected AS (SELECT * FROM scoped WHERE period IS NOT NULL)`
 const valid=`NULLIF(TRIM(label), '') IS NOT NULL`+(s.aggregate==='sum'?' AND strict_number(raw_value) IS NOT NULL':'')
 const measure=(period:string)=>s.aggregate==='sum'?`SUM(CASE WHEN period='${period}' THEN strict_number(raw_value) ELSE NULL END)`:`COUNT(CASE WHEN period='${period}' THEN 1 ELSE NULL END)`
 const sql=cte+` SELECT label, ${measure('baseline')} AS baseline, ${measure('current')} AS current, GROUP_CONCAT(CASE WHEN period='baseline' THEN _record END), GROUP_CONCAT(CASE WHEN period='current' THEN _record END) FROM selected WHERE ${valid} GROUP BY label LIMIT 201`
 const output=rows(db,sql,params)
 if(!output.length)throw new Error('两个期间内没有可用数据，请核对期间字段、范围和指标')
 if(output.length>200)throw new Error('对比维度超过 200 个分组，请选择更粗粒度的维度')
 const total=rows(db,cte+` SELECT ${measure('baseline')}, ${measure('current')}, (SELECT COUNT(*) FROM selected WHERE NOT (${valid})), COUNT(CASE WHEN period='baseline' THEN 1 END), COUNT(CASE WHEN period='current' THEN 1 END) FROM selected WHERE ${valid}`,params)[0]
 const baselineTotal=Number(total[3])===0?null:Number(total[0]),currentTotal=Number(total[4])===0?null:Number(total[1]),delta=baselineTotal===null||currentTotal===null?null:currentTotal-baselineTotal
 const comparable=output.every(r=>r[3]!==null&&r[4]!==null)
 const groups=output.map(r=>{const baseline=r[3]===null?null:Number(r[1]),current=r[4]===null?null:Number(r[2]),diff=baseline===null||current===null?null:current-baseline;return {label:String(r[0]),baseline,current,delta:diff,rate:diff===null||baseline===null||baseline<=0?null:diff/baseline,contribution:!comparable||diff===null||delta===null||delta===0?null:diff/delta,baselineIds:r[3]===null?[]:String(r[3]).split(',').map(Number),currentIds:r[4]===null?[]:String(r[4]).split(',').map(Number)}}).sort((a,b)=>(a.delta??Infinity)-(b.delta??Infinity))
 if([baselineTotal,currentTotal,delta,...groups.flatMap(g=>[g.baseline,g.current,g.delta,g.rate,g.contribution])].some(v=>v!==null&&!Number.isFinite(v)))throw new Error('对比结果超出有效数值范围')
 return {spec:structuredClone(s),sql:preamble(d)+sql,parameters:params,groups,baselineTotal,currentTotal,delta,excluded:Number(total[2]),comparable,datasetHash:d.fingerprint}
}
