import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { rateBaseline } from './follow-up'
import { formatNumber } from './data'
import { queryResultRows, sortResultRows } from './result-rows'
import type { ResultSort } from './result-rows'
import type { Analysis } from './data'
import { useLabels } from './labels'

/** Shared grouped-result table. Search and sort only change which calculated
 * groups are shown, never their values. */
export function ResultTable({ result, onEvidence, onSelect, selected, controls = true }: {result:Analysis; onEvidence?:(id:number,label?:string)=>void; onSelect?:(label:string)=>void; selected?:string; controls?:boolean}) {
 const labels=useLabels()
 const baseline=rateBaseline(result)
 const [query,setQuery]=useState('')
 const [sort,setSort]=useState<ResultSort>('original')
 // Matches either the stored group value or its displayed name, so a reader
 // searching 「中国」 finds the stored "China" without changing any value.
 const matches=(label:string)=>{const q=query.trim().toLowerCase();return !q||label.toLowerCase().includes(q)||labels.value(result.mapping.x,label).toLowerCase().includes(q)}
 const rows=useMemo(()=>sortResultRows(queryResultRows(result.points.filter(p=>matches(p.label)),''),sort),[result.points,query,sort,labels])
 const unavailable=useMemo(()=>queryResultRows((result.unavailableGroups??[]).filter(p=>matches(p.label)),''),[result.unavailableGroups,query,labels])
 const total=result.points.length+(result.unavailableGroups?.length??0)
 const shown=rows.length+unavailable.length
 const columnCount=3+(result.mapping.rate?3:0)+(baseline!==undefined?1:0)
 return <div className="bundle-table-wrap">
  {controls && <div className="result-table-controls">
   <label className="result-table-search"><Search size={14}/><span className="sr-only">搜索分组</span><input aria-label="搜索分组" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索分组" /></label>
   <label>排序<select aria-label="结果排序" value={sort} onChange={e=>setSort(e.target.value as ResultSort)}><option value="original">计算顺序</option><option value="desc">数值从高到低</option><option value="asc">数值从低到高</option><option value="label">分组名排序</option></select></label>
   <span>{query.trim()?`显示 ${shown} / ${total} 个分组`:`共 ${total} 个分组`}</span>
  </div>}
  <div className="bundle-table"><table><thead><tr><th>分组</th><th>结果{result.mapping.unit && !result.mapping.metric.includes(result.mapping.unit) ? '（'+result.mapping.unit+'）' : ''}</th>{result.mapping.rate && <><th>分子</th><th>分母</th><th>排除</th></>}{baseline!==undefined&&<th>较来源分组<small>（百分点）</small></th>}<th>来源</th></tr></thead><tbody>{rows.map(p=><tr key={p.label} className={selected===p.label?'is-selected':''}><td>{onSelect?<button className="group-select" aria-pressed={selected===p.label} onClick={()=>onSelect(p.label)}>{labels.value(result.mapping.x,p.label)}</button>:labels.value(result.mapping.x,p.label)}</td><td>{formatNumber(p.value,4)}</td>{p.rate && <><td>{p.rate.numerator}</td><td>{p.rate.denominator}</td><td>{p.rate.excluded}</td></>}{baseline!==undefined&&<td className={p.value>=baseline?'delta-positive':'delta-negative'}>{p.value>baseline?'+':''}{formatNumber(p.value-baseline,2)}</td>}<td>{onEvidence?<button className="text-button" onClick={()=>onEvidence(result.id,p.label)}>{p.rowIds.length} 条记录</button>:p.rowIds.length+' 条记录'}</td></tr>)}{unavailable.map(p=><tr key={'unavailable-'+p.label}><td>{labels.value(result.mapping.x,p.label)}</td><td>无法计算</td>{result.mapping.rate&&<><td>0</td><td>0</td><td>{p.excluded}</td></>}{baseline!==undefined&&<td>无法计算</td>}<td>分母为零</td></tr>)}{shown===0&&<tr><td colSpan={columnCount} className="result-table-empty">没有匹配的分组，请换一个关键词。</td></tr>}</tbody></table></div>
 </div>
}
