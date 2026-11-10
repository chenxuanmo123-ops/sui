import { useState } from 'react'
import { ArrowUpRight, CornerDownRight, MousePointer2, X } from 'lucide-react'
import DataChart from './DataChart'
import { analysisReference } from './chart-model'
import { download, formatNumber } from './data'
import { chartSVGMarkup, downloadChartPNG } from './chart-image'
import { ExportMenu } from './ExportMenu'
import type { ExportItem } from './ExportMenu'
import { exportBundleWorkbook, exportResultWorkbook, readableTime, resultCSV, safeName } from './export-workbook'
import InsightBrief from './InsightBrief'
import NextCuts from './NextCuts'
import { ResultTable } from './ResultTable'
import { UnitDeclaration } from './UnitDeclaration'
import type { Analysis, AnalysisScope, Dataset } from './data'
import type { CheckupOverrides } from './checkup'
import type { Fact, PlanResponse, Review, PlanExecution } from './ai'
import { useLabels } from './labels'
export type AnalysisBundle = { id?: string; response: PlanResponse; results: Analysis[]; facts: Fact[]; review: Review | null; failures: PlanExecution['failures'] }
export function ScopeSummary({ scope, onParent }: {scope: AnalysisScope; onParent?: (id:number)=>void}) {
 const labels=useLabels()
 return <aside className="scope-summary" aria-label="本次追问范围"><span className="scope-eyebrow">分组追问 · 范围已锁定</span><div><strong>{scope.label}</strong><span>{scope.rowIds.length.toLocaleString()} 条匹配记录</span></div><p>来源：分析 #{scope.parentAnalysisId} · {scope.parentTitle}</p><p>原分组结果：{formatNumber(scope.baseline.value,4)}{scope.baseline.unit}{scope.baseline.counts ? '（分子 '+scope.baseline.counts.numerator+' / 分母 '+scope.baseline.counts.denominator+'；排除 '+scope.baseline.counts.excluded+'）' : ' · '+labels.field(scope.baseline.metric)}。以下各项均在该分组范围内计算，进一步筛选可能减少记录。</p>{onParent && <button className="text-button" onClick={()=>onParent(scope.parentAnalysisId)}>返回来源分析对照 <ArrowUpRight size={14}/></button>}</aside>
}
export function AnalysisResults({ bundle, dataset, overrides, onEvidence, onFollowUp, onParent, onBackToCheckup, onRoles, onUnit }: {bundle:AnalysisBundle;dataset:Dataset;overrides?:CheckupOverrides;onEvidence:(id:number,label?:string)=>void;onFollowUp?:(result:Analysis,label:string)=>void;onParent?:(id:number)=>void;onBackToCheckup?:()=>void;onRoles?:()=>void;onUnit?:(id:number,unit:string)=>void}) {
 const [focused,setFocused]=useState(bundle.results[0]?.id)
 const [selection,setSelection]=useState<{id:number;label:string}|null>(null)
 const [chartKinds,setChartKinds]=useState<Record<number,'line'|'bar'>>({})
 const [exportError,setExportError]=useState('')
 const labels=useLabels()
 const chartNode=(id:number)=>document.getElementById('bundle-chart-'+id) as SVGSVGElement | null
 const titleOf=(result:Analysis)=>result.ai?.taskTitle||result.question
 const exportOptions={fieldLabel:labels.field,valueLabel:labels.value,dataset}
 const frameOf=(result:Analysis)=>({
  title:titleOf(result),
  subtitle:[labels.field(result.mapping.metric)+(result.mapping.unit?'（'+result.mapping.unit+'）':''),result.points.length+' 个分组',result.usedRows.toLocaleString('zh-CN')+' 条有效记录','数据：'+dataset.title,'快照 '+result.datasetHash.slice(0,16)].join(' · '),
  footnote:'数值来自本地 SQL 计算，未经 AI 生成 · '+readableTime(result.createdAt),
 })
 const resultItems=(result:Analysis):ExportItem[]=>{
  const title=titleOf(result), file=safeName(title), frame=frameOf(result)
  return [
   {format:'PNG',label:'图表 PNG',hint:'带标题、指标和数据来源，2× 清晰度',run:()=>{const node=chartNode(result.id);if(!node)throw new Error('图表尚未渲染完成，请稍后重试。');return downloadChartPNG(node,'数鉴-'+file+'-图表.png',2,frame)}},
   {format:'SVG',label:'图表 SVG',hint:'带标题与口径的矢量图，放大不失真',run:()=>{const node=chartNode(result.id);if(!node)throw new Error('图表尚未渲染完成，请稍后重试。');download(chartSVGMarkup(node,frame),'image/svg+xml','数鉴-'+file+'-图表.svg')}},
   {format:'XLSX',label:'结果 Excel',hint:'带标题、口径与来源记录的完整工作簿',run:()=>exportResultWorkbook(result,exportOptions)},
   {format:'CSV',label:'结果 CSV',hint:'纯数据表，无标题行，便于导入其他工具',run:()=>download(resultCSV(result,exportOptions),'text/csv;charset=utf-8','数鉴-'+file+'-结果.csv')},
  ]
 }
 const bundleItems:ExportItem[]=[
  {format:'HTML',label:'完整分析报告',hint:'图表、SQL 与来源记录，单文件离线可看',run:()=>exportBundle(dataset,bundle)},
  {format:'XLSX',label:'全部结果 Excel',hint:'每个任务一张表，附汇总与口径说明',run:()=>exportBundleWorkbook(dataset,bundle)},
 ]
 return <section className="analysis-bundle" aria-label="本轮完整分析">
  <header className="bundle-heading"><div><span className="result-status">{bundle.response.scope?'分组追问 · 已计算':'分析结果 · 已计算'}</span><h2 className="bundle-goal" title={bundle.response.plan.goal}>{bundle.response.plan.goal}</h2><p>{bundle.results.length} 项真实计算 · {dataset.title}</p></div><div className="bundle-heading-actions">{onBackToCheckup&&<button className="text-button" onClick={onBackToCheckup}>回到数据体检</button>}{onRoles&&<button className="text-button" onClick={onRoles}>纠正字段类型</button>}<ExportMenu label="导出本轮结果" title="本轮分析" summary={bundle.results.length+' 项计算 · 图表与结果表'} items={bundleItems} onError={setExportError}/></div></header>
  {bundle.response.scope && <ScopeSummary scope={bundle.response.scope} onParent={onParent}/>}
  {exportError && <div role="status" className="bundle-warning">导出未完成：{exportError}</div>}
  {bundle.failures.length>0 && <div role="status" className="bundle-warning">{bundle.failures.length} 项任务失败，以下仅展示成功计算；请在助手中查看错误并修正。</div>}
  <p className="bundle-interaction-hint"><MousePointer2 size={15}/>点击图表或表格中的分组，可限定范围继续分析；点击记录数查看来源。</p>
  <div className={'result-workspace'+(bundle.results.length>1?' has-rail':'')}>
  {bundle.results.length>1&&<nav className="result-navigation" aria-label="本轮分析任务">{bundle.results.map((r,i)=><button key={r.id} className={focused===r.id?'active':''} aria-pressed={focused===r.id} onClick={()=>{setFocused(r.id);setSelection(null)}}><span className="result-nav-index">{i+1}</span><span className="result-nav-label">{r.ai?.taskTitle||r.question}</span></button>)}</nav>}
  <div className={'bundle-grid'+(bundle.results.length===1?' single-result':'')}>{bundle.results.map(result=>{
   const label=selection?.id===result.id?selection.label:''
   const point=result.points.find(p=>p.label===label)
   const planChart=bundle.response.plan.tasks.find(t=>t.id===result.ai?.taskId)?.chart==='line'?'line':'bar'
   const chartKind=chartKinds[result.id]??planChart
   return <article className={'bundle-result'+(point?' has-selection':'')} key={result.id} hidden={focused!==result.id}>
    <header className="result-sheet-head">
      <div>
        <span className="result-sheet-kicker">任务 {result.ai?.taskId ?? '手动'} · 已真实计算</span>
        <h3>{result.ai?.taskTitle||result.question}</h3>
      </div>
      <div className="result-sheet-tools">
        <span className="result-record-count">{result.usedRows.toLocaleString()} 条有效记录 · {result.points.length} 个分组</span>
        <div className="result-sheet-actions"><ExportMenu title={titleOf(result)} summary={result.points.length+' 个分组 · '+result.usedRows+' 条有效记录'} items={resultItems(result)} onError={setExportError}/><button className="text-button" onClick={()=>onEvidence(result.id)}>检查 SQL 与来源</button></div>
      </div>
    </header>
    <div className="result-answer">
      {result.rateSummary ? <div className="rate-summary"><strong>{formatNumber(result.rateSummary.value,2)}<small>%</small></strong><span>当前范围总体比例<br/>{formatNumber(result.rateSummary.numerator,0)} / {formatNumber(result.rateSummary.denominator,0)} 条有效记录 · 排除 {result.rateSummary.excluded} 条未知或缺失结果</span></div>:<p className="result-finding">{result.finding}</p>}
    </div>
    {result.mapping.rate&&<p className="bundle-formula">分子：{labels.field(result.mapping.metric)} = {JSON.stringify(result.mapping.rate.successValue)}；分母：{JSON.stringify(result.mapping.rate.eligibleValues)}。总体比例按总分子 ÷ 总分母计算。</p>}
    {!result.mapping.rate&&onUnit&&<UnitDeclaration id={result.id} unit={result.mapping.unit} source={result.unitSource} onSave={unit=>onUnit(result.id,unit)} />}
    <div className="result-body">
    <div className="result-visual">
    <div className="chart-action-line"><label className="group-locator">定位分组<select aria-label="定位图表分组" value={label} onChange={e=>setSelection(e.target.value?{id:result.id,label:e.target.value}:null)}><option value="">点击图形或选择分组</option>{result.points.map(p=><option key={p.label} value={p.label}>{labels.value(result.mapping.x,p.label)}</option>)}</select></label><div className="segmented compact result-chart-kind" aria-label="结果图表类型"><button aria-pressed={chartKind==='line'} className={chartKind==='line'?'active':''} onClick={()=>setChartKinds(kinds=>({...kinds,[result.id]:'line'}))}>折线</button><button aria-pressed={chartKind==='bar'} className={chartKind==='bar'?'active':''} onClick={()=>setChartKinds(kinds=>({...kinds,[result.id]:'bar'}))}>柱状</button></div><span><MousePointer2 size={14}/>选中分组后，查看来源或继续追问</span></div><div className="result-chart-table"><DataChart reference={analysisReference(result)} interaction="select" compact chartId={'bundle-chart-'+result.id} points={result.points} metric={result.ai?.taskTitle||result.mapping.metric} unit={result.mapping.unit} kind={chartKind} selected={label} facetField={result.mapping.x} exportFrame={frameOf(result)} onSelect={label=>setSelection(label?{id:result.id,label}:null)}/>
    <aside className="result-detail" aria-label="图表分组操作">
    {point ? <div className="selected-group" aria-label="已选分组"><div className="context-heading"><span>当前选择</span><button className="icon-button" aria-label="取消分组选择" onClick={()=>setSelection(null)}><X size={15}/></button></div><strong title={point.label}>{labels.value(result.mapping.x,point.label)}</strong><div className="context-value">{formatNumber(point.value,2)}<small>{result.mapping.unit}</small></div><p>{(point.scopeRowIds?.length??point.rowIds.length).toLocaleString()} 条匹配记录{point.rate?<><br/>分子 {point.rate.numerator.toLocaleString()} / 分母 {point.rate.denominator.toLocaleString()}</>:null}</p><div className="selected-group-actions">{onFollowUp&&!!point.scopeRowIds?.length&&<button className="primary" onClick={()=>onFollowUp(result,point.label)}><CornerDownRight size={16}/>围绕此分组追问</button>}<button className="secondary" onClick={()=>onEvidence(result.id,point.label)}>查看来源记录<ArrowUpRight size={14}/></button></div><small>追问范围限定为此分组全部匹配记录；发送前仍可修改问题并核对计划。</small></div>:<div className="group-context-empty"><MousePointer2 size={22} strokeWidth={1.5}/><h4>选中分组，继续分析</h4><p>点击图形后，在这里核对数值、查看来源，或让 AI 针对此分组继续分析。</p>{result.points.length>1&&<div className="group-shortcuts">{(['max','min'] as const).map(kind=>{const target=result.points.reduce((a,b)=>(kind==='max'?a.value>=b.value:a.value<=b.value)?a:b);return <button key={kind} onClick={()=>setSelection({id:result.id,label:target.label})}><span>{kind==='max'?'数值最高':'数值最低'}</span><strong>{labels.value(result.mapping.x,target.label)}</strong><small>{formatNumber(target.value,2)}{result.mapping.unit}<ArrowUpRight size={12}/></small></button>})}</div>}</div>}
    </aside></div>
    {result.trend&&<p className="result-trend">描述性线性趋势：按时间顺序对 {result.trend.n} 个分组拟合，平均每{result.trend.period==='year'?'年':'月'}变化 {result.trend.slope>=0?'+':''}{formatNumber(result.trend.slope,4)}{result.mapping.unit}；R² {formatNumber(result.trend.r2,3)}。仅描述图中聚合值，不是预测、显著性检验或因果结论。</p>}
    <details className="result-data-details"><summary>查看分组结果表 <span>{result.points.length} 个分组 · 完整数值与来源</span></summary><ResultTable result={result} onEvidence={onEvidence} selected={label} onSelect={label=>setSelection({id:result.id,label})}/></details>
    </div>
    <aside className="result-insights" aria-label="结果解读与下一步">
      <InsightBrief result={result} compact />
      <NextCuts dataset={dataset} result={result} overrides={overrides} />
    </aside>
    </div>
   </article>
  })}</div>
  </div>
  {bundle.review&&<div className="bundle-review"><h3>结合证据解读</h3><p className="review-caption">解读引用本轮计算结果；候选解释仍需进一步验证。</p>{bundle.review.findings.map((f,i)=><article className="review-finding" key={i}><span className={f.interpretation==='hypothesis'?'finding-kind is-hypothesis':'finding-kind'}>{f.interpretation==='hypothesis'?'待验证解释':'数据观察'}</span><p>{f.statement}</p><div className="review-evidence">{f.evidenceIds.map((id,index)=>{
   const fact=bundle.facts.find(f=>f.id===id), result=bundle.results.find(r=>r.id===fact?.analysisId), point=result?.points.find(p=>p.label===fact?.label)
   return fact?<button key={id} className="text-button" title={id} onClick={()=>onEvidence(fact.analysisId,fact.label)}>依据 {index+1} · {point?point.label+' '+formatNumber(point.value,2)+(result?.mapping.unit||''):'查看来源'}</button>:null
  })}</div></article>)}{bundle.review.insight && <div className="review-insight-block"><h4>可能意味着什么 / 可以拿来做什么</h4><p className="review-caption">以下条目由模型依据本轮计算证据提出，属于候选解释与可核查的下一步；引用有效不等于解释成立。</p>{([['possibleMeanings', '可能意味着什么'], ['possibleUses', '可以拿来做什么']] as const).map(([key, title]) => <section key={key}><strong>{title}</strong>{bundle.review!.insight![key].length ? <ul>{bundle.review!.insight![key].map((item, index) => <li key={index}><p>{item.statement}</p><div className="review-evidence">{item.evidenceIds.map(id => { const fact = bundle.facts.find(f => f.id === id), result = bundle.results.find(r => r.id === fact?.analysisId), point = result?.points.find(p => p.label === fact?.label); return fact ? <button key={id} className="text-button" title={id} onClick={() => onEvidence(fact.analysisId, fact.label)}>依据 · {point ? point.label + ' ' + formatNumber(point.value, 2) + (result?.mapping.unit || '') : '查看来源'}</button> : null })}</div></li>)}</ul> : <p className="review-caption">模型没有给出有证据支持的条目。</p>}</section>)}</div>}<details><summary>分析边界与后续核查</summary><ul>{bundle.review.limitations.map((l,i)=><li key={i}>{l}</li>)}</ul></details></div>}
 </section>
}
async function exportBundle(dataset:Dataset,bundle:AnalysisBundle){const {bundleHTML}=await import('./bundle-report');download(bundleHTML(dataset,bundle),'text/html;charset=utf-8','数鉴-完整分析报告.html')}
