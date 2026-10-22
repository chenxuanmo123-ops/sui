import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database, SqlJsStatic } from 'sql.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCSV } from '../src/data'
import type { Dataset, Mapping } from '../src/data'
import { installSQL, runAggregate, runExplore, runCompare } from '../src/analytics'
import type { ExploreSpec, ComparisonSpec } from '../src/analytics'
import { prepareTable } from '../src/importers'
import type { ImportTable } from '../src/importers'
import { inspectQuality, previewCleaning } from '../src/preparation'
let SQL:SqlJsStatic
const raw=readFileSync(resolve('tests/fixtures/owid-China-2015-2022.csv'),'utf8')
const data:Dataset={...parseCSV(raw),title:'OWID 真实中国年度子集',sourceUrl:'https://github.com/owid/energy-data',loadedAt:'2026-10-15',fingerprint:'real-owid-fixture',isPublic:false}
const map:Mapping={x:'year',metric:'renewables_electricity',aggregate:'sum',filter:'country',value:'China',from:'2015',to:'2022',unit:'TWh'}
const spec:ExploreSpec={kind:'bar',x:'year',y:'solar_electricity',metric:'renewables_electricity',aggregate:'sum',filter:'',value:'',bucket:'none',sort:'label',limit:100}
const expected=[1393.66,1522.79,1667.06,1835.39,2014.64,2185.01,2448.8,2670.66]
beforeAll(async()=>{SQL=await initSqlJs({locateFile:f=>resolve('node_modules/sql.js/dist',f)})})
function db(d:Dataset=data):Database{const result=new SQL.Database();installSQL(result,d);return result}
function use<T>(fn:(db:Database)=>T,d:Dataset=data):T{const engine=db(d);try{return fn(engine)}finally{engine.close()}}
describe('真实 SQLite 核心（基于真实公开子集）',()=>{
 it('年度求和与真实原值一致，SQL 和来源绑定存在',()=>use(engine=>{const r=runAggregate(engine,data,map,'真实年度',1);expect(r.points.map(p=>p.value)).toEqual(expected);expect(r.sql).toContain('SUM(strict_number');expect(r.points.map(p=>p.rowIds)).toEqual(expected.map((_,i)=>[i+2]));expect(r.skipped).toBe(0)}))
 it('总和、均值、最小最大真实执行',()=>use(engine=>{const base={...map,x:'country',filter:'',value:'',from:'',to:''};for(const aggregate of ['sum','average','min','max'] as const){const r=runAggregate(engine,data,{...base,aggregate},'聚合',1).points[0].value;expect(r).toBeCloseTo(aggregate==='sum'?expected.reduce((a,b)=>a+b):aggregate==='average'?expected.reduce((a,b)=>a+b)/8:aggregate==='min'?expected[0]:expected.at(-1)!,8)}}))
 it('记录数及去重数可用于非数值指标',()=>use(engine=>{expect(runAggregate(engine,data,{...map,metric:'country',aggregate:'count'},'计数',1).points.map(p=>p.value)).toEqual(Array(8).fill(1));expect(runAggregate(engine,data,{...map,metric:'country',aggregate:'distinct'},'去重',1).points.map(p=>p.value)).toEqual(Array(8).fill(1))}))
 it('范围筛选和附加条件参数化',()=>use(engine=>{const r=runAggregate(engine,data,{...map,from:'2018',to:'2020',conditions:[{field:'year',operator:'gte',value:'2019'}]},'筛选',1);expect(r.points.map(p=>p.label)).toEqual(['2019','2020']);expect(r.parameters).toContain('2019')}))
 it('筛选注入字符串不能绕过条件',()=>use(engine=>expect(()=>runAggregate(engine,data,{...map,value:"China' OR 1=1 --"},'拒绝',1)).toThrow()))
 it('数据库禁写',()=>use(engine=>{expect(()=>engine.run('DELETE FROM data')).toThrow();expect(engine.exec('SELECT COUNT(*) FROM data')[0].values[0][0]).toBe(8)}))
 it('不存在的字段、无效聚合、倒置范围拒绝',()=>use(engine=>{expect(()=>runAggregate(engine,data,{...map,metric:'不存在'},'',1)).toThrow();expect(()=>runAggregate(engine,data,{...map,aggregate:'oops' as Mapping['aggregate']},'',1)).toThrow();expect(()=>runAggregate(engine,data,{...map,from:'2022',to:'2015'},'',1)).toThrow()}))
 it('散点图是真实原始数值对及单行来源',()=>use(engine=>{const r=runExplore(engine,data,{...spec,kind:'scatter',x:'renewables_electricity',y:'solar_electricity'});expect(r.rows.map(p=>p[0])).toEqual(expected);expect(r.rowIds[0]).toEqual([2]);expect(r.excluded).toBe(0)}))
 it('热力图为真实二维聚合',()=>use(engine=>{const r=runExplore(engine,data,{...spec,kind:'heatmap',y:'country'});expect(r.rows.map(p=>p[2])).toEqual(expected);expect(r.rows[0].slice(0,2)).toEqual(['2015','China'])}))
 it('排序后展示上限明确标记，不当作排除记录',()=>use(engine=>{const r=runExplore(engine,data,{...spec,sort:'desc',limit:2});expect(r.rows.map(p=>p[1])).toEqual([2670.66,2448.8]);expect(r.truncated).toBe(true);expect(r.excluded).toBe(0);expect(r.total).toBe(8)}))
 it('无筛选结果不填充虚构图表',()=>use(engine=>{const r=runExplore(engine,data,{...spec,filter:'country',value:'不存在'});expect(r.rows).toEqual([]);expect(r.total).toBe(0)}))
 it('对比总额、差额和来源准确，贡献为算术分解',()=>use(engine=>{const c:ComparisonSpec={period:'year',dimension:'country',metric:'renewables_electricity',aggregate:'sum',baselineFrom:'2015',baselineTo:'2018',currentFrom:'2019',currentTo:'2022'};const r=runCompare(engine,data,c);expect(r.baselineTotal).toBeCloseTo(expected.slice(0,4).reduce((a,b)=>a+b),8);expect(r.delta).toBeCloseTo(expected.slice(4).reduce((a,b)=>a+b)-expected.slice(0,4).reduce((a,b)=>a+b),8);expect(r.groups[0].contribution).toBe(1);expect(r.groups[0].baselineIds).toEqual([2,3,4,5])}))
 it('只有一期存在的维度不补零，不算贡献',()=>use(engine=>{const r=runCompare(engine,data,{period:'year',dimension:'year',metric:'renewables_electricity',aggregate:'sum',baselineFrom:'2015',baselineTo:'2018',currentFrom:'2019',currentTo:'2022'});expect(r.comparable).toBe(false);expect(r.groups.every(g=>g.delta===null&&g.contribution===null)).toBe(true)}))
 it('计数对比对缺失期间保持空值，不将无记录当作零',()=>use(engine=>{const r=runCompare(engine,data,{period:'year',dimension:'year',metric:'country',aggregate:'count',baselineFrom:'2015',baselineTo:'2018',currentFrom:'2019',currentTo:'2022'});expect(r.comparable).toBe(false);expect(r.groups.every(g=>g.delta===null&&g.contribution===null)).toBe(true);expect(r.baselineTotal).toBe(4);expect(r.currentTotal).toBe(4)}))
 it('计数对比完全没有基准记录时不计算差额',()=>use(engine=>{const r=runCompare(engine,data,{period:'year',dimension:'country',metric:'country',aggregate:'count',baselineFrom:'2010',baselineTo:'2012',currentFrom:'2019',currentTo:'2022'});expect(r.baselineTotal).toBeNull();expect(r.delta).toBeNull();expect(r.comparable).toBe(false)}))
 it('重叠期间拒绝',()=>use(engine=>expect(()=>runCompare(engine,data,{period:'year',dimension:'country',metric:'renewables_electricity',aggregate:'sum',baselineFrom:'2015',baselineTo:'2020',currentFrom:'2019',currentTo:'2022'})).toThrow('重叠')))
 it('质量统计中位数真实且不误报重复',()=>{const q=inspectQuality(data);expect(q.duplicateRows).toBe(0);const f=q.fields.find(f=>f.field==='renewables_electricity')!;expect(f.median).toBeCloseTo((expected[3]+expected[4])/2);expect(f.numeric).toBe(8);expect(f.missing).toBe(0)})
 it('无清理规则不会改变数据或生成结果',()=>{const r=previewCleaning(data,{field:'country',trim:false,numeric:false,markers:'',dropMissing:false,deduplicate:false});expect(r.changedCells).toBe(0);expect(r.rows).toEqual(data.rows);expect(r.sourceRecords).toEqual([2,3,4,5,6,7,8,9])})
})
describe('明确标记的解析边界测试，不是业务演示数据',()=>{
 const edge:Dataset={...data,headers:['维度','指标'],rows:[{'维度':'a','指标':' 1,234.50 '},{'维度':'a','指标':' 1,234.50 '},{'维度':'b','指标':'12,34'},{'维度':'c','指标':null}]}
 it('清理预览不修改原数据，坏千分位保留原值，来源不丢',()=>{const r=previewCleaning(edge,{field:'指标',trim:true,numeric:true,markers:'',dropMissing:true,deduplicate:true});expect(r.rows).toEqual([{'维度':'a','指标':'1234.50'},{'维度':'b','指标':'12,34'}]);expect(r.sourceRecords).toEqual([2,4]);expect(r.failedNumeric).toBe(1);expect(edge.rows[0]['指标']).toBe(' 1,234.50 ')})
 it('求和不把缺失和格式错误当零，计数则保留空指标',()=>use(engine=>{const m:Mapping={...map,x:'维度',metric:'指标',filter:'',value:'',from:'',to:''};expect(()=>runAggregate(engine,edge,m,'',1)).toThrow();const r=runAggregate(engine,edge,{...m,aggregate:'count'},'',1);expect(r.usedRows).toBe(4);expect(r.points.map(p=>p.value)).toEqual([2,1,1])},edge))
 it('未经确认不修剪去重原值',()=>{const d={...edge,rows:[{'维度':'a','指标':'x'},{'维度':'a','指标':' x '}]};use(engine=>{const r=runAggregate(engine,d,{...map,x:'维度',metric:'指标',aggregate:'distinct',filter:'',value:'',from:'',to:''},'',1);expect(r.points[0].value).toBe(2)},d)})
 it('探索聚合数值溢出时拒绝生成无限值图表',()=>{const d={...edge,rows:[{'维度':'a','指标':'1e308'},{'维度':'a','指标':'1e308'}]};use(engine=>expect(()=>runExplore(engine,d,{...spec,x:'维度',metric:'指标'})).toThrow('数值范围'),d)})
 it('缺失标记精确匹配保留首尾空白含义',()=>{const d={...edge,rows:[{'维度':'a','指标':'NA'},{'维度':'b','指标':' NA '}]};const r=previewCleaning(d,{field:'指标',trim:false,numeric:false,markers:' NA ',dropMissing:false,deduplicate:false});expect(r.rows.map(v=>v['指标'])).toEqual(['NA',null])})
 it('质量均值和中位数避免有限原值求和溢出',()=>{const d={...edge,rows:[{'维度':'a','指标':'1e308'},{'维度':'b','指标':'1e308'}]};const r=inspectQuality(d).fields.find(f=>f.field==='指标')!;expect(r.mean).toBe(1e308);expect(r.median).toBe(1e308)})
})

