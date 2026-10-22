import {beforeAll,expect,it} from 'vitest'
import initSqlJs from 'sql.js'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {parseCSV} from '../src/data'
import type {Dataset,Mapping} from '../src/data'
import {installSQL,runAggregate} from '../src/analytics'
import {chartDomain,orderPoints,analysisReference,tickPrecision} from '../src/chart-model'
import {createFollowUpScope} from '../src/follow-up'
let SQL:Awaited<ReturnType<typeof initSqlJs>>
const data:Dataset={...parseCSV(readFileSync(resolve('tests/fixtures/uci-online-shoppers.csv'),'utf8')),title:'UCI 原始数据',sourceUrl:'',fingerprint:'b3055ee355f59134d851d32641183cb4a8b45def7124d2f50442a042f358e0d9',loadedAt:'2026-10-19',isPublic:false}
const mapping:Mapping={x:'VisitorType',metric:'Revenue',aggregate:'count',unit:'%',filter:'',value:'',from:'',to:'',rate:{successValue:'TRUE',eligibleValues:['TRUE','FALSE']}}
beforeAll(async()=>{SQL=await initSqlJs({locateFile:f=>resolve('node_modules/sql.js/dist',f)})})
function calculate(){const db=new SQL.Database();try{installSQL(db,data);return runAggregate(db,data,mapping,'真实分组比例',1)}finally{db.close()}}
it('排序保留真实分组与来源对象，不能错配点击证据或改写输入',()=>{const r=calculate(),before=r.points.map(p=>p.label);const sorted=orderPoints(r.points,'asc');expect(sorted.map(p=>p.label)).toEqual(['Returning_Visitor','Other','New_Visitor']);expect(r.points.map(p=>p.label)).toEqual(before);expect(sorted[2]).toBe(r.points.find(p=>p.label==='New_Visitor'));expect(sorted[2].scopeRowIds).toHaveLength(1694)})
it('参考线使用真实加权总体比例，追问时只继承兼容口径的来源比例',()=>{const r=calculate();expect(analysisReference(r)?.value).toBeCloseTo(1908/12330*100,10);expect(analysisReference(r)?.value).not.toBeCloseTo(r.points.reduce((n,p)=>n+p.value,0)/r.points.length,2);r.scope=createFollowUpScope(data,r,'New_Visitor');expect(analysisReference(r)?.value).toBeCloseTo(422/1694*100,10);r.mapping={...r.mapping,unit:'不兼容单位'};expect(analysisReference(r)?.label).toBe('当前范围总体比例')})
it('坐标包含零、所有真实组和合法参考线；负数与全零为明确数值边界测试',()=>{const r=calculate();const domain=chartDomain(r.points.map(p=>p.value),40);expect(domain.min).toBe(0);expect(domain.max).toBeGreaterThanOrEqual(40);expect(domain.ticks.every(Number.isFinite)).toBe(true);const negative=chartDomain([-8,-2]);expect(negative.min).toBeLessThanOrEqual(-8);expect(negative.max).toBe(0);const zero=chartDomain([0,0]);expect(zero.min).toBe(0);expect(zero.max).toBeGreaterThan(0)})

it('小数刻度与缩放后刻度保留实际精度，不把2.5标成3',()=>{
 expect(tickPrecision(2.5)).toBe(1)
 expect(tickPrecision(.25)).toBe(2)
 expect(tickPrecision(.0000025)).toBe(7)
 expect(tickPrecision(25)).toBe(0)
 const d=chartDomain([1,9])
 expect(d.ticks).toContain(2.5)
 const precision=tickPrecision(d.ticks[1]-d.ticks[0])
 expect(d.ticks.map(v=>Number(v.toFixed(precision)))).toEqual(d.ticks)
})
