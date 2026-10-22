import { beforeAll, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseCSV } from '../src/data'
import type { AnalysisScope, Dataset, Mapping } from '../src/data'
import { installSQL, runAggregate } from '../src/analytics'
import { createFollowUpScope, scopeContext, validateScope, rateBaseline } from '../src/follow-up'
import { bundleHTML } from '../src/bundle-report'
import { evidenceFacts, mergeRepairPlan } from '../src/ai'
import type { PlanResponse } from '../src/ai'
let SQL: Awaited<ReturnType<typeof initSqlJs>>
const raw = readFileSync(resolve('tests/fixtures/uci-online-shoppers.csv'),'utf8')
const data: Dataset = { ...parseCSV(raw), title:'UCI 真实电商访问', sourceUrl:'https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset', fingerprint:createHash('sha256').update(raw).digest('hex'), loadedAt:'2026-10-19', isPublic:false }
const mapping:Mapping={x:'VisitorType',metric:'Revenue',aggregate:'count',unit:'%',filter:'',value:'',from:'',to:'',rate:{successValue:'TRUE',eligibleValues:['TRUE','FALSE']}}
beforeAll(async()=>{SQL=await initSqlJs({locateFile:f=>resolve('node_modules/sql.js/dist',f)})})
function calculate(m=mapping,d=data,scope?:AnalysisScope,id=1){const db=new SQL.Database();try{installSQL(db,d);return runAggregate(db,d,m,'真实分组追问',id,scope)}finally{db.close()}}
function scoped(d=data){return createFollowUpScope(d,calculate(mapping,d),'New_Visitor')}
it('模型未筛选原分组时，SQL仍只计算1694条新访客访问，分子422，与全表分母12330区分',()=>{
 const scope=scoped();const result=calculate({...mapping,x:'Weekend'},data,scope,2)
 expect(result.rateSummary).toEqual({numerator:422,denominator:1694,excluded:0,value:100*422/1694})
 expect(result.points.flatMap(p=>p.rowIds).sort((a,b)=>a-b)).toEqual(scope.rowIds)
 expect(result.points.every(p=>p.rowIds.every(id=>data.rows[id-2].VisitorType==='New_Visitor'))).toBe(true)
 expect(result.sql).toContain('_record IN (');expect(result.scope).toEqual(scope)
})
it('范围内可以进一步筛选并继续建立子范围，不能带入其他访客记录',()=>{
 const scope=scoped();const m={...mapping,x:'TrafficType',conditions:[{field:'Weekend',operator:'eq' as const,value:'TRUE'}]}
 const result=calculate(m,data,scope,2);const expected=data.rows.flatMap((r,i)=>r.VisitorType==='New_Visitor'&&r.Weekend==='TRUE'?[i+2]:[])
 expect(result.matched).toBe(expected.length)
 const child=createFollowUpScope(data,result,result.points[0].label)
 expect(child.parentAnalysisId).toBe(2);expect(child.rowIds.every(id=>expected.includes(id))).toBe(true)
 const again=calculate({...mapping,x:'Month'},data,child,3)
 expect(again.points.flatMap(p=>p.rowIds).sort((a,b)=>a-b)).toEqual(child.rowIds)
})
it('机制验证：遮蔽一个真实记录的结果字段后，追问仍保留该行作为分母质量核查对象',()=>{
 const id=data.rows.findIndex(r=>r.VisitorType==='New_Visitor')
 const masked={...data,rows:data.rows.map((r,i)=>i===id?{...r,Revenue:null}:r)}
 const parent=calculate(mapping,masked),scope=createFollowUpScope(masked,parent,'New_Visitor')
 expect(scope.rowIds.length).toBe(1694);expect(scope.rowIds).toContain(id+2)
 const result=calculate({...mapping,x:'Weekend'},masked,scope,2)
 expect(result.rateSummary?.denominator).toBe(1693);expect(result.rateSummary?.excluded).toBe(1)
 const count=calculate({...mapping,x:'Weekend',rate:undefined,unit:'条'},masked,scope,3)
 expect(count.points.reduce((n,p)=>n+p.value,0)).toBe(1694)
})
it('机制验证：原指标有无效值时，选择完整分组包含该行，不把旧指标有效行误当全部范围',()=>{
 const id=data.rows.findIndex(r=>r.VisitorType==='New_Visitor')
 const masked={...data,rows:data.rows.map((r,i)=>i===id?{...r,PageValues:null}:r)}
 const parent=calculate({...mapping,metric:'PageValues',aggregate:'average',rate:undefined,unit:''},masked)
 const p=parent.points.find(p=>p.label==='New_Visitor')!
 expect(p.rowIds.length).toBe(1693);expect(p.scopeRowIds?.length).toBe(1694)
 expect(createFollowUpScope(masked,parent,p.label).rowIds).toContain(id+2)
})
it('真实SEC日期按年分桶后，可切换到指标字段分组，保留2022年的完整匹配范围',()=>{
 const raw=readFileSync(resolve('tests/fixtures/evaluation/financial/apple-sec-company-facts-fy2021-2023.csv'),'utf8')
 const d={...data,...parseCSV(raw),fingerprint:createHash('sha256').update(raw).digest('hex')}
 const m:Mapping={x:'end',metric:'value',aggregate:'count',unit:'条',filter:'',value:'',from:'',to:'',timeBucket:'year'}
 const parent=calculate(m,d),scope=createFollowUpScope(d,parent,'2022')
 const child=calculate({...m,x:'metric',timeBucket:'none'},d,scope,2)
 expect(child.points.reduce((n,p)=>n+p.value,0)).toBe(d.rows.filter(r=>r.end?.startsWith('2022')).length)
 expect(child.points.flatMap(p=>p.rowIds).every(id=>d.rows[id-2].end?.startsWith('2022'))).toBe(true)
})
it('拒绝旧快照、重新载入前的范围、空范围、越界、重复与非整数来源记录',()=>{
 const scope=scoped()
 expect(()=>validateScope({...data,fingerprint:'changed'},scope)).toThrow('旧数据')
 expect(()=>validateScope({...data,loadedAt:'later'},scope)).toThrow('旧数据')
 for(const rowIds of [[],[1],[12332],[2,2],[2.2]])expect(()=>validateScope(data,{...scope,rowIds})).toThrow('来源记录无效')
 expect(()=>calculate({...mapping,x:'Weekend'},{...data,fingerprint:'changed'},scope)).toThrow('旧数据')
})
it('比例追问不能悄悄把分母改成仅购买记录；同一口径变更取值顺序正常计算',()=>{
 const scope=scoped()
 expect(()=>calculate({...mapping,x:'Weekend',rate:{successValue:'TRUE',eligibleValues:['TRUE']}},data,scope)).toThrow('分子或分母')
 expect(calculate({...mapping,x:'Weekend',rate:{successValue:'TRUE',eligibleValues:['FALSE','TRUE']}},data,scope).rateSummary?.denominator).toBe(1694)
})
it('修正计划保留锁定范围；解读与导出标明来源、基准值和完整范围索引',()=>{
 const scope=scoped(),m={...mapping,x:'Weekend'},result=calculate(m,data,scope,2)
 result.ai={goal:'范围追问',taskId:'weekend',taskTitle:'范围内周末转化率',model:'explicit-test',plannedAt:'2026-10-19'}
 const response:PlanResponse={scope,datasetHash:data.fingerprint,model:'explicit-test',providerName:'明确测试计划',generatedAt:'2026-10-19',plan:{goal:'范围追问',scene:'电商',grain:'访问',fieldRoles:[],assumptions:[],questions:[],limitations:['描述性'],tasks:[{id:'weekend',title:'范围内周末转化率',rationale:'比较',chart:'bar',mapping:m}]}}
 const repaired=mergeRepairPlan(response,{...response,scope:undefined},[{taskId:'weekend',title:'失败任务',error:'明确测试错误'}]);expect(repaired.scope).toEqual(scope)
 const facts=evidenceFacts(response.plan,[result]);expect(facts.every(f=>f.text.includes('锁定匹配行数=1694'))).toBe(true)
 expect(scopeContext(scope)).not.toContain('rowIds')
 const html=bundleHTML(data,{response,results:[result],facts,review:null,failures:[]})
 expect(html).toContain('分组追问');expect(html).toContain('New_Visitor');expect(html).toContain('追问范围完整快照记录索引');expect(html).toContain('422');expect(html).toContain('1694')
})

it('比例差值仅用于相同指标和相同分母定义的可比结果，单位为百分点',()=>{
 const scope=scoped(),result=calculate({...mapping,x:'Weekend'},data,scope,2)
 expect(rateBaseline(result)).toBeCloseTo(100*422/1694,10)
 const nonWeekend=result.points.find(p=>p.label==='FALSE')!
 expect(nonWeekend.value-rateBaseline(result)!).toBeCloseTo(100*317/1215-100*422/1694,10)
 expect(rateBaseline({...result,mapping:{...result.mapping,metric:'different'}})).toBeUndefined()
 expect(rateBaseline({...result,mapping:{...result.mapping,rate:undefined}})).toBeUndefined()
 expect(rateBaseline({...result,scope:undefined})).toBeUndefined()
})
