import { useState } from 'react'
import type { Dataset } from './data'
import { safeSourceURL, sourceInfo, sourceRows, validateSourceNotes } from './provenance'
import type { SourceNotes } from './provenance'

export function SourceSummary({ dataset, onOpen }: { dataset: Dataset; onOpen?: () => void }) {
  const s = sourceInfo(dataset), url = safeSourceURL(s.url)
  return <aside className="dataset-source-note" aria-label="数据出处摘要"><div><strong>数据出处：</strong>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{s.publisher ? s.publisher + ' · ' : ''}{s.title} ↗</a> : <span>{s.publisher ? s.publisher + ' · ' : ''}{s.title}</span>}<small>{s.status}</small></div>{onOpen && <button className="text-button" onClick={onOpen}>查看 / 备注出处</button>}</aside>
}
export function SourceDetails({ dataset }: { dataset: Dataset }) {
  return <dl className="source-details">{sourceRows(dataset).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{(key === '来源页面' || key === '原始下载地址') && safeSourceURL(value) ? <a href={safeSourceURL(value)} target="_blank" rel="noopener noreferrer">{value} ↗</a> : value}</dd></div>)}</dl>
}
const fields: [keyof SourceNotes, string][] = [['title','数据集名称'],['publisher','发布机构 / 平台'],['url','来源页面'],['downloadUrl','原始下载地址'],['citation','推荐引用'],['license','许可与使用条件'],['accessedAt','获取 / 核验日期'],['coverage','数据范围与时效'],['notes','来源备注']]
export function SourceEditor({ dataset, onSave }: { dataset: Dataset; onSave: (source: SourceNotes | undefined) => void }) {
  const [draft, setDraft] = useState<SourceNotes>(() => sourceInfo(dataset))
  const [error, setError] = useState(''), [saved, setSaved] = useState(false)
  function reset() { setDraft(sourceInfo({ ...dataset, sourceNotes: undefined })); setError(''); setSaved(false); onSave(undefined) }
  return <details className="source-editor"><summary>补充或修改数据出处</summary><p>上传者备注只作为来源声明，不会被标为平台已核验。随当前工作区保存到此浏览器，并随 HTML 报告导出；显示“已保存到本机”后刷新可恢复，重新导入会替换。来源备注不发送给 AI；需要模型参考时，请在分析背景中明确提供。</p><form onSubmit={event => { event.preventDefault(); const clean = Object.fromEntries(fields.map(([key]) => [key, draft[key].trim()])) as SourceNotes; const message = validateSourceNotes(clean); if (message) { setError(message); setSaved(false); return } onSave(clean); setDraft(clean); setError(''); setSaved(true) }}><div className="source-editor-grid">{fields.map(([key, label]) => <label key={key}>{label}{['citation','coverage','notes','license'].includes(key) ? <textarea aria-label={'出处：' + label} maxLength={2000} rows={3} value={draft[key]} onChange={e => { setDraft({ ...draft, [key]: e.target.value }); setSaved(false) }} /> : <input aria-label={'出处：' + label} type={key === 'accessedAt' ? 'date' : 'text'} maxLength={2000} placeholder={key === 'url' || key === 'downloadUrl' ? 'https://…' : ''} value={draft[key]} onChange={e => { setDraft({ ...draft, [key]: e.target.value }); setSaved(false) }} />}</label>)}</div>{error && <p className="ai-error" role="alert">{error}</p>}<div className="core-actions"><button className="primary" type="submit">保存出处备注</button><button className="secondary" type="button" onClick={reset}>清除自填备注</button>{saved && <span role="status">出处备注已更新；请以上方本机保存状态为准，导出报告会包含这些内容。</span>}</div></form></details>
}
