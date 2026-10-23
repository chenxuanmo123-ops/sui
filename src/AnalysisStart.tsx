import { ArrowUpRight, Table2, ShieldCheck, Settings2, ArrowRight } from 'lucide-react'
import type { Dataset } from './data'
type Profile = {key:string;kind:string;missing:number;nonempty:number}
type Props = {dataset:Dataset;profiles:Profile[];onPrepare:()=>void;onExplore:()=>void;onData:()=>void;onField:(key:string)=>void}
export default function AnalysisStart({dataset,profiles,onPrepare,onExplore,onData,onField}:Props){
 const headers=dataset.headers.slice(0,6)
 const missing=profiles.reduce((n,p)=>n+p.missing,0)
 return <div className="data-review">
  <header className="review-intro"><div><span className="task-status"><ShieldCheck size={15}/>文件已读取</span><h1>先看清数据，再问好问题。</h1><p>从质量检查、分组统计和图表开始，也可以让 AI 协助规划。计算由本地数据引擎完成，无需模型。</p></div><button className="secondary" onClick={onExplore}>直接创建图表<ArrowUpRight size={16}/></button></header>
  <div className="review-facts"><span><strong>{dataset.rows.length.toLocaleString()}</strong> 条原始记录</span><span><strong>{dataset.headers.length}</strong> 个字段</span><span className={missing?'has-issues':''}><strong>{missing.toLocaleString()}</strong> 个空值单元格</span><button className="text-button" onClick={onPrepare}><Settings2 size={15}/>{missing?'检查并处理空值':'检查数据质量'}<ArrowRight size={14}/></button></div>
  <section className="canvas-data-preview" aria-label="原始数据快速预览"><header><span><Table2 size={16}/>原始记录</span><small>前 {Math.min(dataset.rows.length,5)} 行 · 前 {headers.length} 列</small><button className="text-button" onClick={onData}>查看全部数据<ArrowUpRight size={14}/></button></header><div className="canvas-preview-scroll"><table><thead><tr><th>记录号</th>{headers.map(h=><th key={h} title={h}>{h}</th>)}</tr></thead><tbody>{dataset.rows.slice(0,5).map((row,i)=><tr key={i}><td>{dataset.sourceRecords?.[i]??i+2}</td>{headers.map(h=><td key={h} title={String(row[h]??'')}>{String(row[h]??'—')}</td>)}</tr>)}</tbody></table></div></section>
  <div className="review-fields"><p>字段速览 <span>类型为候选；点击核对含义和质量</span></p><div>{profiles.slice(0,10).map(p=><button key={p.key} onClick={()=>onField(p.key)} title={p.key+' · '+p.kind+(p.missing?' · 空值 '+p.missing:'')}><span>{p.key}</span><small>{p.kind}</small>{p.missing>0&&<i/>}</button>)}{profiles.length>10&&<button className="remaining-fields" onClick={()=>onField('')}>其余 {profiles.length-10} 个字段<ArrowUpRight size={13}/></button>}</div></div>
 </div>
}
