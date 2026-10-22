import { useState } from 'react'
import { ArrowRight, FileSpreadsheet, FileText, ShieldCheck, Table2, Upload, ArrowUpRight } from 'lucide-react'
type Props = {onPick:(accept?:string)=>void;onFile:(file:File)=>void;busy:boolean;configured:boolean;onConfigure:()=>void;onPublic:()=>void}
export default function WorkspaceWelcome({onPick,onFile,busy,configured,onConfigure,onPublic}:Props){
 const [dragging,setDragging]=useState(false)
 return <section className="workspace-welcome" aria-label="开始数据分析">
  <div className="welcome-copy"><div className="welcome-title-line"><span className="welcome-product">数鉴 · AI 数据分析</span><span>从真实文件开始</span></div><h1>让数据里的问题，<br/>有答案，有依据。</h1><p>带上一份表格或报告。与 AI 一起理解数据、验证想法，把每一个发现追溯到原始记录。</p><div className="welcome-method"><div><strong>读懂</strong><span>先确认字段与分析口径</span></div><div><strong>验证</strong><span>执行计算，再解释结果</span></div><div><strong>追溯</strong><span>从图表回到来源记录</span></div></div></div>
  <div className="intake-area"><div className={'file-dropzone'+(dragging?' dragging':'')} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);const file=e.dataTransfer.files[0];if(file&&!busy)onFile(file)}}><div className="intake-glyph" aria-hidden="true"><Table2 size={40} strokeWidth={1}/><span>+</span></div><h2>把文件放在这里</h2><p>拖入文件，或从电脑中选择</p><button className="primary" disabled={busy} onClick={()=>onPick()}><Upload size={17}/>选择文件<ArrowRight size={17}/></button><small>CSV / XLSX / XLS / PDF · 最大 30 MB</small></div>
   <div className="format-options">{[{accept:'.xlsx,.xls',Icon:FileSpreadsheet,title:'Excel',detail:'选择工作表与表头'},{accept:'.csv',Icon:Table2,title:'CSV',detail:'读取并检查原始值'},{accept:'.pdf',Icon:FileText,title:'PDF',detail:'提取表格后人工核对'}].map(({accept,Icon,title,detail})=><button key={title} onClick={()=>onPick(accept)} disabled={busy}><Icon size={17}/><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14}/></button>)}</div>
   <button className="public-entry text-button" disabled={busy} onClick={onPublic}>手边没有文件？载入带来源的公开数据<ArrowUpRight size={15}/></button>
  </div>
  <div className="welcome-bottom"><div className="welcome-trust"><ShieldCheck size={17}/><span>文件在浏览器读取；模型所需数据按授权发送。</span></div><div className="welcome-connection"><span className={'connection-indicator'+(configured?' ready':'')}/><span>{configured?'默认分析模型已就绪':'先检查文件，也可稍后连接 AI'}</span><button className="text-button" onClick={onConfigure}>{configured?'管理模型':'连接模型'}<ArrowRight size={14}/></button></div></div>
 </section>
}