// These strings are parser edge fixtures only; they are never product/demo data.
describe('表头和换行解析边界（非业务数据）',()=>{
 it('CSV BOM、CRLF、引号内表头回车与中英文首尾空白被清理，原值空白保留',()=>{
  const d=parseCSV('\uFEFF 年份 ,"wind_electricity\r" , 渠道 Channel \r\n2022,2670.660, 原值 \r\n')
  expect(d.headers).toEqual(['年份','wind_electricity','渠道 Channel'])
  expect(d.rows).toEqual([{'年份':'2022',wind_electricity:'2670.660','渠道 Channel':' 原值 '}])
 })
 it.each(['\n','\r\n','\r'])('CSV 不同换行 %j 不污染最后字段',newline=>{
  const d=parseCSV(['year,wind_electricity','2022,2670.660'].join(newline))
  expect(d.headers).toEqual(['year','wind_electricity'])
  expect(d.rows[0].wind_electricity).toBe('2670.660')
 })
 it('CSV 空表头和清理后重复表头拒绝，避免静默覆盖',()=>{
  expect(()=>parseCSV('year,\n2022,1')).toThrow('空列名')
  expect(()=>parseCSV(' year,year \n2022,1')).toThrow('重复列名')
  expect(()=>parseCSV('"year"extra,value\n2022,1')).toThrow('非分隔字符')
 })
 it('特殊列名作为普通键保留，不污染对象原型',()=>{
  const d=parseCSV('__proto__,constructor,"含,逗号"\n原值,编号,保留')
  expect(Object.keys(d.rows[0])).toEqual(d.headers)
  expect(Object.getPrototypeOf(d.rows[0])).toBe(Object.prototype)
  expect(d.rows[0]['__proto__']).toBe('原值')
  expect(Object.hasOwn(Object.prototype,'编号')).toBe(false)
 })
 const table:ImportTable={name:'解析边界',method:'仅测试',warnings:[],lines:[{sourceRow:3,cells:['\uFEFF 年份 ',' 指标\r','']},{sourceRow:4,cells:['2022',' 1 ','']}]}
 it('Excel/PDF 表格表头同样清理 BOM 和回车，只去尾部空列，来源位置保留',()=>{
  const d=prepareTable(table,0,1)
  expect(d.headers).toEqual(['年份','指标'])
  expect(d.rows[0]['指标']).toBe(' 1 ')
  expect(d.locations).toEqual(['解析边界 · 第 4 行'])
 })
 it('Excel/PDF 中间空表头和清理后重复字段必须拒绝',()=>{
  expect(()=>prepareTable({...table,lines:[{sourceRow:3,cells:['年份','','指标']},table.lines[1]]},0,1)).toThrow('空字段')
  expect(()=>prepareTable({...table,lines:[{sourceRow:3,cells:['指标',' 指标\r']},table.lines[1]]},0,1)).toThrow('重复字段')
 })
})
