import { Database, Search, Settings2, ShieldCheck, Type, Hash, CalendarDays, ChevronRight } from 'lucide-react'
import type { Dataset } from './data'
type Profile = {key:string;kind:string;missing:number;nonempty:number}
type Props = {dataset:Dataset;profiles:Profile[];search:string;onSearch:(s:string)=>void;onData:(field?:string)=>void;onPrepare:()=>void;onSource:()=>void}
export default function FieldShelf({dataset,profiles,search,onSearch,onData,onPrepare,onSource}:Props){
 const fields=profiles.filter(p=>p.key.toLowerCase().includes(search.toLowerCase()))
 const missing=profiles.filter(p=>p.missing>0).length
 return <aside className="field-shelf" aria-label="数据字段面板">
  <div className="shelf-dataset"><span className="shelf-eyebrow">数据资源</span><div className="shelf-file-name"><Database size={18}/><strong title={dataset.title}>{dataset.title}</strong></div><p>{dataset.rows.length.toLocaleString()} 行 <span>·</span> {dataset.headers.length} 个字段</p><button className="text-button" onClick={onSource}><ShieldCheck size={14}/>核对数据来源<ChevronRight size={13}/></button></div>
  <div className="shelf-heading"><h2>字段</h2><button className="icon-button" onClick={onPrepare} aria-label="清理与处理数据" title="清理与处理数据"><Settings2 size={16}/></button></div>
  <label className="shelf-search"><Search size={15}/><input aria-label="搜索数据字段" placeholder="查找字段…" value={search} onChange={e=>onSearch(e.target.value)}/></label>
  <div className="shelf-fields">{fields.map(field=>{const Icon=field.kind==='数值'?Hash:field.kind.includes('日期')?CalendarDays:Type;return <button className="shelf-field" key={field.key} onClick={()=>onData(field.key)} title={field.key+' · '+field.kind+'候选'+(field.missing?' · 缺失 '+field.missing+' 行':'')}><Icon size={15}/><span>{field.key}</span><small>{field.kind}</small>{field.missing>0&&<i aria-label={'缺失 '+field.missing+' 行'}/>}</button>})}{!fields.length&&<p className="shelf-no-match">没有匹配字段</p>}</div>
  <div className="shelf-quality"><span><ShieldCheck size={15}/>{missing?missing+' 个字段存在缺失':'未发现空值'}</span><p>字段类型为候选，分析前需核对业务含义。</p><button className="text-button" onClick={()=>onData()}>查看全部 {dataset.headers.length} 个字段<ChevronRight size={14}/></button></div>
 </aside>
}
