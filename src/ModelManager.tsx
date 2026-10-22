import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Eye, EyeOff, KeyRound, LoaderCircle, Plus, Radio, Server, ShieldCheck, Trash2, X } from 'lucide-react';
import { aiRequest } from './ai';
import RequestProgress from './RequestProgress';
import { modelRequest } from './models';
import type { ModelProfile } from './models';
type Props = { open: boolean; onClose: () => void; profiles: ModelProfile[]; selectedId: string; onSelect: (id: string) => void; onSave: (p: ModelProfile, makeDefault?: boolean) => Promise<void>; onRemove: (id: string) => Promise<void>; defaultId: string; canManage: boolean; onDefault: (id: string) => Promise<void> };
const blank = (): ModelProfile => ({ id: 'user_' + crypto.randomUUID(), name: '', baseURL: '', apiKey: '', model: '', jsonMode: true, source: 'browser' });
export default function ModelManager({ open, onClose, profiles, selectedId, onSelect, onSave, onRemove, defaultId, canManage, onDefault }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ModelProfile>(blank);
  const [makeDefault, setMakeDefault] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const active = useRef<AbortController | null>(null);
  const serial = useRef(0);
  function invalidate() { serial.current++; active.current?.abort(); setBusy(''); setMessage(''); setModels([]); }
  useEffect(() => {
    if (open) { setDraft(profiles.find(p => p.id === selectedId) || blank()); setMakeDefault(selectedId === defaultId); setShowKey(false); setMessage(''); setModels([]); ref.current?.showModal(); }
    else { ref.current?.close(); invalidate(); }
    return () => { serial.current++; active.current?.abort(); };
  }, [open]);
  function change(patch: Partial<ModelProfile>) { invalidate(); setDraft(d => ({ ...d, ...patch })); }
  function choose(p: ModelProfile) { invalidate(); setDraft({ ...p, apiKey: '' }); setMakeDefault(p.id === defaultId); setShowKey(false); }
  const server = draft.source === 'server' && !draft.editable;
  const stored = draft.source === 'server' && draft.editable;
  let addressError = '';
  if (!server && draft.baseURL) {
    try { const url = new URL(draft.baseURL.trim());
      if (url.username || url.password || url.search || url.hash) addressError = '接口根地址不能含账号、密码、查询参数或片段。';
      else if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) addressError = '请使用 HTTPS；本机模型可使用 localhost HTTP。';
    } catch { addressError = '请输入完整的 API 根地址。'; }
  }
  const endpointValid = !addressError && (server || !!(draft.name.trim() && draft.baseURL?.trim() && (draft.apiKey?.trim() || stored)));
  const valid = endpointValid && !!draft.model.trim();
  async function probe(action: 'test' | 'models') {
    if (action === 'models' ? !endpointValid : !valid) return;
    invalidate(); const current = ++serial.current; const c = new AbortController(); active.current = c; setBusy(action); setFailed(false); setMessage(action === 'models' ? '正在向服务商获取可用模型…' : '正在测试真实文本调用，请稍候…');
    try {
      const result = await aiRequest<{ models?: string[]; latencyMs?: number }>(action, server ? modelRequest(draft) : { provider: { id: draft.id, name: draft.name, baseURL: draft.baseURL || '', apiKey: draft.apiKey || '', model: draft.model || 'model-list', jsonMode: draft.jsonMode !== false } }, c.signal);
      if (current !== serial.current) return;
      if (action === 'models') { const available = result.models || []; setModels(available); if (!draft.model.trim() && available.length) setDraft(d => ({ ...d, model: available[0] })); setMessage('已获取 ' + available.length + ' 个模型。点击下方模型名称选择；也可手动输入。'); }
      else setMessage('连接成功 · ' + result.latencyMs + ' ms · 已收到真实文本响应。分析协议兼容性在首次规划时校验。');
    } catch (e) { if (current === serial.current) { setFailed(true); setMessage(e instanceof Error ? e.message : '连接失败'); } }
    finally { if (current === serial.current) setBusy(''); }
  }
  return <dialog className="model-dialog" ref={ref} aria-labelledby="model-title" onCancel={onClose} onClose={onClose}>
    <header className="model-header"><div><span className="model-symbol"><Server size={21} /></span><div><h2 id="model-title">模型连接</h2><p>选择你的 AI，让它专注于数据分析。</p></div></div><button className="icon-button" onClick={onClose} aria-label="关闭模型连接"><X size={20} /></button></header>
    <div className="model-layout"><nav className="model-list" aria-label="已保存的模型连接"><div className="model-list-label">我的连接 <span>{profiles.length}</span></div>{profiles.map(p => <button key={p.id} className={'model-item ' + (draft.id === p.id ? 'active' : '')} onClick={() => choose(p)}><Server size={17} /><span><strong>{p.name}</strong><small>{p.model}{p.id === defaultId ? ' · 默认分析' : ''}{p.source === 'browser' && !p.apiKey ? ' · 待填写密钥' : ''}</small></span>{selectedId === p.id && <Check size={15} />}</button>)}<button className="add-model" disabled={profiles.filter(p => p.source === 'browser' || p.editable).length >= 8} onClick={() => { invalidate(); setDraft(blank()); setMakeDefault(false); setShowKey(false); }}><Plus size={16} />添加连接</button><p className="model-list-note">可添加不同服务商，随时切换。支持 OpenAI 兼容的 Chat Completions 协议。</p></nav>
    <form className="model-form" onSubmit={async e => {
      e.preventDefault(); if (!valid || busy) return;
      setBusy('save'); setFailed(false); setMessage('正在保存连接…');
      try {
        if (server) { if (makeDefault && canManage) await onDefault(draft.id); onSelect(draft.id); }
        else await onSave({ ...draft, name: draft.name.trim(), baseURL: draft.baseURL?.trim().replace(/\/$/, '').replace(/\/(chat\/completions|models)$/, ''), apiKey: draft.apiKey?.trim(), model: draft.model.trim() }, makeDefault);
        onClose();
      } catch (e) { setFailed(true); setMessage(e instanceof Error ? e.message : '保存失败，原配置仍保留'); }
      finally { setBusy(''); }
    }}>
      <div className="model-form-heading"><h3>{server ? '部署者提供的连接' : '配置 AI 接口'}</h3><span className="tag">{server ? '服务端保管密钥' : '自定义接口'}</span></div>
      {!server && <div className="provider-quickstart"><button className="secondary" type="button" disabled={!!busy || profiles.filter(p => p.source === 'browser' || p.editable).length >= 8} onClick={() => { invalidate(); setDraft({ ...blank(), name: 'DeepSeek', baseURL: 'https://api.deepseek.com' }); setMakeDefault(false); setShowKey(false); }}>添加 DeepSeek 官方连接</button><span>创建新连接，不覆盖已有密钥；模型 ID 通过“获取列表”选择。</span></div>}
      <label htmlFor="model-name">连接名称</label><input id="model-name" value={draft.name} onChange={e => change({ name: e.target.value })} maxLength={80} placeholder="例如：我的数据分析模型" required disabled={server} />
      {!server && <><label htmlFor="model-base">API Base URL</label><input id="model-base" value={draft.baseURL} onChange={e => change({ baseURL: e.target.value })} type="url" placeholder="https://你的服务地址/v1" required maxLength={2048} /><small>填写服务商提供的兼容接口根地址，保留版本路径；自动追加 /chat/completions。</small>{addressError && <p className="connection-feedback" role="alert">{addressError}</p>}<label htmlFor="model-key">API Key</label><div className="key-input"><input id="model-key" type={showKey ? 'text' : 'password'} value={draft.apiKey || ''} onChange={e => change({ apiKey: e.target.value })} placeholder={stored ? '已保存在本机；留空保持原密钥' : '输入你的 API Key'} autoComplete="off" required={!stored} maxLength={8192} spellCheck={false} /><button type="button" className="icon-button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></>}
      <label htmlFor="model-id">模型 ID</label><div className="model-id-row"><input id="model-id" value={draft.model} onChange={e => change({ model: e.target.value })} placeholder="填写服务商的实际模型 ID" maxLength={200} required disabled={server} list="available-models" /><button className="secondary" type="button" disabled={!endpointValid || !!busy} onClick={() => void probe('models')}>{busy === 'models' ? <LoaderCircle className="spin" size={15} /> : <ChevronRight size={15} />}获取列表</button></div><datalist id="available-models">{models.map(m => <option value={m} key={m} />)}</datalist><small>模型列表接口并非每家都提供，可直接填写模型 ID。</small>{models.length > 0 && <div className="available-model-buttons" aria-label="可用模型">{models.map(model => <button type="button" key={model} disabled={!!busy} aria-pressed={draft.model === model} onClick={() => { setDraft(d => ({ ...d, model })); setMessage('已选择模型：' + model); }}>{model}</button>)}</div>}
      {!server && <label className="ai-check"><input type="checkbox" checked={draft.jsonMode !== false} onChange={e => change({ jsonMode: e.target.checked })} />启用 JSON 输出模式（接口不支持时关闭，结果仍需通过结构校验）</label>}
      {canManage && <label className="ai-check"><input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} />设为内置 AI 的默认分析模型（上传后初步定位）</label>}
      <div className="key-policy"><KeyRound size={16} /><p>{canManage ? '保存后可跨刷新和重启使用，密钥保存在本机 .local/model-connections.json，属于本机明文配置，已排除 Git；网页不会读回密钥。修改时留空即可保留原密钥。' : '当前是远程访问，不能修改服务器默认模型。自填密钥仅保留当前页面，刷新后需重填。'}</p></div>
      <RequestProgress active={busy === 'test' || busy === 'models'} label={busy === 'models' ? '正在获取可用模型' : '正在测试模型连接'} />
      {(busy === 'test' || busy === 'models') && <button className="text-button" type="button" onClick={() => { invalidate(); setFailed(false); setMessage('请求已取消，未修改连接配置。'); }}>取消连接请求</button>}
      <div className="connection-feedback" role={failed ? 'alert' : 'status'}>{message && <><ShieldCheck size={16} /><span>{message}</span></>}</div>
      <div className="model-form-actions"><button className="secondary" type="button" onClick={() => void probe('test')} disabled={!valid || !!busy}>{busy === 'test' ? <LoaderCircle size={16} className="spin" /> : <Radio size={16} />}测试连接</button>{!server && profiles.some(p => p.id === draft.id) && <button type="button" className="delete-model" disabled={!!busy} onClick={async () => { setBusy('delete'); try { await onRemove(draft.id); invalidate(); setDraft(blank()); setMakeDefault(false); } catch (e) { setFailed(true); setMessage(e instanceof Error ? e.message : '删除失败'); } finally { setBusy(''); } }} aria-label="删除此连接"><Trash2 size={17} /></button>}<button className="primary" type="submit" disabled={!valid || !!busy}>{busy === 'save' ? '正在保存…' : '保存并使用'}<Check size={16} /></button></div><p className="probe-note">测试会发起真实文本请求，可能产生费用；推理模型可能消耗更多 token。保存连接不等于测试成功。</p>
    </form></div>
  </dialog>;
}
