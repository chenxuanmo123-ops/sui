import { beforeAll, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parseCSV } from '../src/data'
import type { Dataset, Mapping } from '../src/data'
import { installSQL, runAggregate } from '../src/analytics'
import { createFollowUpScope } from '../src/follow-up'
import { decodeWorkspace } from '../src/workspace'
import type { WorkspaceSnapshot } from '../src/workspace'
let SQL: Awaited<ReturnType<typeof initSqlJs>>
const raw=readFileSync(resolve('tests/fixtures/uci-online-shoppers.csv'),'utf8')
const dataset:Dataset={...parseCSV(raw),title:'UCI原始电商访问',sourceUrl:'',fingerprint:createHash('sha256').update(raw).digest('hex'),loadedAt:'2026-10-19',isPublic:false}
const mapping:Mapping={x:'VisitorType',metric:'Revenue',aggregate:'count',unit:'%',filter:'',value:'',from:'',to:'',rate:{successValue:'TRUE',eligibleValues:['TRUE','FALSE']}}
beforeAll(async()=>{SQL=await initSqlJs({locateFile:f=>resolve('node_modules/sql.js/dist',f)})})
function snapshot():WorkspaceSnapshot{
 const db=new SQL.Database()
 try{
  installSQL(db,dataset)
  const parent=runAggregate(db,dataset,mapping,'按访客类型比较',1)
  const scope=createFollowUpScope(dataset,parent,'New_Visitor')
  const child=runAggregate(db,dataset,{...mapping,x:'Weekend'},'新访客内按周末比较',2,scope)
  const response={datasetHash:dataset.fingerprint,scope,model:'explicit-validation-fixture',providerName:'结构恢复测试，不评价模型',generatedAt:'2026-10-19T00:00:00Z',plan:{goal:'范围恢复',scene:'描述比较',grain:'一次访问',fieldRoles:[],assumptions:[],questions:[],limitations:[],tasks:[]}}
  return {version:1,savedAt:'2026-10-19T00:00:00Z',state:{dataset,preparationHistory:[],fieldRoles:{Browser:'measure'},history:[parent,child],bundles:[{id:'child',response,results:[structuredClone(child)],facts:[],review:null,failures:[]}],currentBundleKey:'child',activeId:2,mapping:child.mapping,question:child.question,chartKind:'bar',view:'workspace',dataTab:'result',inspectorOpen:false,exploreSession:null,compareSession:null}}
 }finally{db.close()}
}
it('真实SQL结果、分组范围、原始快照和来源基准完整恢复，引用规范到历史结果',()=>{
 const restored=decodeWorkspace(snapshot()).state
 expect(restored.history[1].rateSummary?.denominator).toBe(1694)
 expect(restored.bundles[0].results[0]).toBe(restored.history[1])
 expect(restored.history[1].scope?.baseline.counts?.numerator).toBe(422)
 expect(restored.dataset.loadedAt).toBe(dataset.loadedAt)
})
it('损坏版本、表头、行结构与无效活动引用拒绝恢复',()=>{
 for(const change of [(s:WorkspaceSnapshot)=>{s.version=2 as 1},(s:WorkspaceSnapshot)=>{s.state.dataset.headers=['x','x']},(s:WorkspaceSnapshot)=>{s.state.dataset.rows[0]={}},(s:WorkspaceSnapshot)=>{s.state.activeId=999},(s:WorkspaceSnapshot)=>{s.state.currentBundleKey='missing'}]){
  const value=structuredClone(snapshot());change(value);expect(()=>decodeWorkspace(value)).toThrow('保留旧记录')
 }
})
it('数据指纹、分组加载快照、索引和bundle关联不一致时拒绝混合恢复',()=>{
 for(const change of [(s:WorkspaceSnapshot)=>{s.state.history[1].datasetHash='0'.repeat(64)},(s:WorkspaceSnapshot)=>{s.state.history[1].scope!.loadedAt='2025-01-01'},(s:WorkspaceSnapshot)=>{s.state.history[1].scope!.rowIds=[99999]},(s:WorkspaceSnapshot)=>{s.state.bundles[0].response.scope=undefined},(s:WorkspaceSnapshot)=>{s.state.history.push(s.state.history[0])}]){
  const value=structuredClone(snapshot());change(value);expect(()=>decodeWorkspace(value)).toThrow('保留旧记录')
 }
})
it('字段角色纠正随工作区恢复；旧快照按自动判断处理，无效纠正拒绝恢复',()=>{
 expect(decodeWorkspace(snapshot()).state.fieldRoles).toEqual({Browser:'measure'})
 const legacy=snapshot();delete (legacy.state as {fieldRoles?:unknown}).fieldRoles
 expect(decodeWorkspace(legacy).state.fieldRoles).toEqual({})
 for(const change of [(s:WorkspaceSnapshot)=>{s.state.fieldRoles={missing:'measure'}},(s:WorkspaceSnapshot)=>{s.state.fieldRoles={Browser:'amount' as never}}]){
  const value=structuredClone(snapshot());change(value);expect(()=>decodeWorkspace(value)).toThrow('保留旧记录')
 }
})
it('探索/对比结果旧快照拒绝恢复，撤销数据与来源声明仍保留',()=>{
 const value=snapshot();value.state.preparationHistory=[structuredClone(dataset)];value.state.dataset.sourceNotes={notes:'真实数据验收备注'}
 expect(decodeWorkspace(value).state.preparationHistory[0].fingerprint).toBe(dataset.fingerprint)
 expect(decodeWorkspace(value).state.dataset.sourceNotes?.notes).toBe('真实数据验收备注')
 value.state.exploreSession={datasetHash:'0'.repeat(64)} as never
 expect(()=>decodeWorkspace(value)).toThrow('保留旧记录')
})
