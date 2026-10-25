import { Database, Search, Settings2, ShieldCheck, Type, Hash, CalendarDays, ChevronRight, ListChecks } from 'lucide-react'
import type { Dataset } from './data'
import type { Checkup, CheckupRole } from './checkup'
type Profile = {key:string;kind:string;missing:number;nonempty:number}
type Props = {dataset:Dataset;profiles:Profile[];checkup:Checkup|null;search:string;onSearch:(s:string)=>void;onData:(field?:string)=>void;onPrepare:()=>void;onSource:()=>void;onRoles:()=>void;onCheckup?:()=>void}
type ShelfField = {key:string;label:string;missing:number;overridden:boolean;autoLabel?:string;detail?:string;role?:CheckupRole}
export default function FieldShelf({dataset,profiles,checkup,search,onSearch,onData,onPrepare,onSource,onRoles,onCheckup}:Props){
 // The checkup already applies the user's role corrections; prefer it over the
 // raw profile so this drawer never contradicts the checkup page or data table.
 const all:ShelfField[] = checkup ? checkup.all.map(field=>({key:field.key,label:field.roleLabel,missing:field.missing,overridden:!!field.overridden,autoLabel:field.autoRoleLabel,detail:field.detail,role:field.role})) : profiles.map(profile=>({key:profile.key,label:profile.kind,missing:profile.missing,overridden:false}))
 const fields=all.filter(p=>p.key.toLowerCase().includes(search.toLowerCase()))
 const missing=all.filter(p=>p.missing>0).length
 return <aside className="field-shelf" aria-label="数据字段面板">
  <div className="shelf-dataset"><span className="shelf-eyebrow">数据资源</span><div className="shelf-file-name"><Database size={18}/><strong title={dataset.title}>{dataset.title}</strong></div><p>{dataset.rows.length.toLocaleString()} 行 <span>·</span> {dataset.headers.length} 个字段</p><button className="text-button" onClick={onSource}><ShieldCheck size={14}/>核对数据来源<ChevronRight size={13}/></button></div>
  <div className="shelf-heading"><h2>字段</h2><button className="icon-button" onClick={onPrepare} aria-label="清理与处理数据" title="清理与处理数据"><Settings2 size={16}/></button></div>
  <label className="shelf-search"><Search size={15}/><input aria-label="搜索数据字段" placeholder="查找字段…" value={search} onChange={e=>onSearch(e.target.value)}/></label>
  <div className="shelf-fields">{fields.map(field=>{const Icon=field.role==='measure'||(!field.role&&field.label==='数值')?Hash:field.role==='time'||(!field.role&&field.label.includes('日期'))?CalendarDays:Type;return <button className="shelf-field" key={field.key} onClick={()=>onData(field.key)} title={field.key+' · '+field.label+'候选'+(field.overridden?'（手动纠正，自动判断为 '+(field.autoLabel??'其他')+'）':'')+(field.detail?' · '+field.detail:'')+(field.missing?' · 缺失 '+field.missing+' 行':'')}><Icon size={15}/><span>{field.key}</span><small>{field.label}</small>{field.overridden&&<em>已纠正</em>}{field.missing>0&&<i aria-label={'缺失 '+field.missing+' 行'}/>}</button>})}{!fields.length&&<p className="shelf-no-match">没有匹配字段</p>}</div>
  <div className="shelf-quality"><span><ShieldCheck size={15}/>{missing?missing+' 个字段存在缺失':'未发现空值'}</span><p>字段类型为候选，分析前需核对业务含义。</p>{checkup&&<button className="text-button" onClick={onRoles}><ListChecks size={14}/>纠正字段类型<ChevronRight size={13}/></button>}{onCheckup&&<button className="text-button" onClick={onCheckup}><ChevronRight size={14}/>回到数据体检</button>}<button className="text-button" onClick={()=>onData()}>查看全部 {dataset.headers.length} 个字段<ChevronRight size={14}/></button></div>
 </aside>
}
