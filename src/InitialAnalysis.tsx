import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, BrainCircuit, Check, LoaderCircle, RefreshCcw, Settings2, ShieldCheck } from 'lucide-react';
import { aiRequest, datasetContext } from './ai';
import RequestProgress from './RequestProgress';
import type { Dataset } from './data';
import type { ModelProfile } from './models';
type Inspection = { summary: string; scene: string; grain: string; fields: { field: string; meaning: string; role: string }[]; risks: { title: string; detail: string; fields: string[] }[]; directions: { title: string; question: string; requiredContext: string }[]; questions: string[]; limitations: string[] };
type Result = { inspection: Inspection; datasetHash: string; model: string; providerName: string; generatedAt: string };
const autoKey = 'shujian.auto-inspection.v1';
function rememberedConsent() { try { return localStorage.getItem(autoKey) === 'true'; } catch { return false; } }
type Props = { allowAutomatic?: boolean; dataset: Dataset | null; profile?: ModelProfile; loading: boolean; onConfigure: () => void; onQuestion: (question: string, context: string) => void };
export default function InitialAnalysis({ dataset, profile, loading, onConfigure, onQuestion, allowAutomatic = true }: Props) {
  const [background, setBackground] = useState('');
  const [samples, setSamples] = useState(false);
  const [auto, setAuto] = useState(rememberedConsent);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const key = JSON.stringify([dataset?.fingerprint, dataset?.loadedAt, profile?.id, profile?.revision, background, samples]);
  const latest = useRef(key); latest.current = key;
  const sent = useRef('');
  useEffect(() => { try { localStorage.setItem(autoKey, String(auto)); } catch { /* Optional preference. */ } }, [auto]);
  useEffect(() => { setBackground(''); setSamples(false); }, [dataset?.fingerprint, dataset?.loadedAt]);
  useEffect(() => {
    generation.current++; controller.current?.abort(); setBusy(false); setResult(null); setError(''); sent.current = '';
    return () => { generation.current++; controller.current?.abort(); };
  }, [key]);
  async function inspect() {
    if (!dataset || !profile || loading) return;
    const current = ++generation.current, requestKey = key;
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setBusy(true); setError(''); setResult(null); sent.current = requestKey;
    try {
      const response = await aiRequest<Result>('inspect', { consent: true, context: background, includeSamples: samples, dataset: datasetContext(dataset, samples) }, c.signal);
      if (current === generation.current && latest.current === requestKey) {
        if (response.datasetHash !== dataset.fingerprint) throw new Error('数据快照不匹配，请重新定位');
        setResult(response);
      }
    } catch (e) { if (current === generation.current && !c.signal.aborted) setError(e instanceof Error ? e.message : '初步定位失败，请重试'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  useEffect(() => { if (allowAutomatic && auto && !background && !samples && dataset && profile && !loading && sent.current !== key) void inspect(); }, [auto, key, loading, allowAutomatic]);
  function cancel() { generation.current++; controller.current?.abort(); setBusy(false); setError('本次初步定位已取消，文件和计算结果保留。'); }
  const item = result?.inspection;
  return <section className="initial-analysis" aria-labelledby="initial-title" aria-busy={busy}>
    <header className="initial-heading"><div className="initial-icon"><BrainCircuit size={21} /></div><div><h2 id="initial-title">数据初步定位</h2><p>{profile ? '默认模型 · ' + profile.name + ' · ' + profile.model : '连接默认分析模型，让 AI 先读懂数据结构'}</p></div><span className="tag">{busy ? '正在识别' : item ? '待确认的分析建议' : '分析前准备'}</span></header>
    {!item && <p className="initial-description">先检查数据适合回答什么、哪些字段需要确认，再确定分析方向。初步定位默认只发送字段名、类型候选和质量摘要；原始值样本需另行授权。</p>}
    <RequestProgress active={busy} label="正在等待数据初步定位" />
    {dataset && <details className="initial-options"><summary>补充业务背景与样本授权</summary><label htmlFor="initial-background">数据来源与行粒度（可选）</label><textarea id="initial-background" value={background} maxLength={5000} rows={2} onChange={e => setBackground(e.target.value)} placeholder="例如：每行代表什么、指标单位、统计范围；不确定的地方可以写待确认。" /><label className="ai-check"><input type="checkbox" checked={samples} onChange={e => setSamples(e.target.checked)} />本次手动定位附带每列最多三个原始值样本（请先检查隐私）</label><small>自动定位只发送元数据；填写背景或勾选样本后，请点击按钮手动发送。</small></details>}
    <div className="initial-controls"><label className="ai-check"><input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); if (!e.target.checked && busy) cancel(); }} />允许上传后自动发送字段与质量摘要给默认模型</label><div>{!profile ? <button className="secondary" onClick={onConfigure}><Settings2 size={15} />设置默认模型</button> : <button className="secondary" disabled={!dataset || loading || busy} onClick={() => void inspect()}>{busy ? <LoaderCircle className="spin" size={15} /> : item ? <RefreshCcw size={15} /> : <BrainCircuit size={15} />}{busy ? '分析结构中…' : item ? '重新定位' : '授权并开始初步定位'}</button>}{busy && <button className="text-button" onClick={cancel}>取消</button>}</div></div>
    {dataset && !allowAutomatic && auto && <p className="initial-note">已恢复保存的工作区，本次不会自动调用模型。需要重新识别时，可点击“授权并开始初步定位”。自动定位授权将在新导入数据时继续生效。</p>}
    {!dataset && <p className="initial-note">导入真实 CSV、Excel 或核对后的 PDF 表格后开始。不会自动生成或填充业务数据。</p>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    {busy && <p className="initial-note" role="status"><LoaderCircle className="spin" size={14} />正在检查字段关系与分析边界，尚未执行业务计算。</p>}
    {item && <div className="initial-result"><p className="initial-summary">{item.summary}</p><dl className="initial-understanding"><div><dt>候选场景</dt><dd>{item.scene}</dd></div><div><dt>行粒度待确认</dt><dd>{item.grain}</dd></div></dl>
      {item.risks.length > 0 && <div className="initial-risks">{item.risks.map((risk, i) => <article key={i}><ShieldCheck size={16} /><div><strong>{risk.title}</strong><p>{risk.detail}</p>{risk.fields.length > 0 && <small>关联字段：{risk.fields.join('、')}</small>}</div></article>)}</div>}
      {item.questions.length > 0 && <details className="initial-questions" open><summary>分析前需要你确认</summary><ul>{item.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></details>}
      {item.directions.length > 0 && <div className="initial-directions"><h3>建议从这些问题开始</h3><div>{item.directions.map((direction, i) => <button key={i} onClick={() => onQuestion(direction.question, background)}><span><strong>{direction.title}</strong><span>{direction.question}</span><small>需补充：{direction.requiredContext}</small></span><ArrowUpRight size={18} /></button>)}</div></div>}
      <details><summary>字段候选与分析边界</summary><ul>{item.fields.map(f => <li key={f.field}><strong>{f.field}</strong>：{f.meaning}（候选：{f.role}）</li>)}</ul><ul>{item.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul></details>
      <p className="initial-note"><Check size={13} />来自实际模型调用 · {result.providerName} · {new Date(result.generatedAt).toLocaleTimeString('zh-CN', { hour12: false })} · 初步建议需要确认</p>
    </div>}
  </section>;
}
