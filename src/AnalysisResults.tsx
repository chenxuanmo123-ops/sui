import { useMemo, useState } from 'react'
import { ArrowUpRight, CornerDownRight, MousePointer2, Search, X } from 'lucide-react'
import DataChart from './DataChart'
import { analysisReference } from './chart-model'
import { rateBaseline } from './follow-up'
import { download, formatNumber } from './data'
import { queryResultRows, sortResultRows } from './result-rows'
import type { ResultSort } from './result-rows'
import type { Analysis, AnalysisScope, Dataset } from './data'
import type { Fact, PlanResponse, Review, PlanExecution } from './ai'
export type AnalysisBundle = { id?: string; response: PlanResponse; results: Analysis[]; facts: Fact[]; review: Review | null; failures: PlanExecution['failures'] }
export function ScopeSummary({ scope, onParent }: {scope: AnalysisScope; onParent?: (id:number)=>void}) {
 return <aside className="scope-summary" aria-label="本次追问范围"><span className="scope-eyebrow">分组追问 · 范围已锁定</span><div><strong>{scope.label}</strong><span>{scope.rowIds.length.toLocaleString()} 条匹配记录</span></div><p>来源：分析 #{scope.parentAnalysisId} · {scope.parentTitle}</p><p>原分组结果：{formatNumber(scope.baseline.value,4)}{scope.baseline.unit}{scope.baseline.counts ? '（分子 '+scope.baseline.counts.numerator+' / 分母 '+scope.baseline.counts.denominator+'；排除 '+scope.baseline.counts.excluded+'）' : ' · '+scope.baseline.metric}。以下各项均在该分组范围内计算，进一步筛选可能减少记录。</p>{onParent && <button className="text-button" onClick={()=>onParent(scope.parentAnalysisId)}>返回来源分析对照 <ArrowUpRight size={14}/></button>}</aside>
}
export function ResultTable({ result, onEvidence, onSelect, selected, controls = true }: {result:Analysis; onEvidence?:(id:number,label?:string)=>void; onSelect?:(label:string)=>void; selected?:string; controls?:boolean}) {
 const baseline=rateBaseline(result)
 const [query,setQuery]=useState('')
 const [sort,setSort]=useState<ResultSort>('original')
 // Filtering and sorting only change which calculated groups are shown, never their values.
 const rows=useMemo(()=>sortResultRows(queryResultRows(result.points,query),sort),[result.points,query,sort])
 const unavailable=useMemo(()=>queryResultRows(result.unavailableGroups??[],query),[result.unavailableGroups,query])
 const total=result.points.length+(result.unavailableGroups?.length??0)
 const shown=rows.length+unavailable.length
 const columnCount=3+(result.mapping.rate?3:0)+(baseline!==undefined?1:0)
 return <div className="bundle-table-wrap">
  {controls && <div className="result-table-controls">
   <label className="result-table-search"><Search size={14}/><span className="sr-only">搜索分组</span><input aria-label="搜索分组" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索分组" /></label>
   <label>排序<select aria-label="结果排序" value={sort} onChange={e=>setSort(e.target.value as ResultSort)}><option value="original">计算顺序</option><option value="desc">数值从高到低</option><option value="asc">数值从低到高</option><option value="label">分组名排序</option></select></label>
   <span>{query.trim()?`显示 ${shown} / ${total} 个分组`:`共 ${total} 个分组`}</span>
  </div>}
  <div className="bundle-table"><table><thead><tr><th>分组</th><th>结果{result.mapping.unit && '（'+result.mapping.unit+'）'}</th>{result.mapping.rate && <><th>分子</th><th>分母</th><th>排除</th></>}{baseline!==undefined&&<th>较来源分组<small>（百分点）</small></th>}<th>来源</th></tr></thead><tbody>{rows.map(p=><tr key={p.label} className={selected===p.label?'is-selected':''}><td>{onSelect?<button className="group-select" aria-pressed={selected===p.label} onClick={()=>onSelect(p.label)}>{p.label}</button>:p.label}</td><td>{formatNumber(p.value,4)}</td>{p.rate && <><td>{p.rate.numerator}</td><td>{p.rate.denominator}</td><td>{p.rate.excluded}</td></>}{baseline!==undefined&&<td className={p.value>=baseline?'delta-positive':'delta-negative'}>{p.value>baseline?'+':''}{formatNumber(p.value-baseline,2)}</td>}<td>{onEvidence?<button className="text-button" onClick={()=>onEvidence(result.id,p.label)}>{p.rowIds.length} 条记录</button>:p.rowIds.length+' 条记录'}</td></tr>)}{unavailable.map(p=><tr key={'unavailable-'+p.label}><td>{p.label}</td><td>无法计算</td>{result.mapping.rate&&<><td>0</td><td>0</td><td>{p.excluded}</td></>}{baseline!==undefined&&<td>无法计算</td>}<td>分母为零</td></tr>)}{shown===0&&<tr><td colSpan={columnCount} className="result-table-empty">没有匹配的分组，请换一个关键词。</td></tr>}</tbody></table></div>
 </div>
}
export function AnalysisResults({ bundle, dataset, onEvidence, onFollowUp, onParent }: {bundle:AnalysisBundle;dataset:Dataset;onEvidence:(id:number,label?:string)=>void;onFollowUp?:(result:Analysis,label:string)=>void;onParent?:(id:number)=>void}) {
 const [focused,setFocused]=useState(bundle.results[0]?.id)
 const [selection,setSelection]=useState<{id:number;label:string}|null>(null)
 return <section className="analysis-bundle" aria-label="本轮完整分析">
  <header className="bundle-heading"><div><span className="result-status">{bundle.response.scope?'分组追问 · 已计算':'分析结果 · 已计算'}</span><h2 className="bundle-goal" title={bundle.response.plan.goal}>{bundle.response.plan.goal}</h2><p>{bundle.results.length} 项真实计算 · {dataset.title}</p></div><button className="secondary" onClick={()=>exportBundle(dataset,bundle)}>导出完整分析报告</button></header>
  {bundle.response.scope && <ScopeSummary scope={bundle.response.scope} onParent={onParent}/>}
  {bundle.failures.length>0 && <div role="status" className="bundle-warning">{bundle.failures.length} 项任务失败，以下仅展示成功计算；请在助手中查看错误并修正。</div>}
  <p className="bundle-interaction-hint"><MousePointer2 size={15}/>点击图表或表格中的分组，可限定范围继续分析；点击记录数查看来源。</p>
  {bundle.results.length>1&&<nav className="result-navigation" aria-label="本轮分析任务">{bundle.results.map((r,i)=><button key={r.id} className={focused===r.id?'active':''} aria-pressed={focused===r.id} onClick={()=>{setFocused(r.id);setSelection(null)}}><span>{i+1}</span>{r.ai?.taskTitle||r.question}</button>)}</nav>}
  <div className={'bundle-grid'+(bundle.results.length===1?' single-result':'')}>{bundle.results.map(result=>{
   const label=selection?.id===result.id?selection.label:''
   const point=result.points.find(p=>p.label===label)
   return <article className={'bundle-result'+(point?' has-selection':'')} key={result.id} hidden={focused!==result.id}>
    <header><h3>{result.ai?.taskTitle||result.question}</h3><button className="text-button" onClick={()=>onEvidence(result.id)}>检查 SQL 与来源</button></header>
    {result.rateSummary ? <div className="rate-summary"><strong>{formatNumber(result.rateSummary.value,2)}<small>%</small></strong><span>当前范围总体比例<br/>{formatNumber(result.rateSummary.numerator,0)} / {formatNumber(result.rateSummary.denominator,0)} 条有效记录 · 排除 {result.rateSummary.excluded} 条未知或缺失结果</span></div>:<p>{result.finding}</p>}
    {result.mapping.rate&&<p className="bundle-formula">分子：{result.mapping.metric} = {JSON.stringify(result.mapping.rate.successValue)}；分母：{JSON.stringify(result.mapping.rate.eligibleValues)}。总体比例按总分子 ÷ 总分母计算。</p>}
    <div className="chart-action-line"><label className="group-locator">定位分组<select aria-label="定位图表分组" value={label} onChange={e=>setSelection(e.target.value?{id:result.id,label:e.target.value}:null)}><option value="">点击图形或选择分组</option>{result.points.map(p=><option key={p.label} value={p.label}>{p.label}</option>)}</select></label><span><MousePointer2 size={14}/>选中分组后，查看来源或继续追问</span></div><div className="result-chart-table"><DataChart reference={analysisReference(result)} interaction="select" compact chartId={'bundle-chart-'+result.id} points={result.points} metric={result.ai?.taskTitle||result.mapping.metric} unit={result.mapping.unit} kind={bundle.response.plan.tasks.find(t=>t.id===result.ai?.taskId)?.chart||'bar'} selected={label} onSelect={label=>setSelection(label?{id:result.id,label}:null)}/>
    <aside className="result-detail" aria-label="图表分组操作" hidden={!point}>
    {point ? <div className="selected-group" aria-label="已选分组"><div className="context-heading"><span>当前选择</span><button className="icon-button" aria-label="取消分组选择" onClick={()=>setSelection(null)}><X size={15}/></button></div><strong>{point.label}</strong><div className="context-value">{formatNumber(point.value,2)}<small>{result.mapping.unit}</small></div><p>{(point.scopeRowIds?.length??point.rowIds.length).toLocaleString()} 条匹配记录{point.rate?<><br/>分子 {point.rate.numerator.toLocaleString()} / 分母 {point.rate.denominator.toLocaleString()}</>:null}</p><div className="selected-group-actions">{onFollowUp&&!!point.scopeRowIds?.length&&<button className="primary" onClick={()=>onFollowUp(result,point.label)}><CornerDownRight size={16}/>围绕此分组追问</button>}<button className="secondary" onClick={()=>onEvidence(result.id,point.label)}>查看来源记录<ArrowUpRight size={14}/></button></div><small>追问范围限定为此分组全部匹配记录；发送前仍可修改问题并核对计划。</small></div>:<div className="group-context-empty"><MousePointer2 size={22} strokeWidth={1.5}/><h4>选中分组，继续分析</h4><p>点击图形后，在这里核对数值、查看来源，或让 AI 针对此分组继续分析。</p>{result.points.length>1&&<div className="group-shortcuts">{(['max','min'] as const).map(kind=>{const target=result.points.reduce((a,b)=>(kind==='max'?a.value>=b.value:a.value<=b.value)?a:b);return <button key={kind} onClick={()=>setSelection({id:result.id,label:target.label})}><span>{kind==='max'?'数值最高':'数值最低'}</span><strong>{target.label}</strong><small>{formatNumber(target.value,2)}{result.mapping.unit}<ArrowUpRight size={12}/></small></button>})}</div>}</div>}
    </aside></div>
    {result.trend&&<p className="result-trend">描述性线性趋势：按时间顺序对 {result.trend.n} 个分组拟合，平均每{result.trend.period==='year'?'年':'月'}变化 {result.trend.slope>=0?'+':''}{formatNumber(result.trend.slope,4)}{result.mapping.unit}；R² {formatNumber(result.trend.r2,3)}。仅描述图中聚合值，不是预测、显著性检验或因果结论。</p>}
    <details className="result-data-details"><summary>查看分组结果表 <span>{result.points.length} 个分组 · 完整数值与来源</span></summary><ResultTable result={result} onEvidence={onEvidence} selected={label} onSelect={label=>setSelection({id:result.id,label})}/></details>
   </article>
  })}</div>
  {bundle.review&&<div className="bundle-review"><h3>结合证据解读</h3><p className="review-caption">解读引用本轮计算结果；候选解释仍需进一步验证。</p>{bundle.review.findings.map((f,i)=><article className="review-finding" key={i}><span className={f.interpretation==='hypothesis'?'finding-kind is-hypothesis':'finding-kind'}>{f.interpretation==='hypothesis'?'待验证解释':'数据观察'}</span><p>{f.statement}</p><div className="review-evidence">{f.evidenceIds.map((id,index)=>{
   const fact=bundle.facts.find(f=>f.id===id), result=bundle.results.find(r=>r.id===fact?.analysisId), point=result?.points.find(p=>p.label===fact?.label)
   return fact?<button key={id} className="text-button" title={id} onClick={()=>onEvidence(fact.analysisId,fact.label)}>依据 {index+1} · {point?point.label+' '+formatNumber(point.value,2)+(result?.mapping.unit||''):'查看来源'}</button>:null
  })}</div></article>)}<details><summary>分析边界与后续核查</summary><ul>{bundle.review.limitations.map((l,i)=><li key={i}>{l}</li>)}</ul></details></div>}
 </section>
}
async function exportBundle(dataset:Dataset,bundle:AnalysisBundle){const {bundleHTML}=await import('./bundle-report');download(bundleHTML(dataset,bundle),'text/html;charset=utf-8','数鉴-完整分析报告.html')}
