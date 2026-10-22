import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { BrainCircuit, ChevronRight, LoaderCircle, Settings2 } from 'lucide-react';
import { aiRequest, datasetContext, evidenceFacts, inspectPlanFilters, mergeRepairPlan, mergeExecution } from './ai';
import type { Fact, PlanExecution, PlanResponse, Review } from './ai';
import { aggregateNames } from './data';
import type { Analysis, Dataset, Mapping } from './data';
import { modelRequest } from './models';
import RequestProgress from './RequestProgress';
import type { AnalysisBundle } from './AnalysisResults';
import type { ModelProfile } from './models';
import { scopeContext, validateScope } from './follow-up';
import type { AssistantSeed } from './follow-up';

type Props = { onBundle?: (bundle: AnalysisBundle) => void; seed?: AssistantSeed; profiles: ModelProfile[]; selected?: ModelProfile; onSelect: (id: string) => void; onConfigure: () => void; status: string; ready: boolean; dataset: Dataset | null; loading: boolean; onExecute: (plan: PlanResponse, question: string) => Promise<PlanExecution>; onEvidence: (id: number, label?: string) => void };
function describeMapping(mapping: Mapping) {
  const bucket = mapping.timeBucket === 'month' ? '（按月）' : mapping.timeBucket === 'year' ? '（按年）' : '';
  const filters = [mapping.filter ? mapping.filter + ' = “' + mapping.value + '”' : '', ...(mapping.conditions ?? []).map(condition => condition.field + ' ' + (condition.operator === 'eq' ? '=' : condition.operator === 'gte' ? '≥' : '≤') + ' “' + condition.value + '”')].filter(Boolean);
  return ['按 ' + mapping.x + bucket + ' 分组', '指标：' + mapping.metric, '汇总：' + (mapping.rate ? '条件计数比例；分子 ' + mapping.metric + '=' + JSON.stringify(mapping.rate.successValue) + '；分母 ' + JSON.stringify(mapping.rate.eligibleValues) : aggregateNames[mapping.aggregate]), '筛选：' + (filters.join('，') || '不筛选'), '分组范围：' + (mapping.from || '不限') + ' → ' + (mapping.to || '不限'), '单位：' + (mapping.unit || '待确认')].join('；');
}
export default function AiWorkbench({ seed, dataset, loading, onExecute, onEvidence, onBundle, profiles, selected, onSelect, onConfigure, status, ready }: Props) {
  const providerId = selected?.id || '';
  const providerBody = selected ? modelRequest(selected) : { providerId: '' };
  const [scope, setScope] = useState<AssistantSeed['scope']>();
  const runKey = useRef('');
  const [goal, setGoal] = useState('');
  const [context, setContext] = useState('');
  const requestContext = [context, scope ? scopeContext(scope) : ''].filter(Boolean).join('\n\n');
  const question = goal.trim() || '请先检查当前数据的结构与质量，提出可执行的描述性探索计划；业务含义不确定时明确标注，不推断总体或因果。';
  const [samples, setSamples] = useState(false);
  const [categories, setCategories] = useState(false);
  const [runResults, setRunResults] = useState<Analysis[]>([]);
  const [hasExecuted, setHasExecuted] = useState(false);
  const [repairRounds, setRepairRounds] = useState(0);
  const [pendingTaskIds, setPendingTaskIds] = useState<string[] | null>(null);
  const [repairChanges, setRepairChanges] = useState<{ title: string; before: Mapping; after: Mapping }[]>([]);
  const [planned, setPlanned] = useState<PlanResponse | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [runIds, setRunIds] = useState<number[]>([]);
  const [runTaskIds, setRunTaskIds] = useState<string[]>([]);
  const [executionFailures, setExecutionFailures] = useState<{ taskId: string; title: string; error: string }[]>([]);
  const [busy, setBusy] = useState<'plan' | 'review' | 'repair' | ''>('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [plannedInput, setPlannedInput] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);
  const inputKey = JSON.stringify({ goal, context, scope, samples, categories, providerId, revision: selected?.revision, hash: dataset?.fingerprint, loadedAt: dataset?.loadedAt });
  const inputRef = useRef(inputKey); inputRef.current = inputKey;
  const stale = Boolean(planned && inputKey !== plannedInput);
  const filterWarnings = useMemo(() => dataset && planned && !stale ? inspectPlanFilters(dataset, planned.plan) : [], [dataset, planned, stale]);

  useEffect(() => () => { controller.current?.abort(); version.current++; }, []);
  useEffect(() => {
    version.current++; controller.current?.abort(); setBusy(''); setPlanned(null); setReview(null); setFacts([]); setRunIds([]); setRunTaskIds([]); setExecutionFailures([]); setRunResults([]); setHasExecuted(false); setRepairRounds(0); setPendingTaskIds(null); setRepairChanges([]); setEvents([]); setError(''); setConfirmed(false); setGoal(''); setContext(''); setScope(undefined);
  }, [dataset?.fingerprint, dataset?.loadedAt]);
  useEffect(() => {
    setConfirmed(false);
    if (busy) { version.current++; controller.current?.abort(); setBusy(''); setEvents(e => [...e, '输入或授权已变化，取消旧模型请求，请重新规划。']); }
  }, [inputKey]);
  useEffect(() => { if (seed) { setGoal(seed.question); setContext(seed.context || ''); setScope(seed.scope); setConfirmed(false); } }, [seed?.nonce]);
  function cancel() { version.current++; controller.current?.abort(); setBusy(''); setEvents(e => [...e, '用户取消模型请求；已完成的计算结果保留。']); }
  async function plan(e?: FormEvent) {
    e?.preventDefault(); if (!dataset || busy || !ready) return;
    const current = ++version.current, key = inputKey;
    runKey.current = crypto.randomUUID();
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setBusy('plan'); setError(''); setReview(null); setFacts([]); setRunIds([]); setRunTaskIds([]); setExecutionFailures([]); setRunResults([]); setHasExecuted(false); setRepairRounds(0); setPendingTaskIds(null); setRepairChanges([]); setPlanned(null); setConfirmed(false);
    setEvents(['已读取本次数据的字段与质量统计。', '已向所选模型发送分析目标和上下文，等待分析计划。']);
    try {
      if (scope) validateScope(dataset, scope);
      if(requestContext.length>5000) throw new Error('背景与追问范围合计超过 5000 字，请缩短业务背景后重新规划。');
      const response = await aiRequest<PlanResponse>('plan', { ...providerBody, question, context: requestContext, includeSamples: samples, includeCategories: categories, dataset: datasetContext(dataset, samples, categories) }, c.signal);
      if (current !== version.current || key !== inputRef.current) return;
      setPlanned({ ...response, scope }); setPlannedInput(key);
      setEvents(events => [...events, response.plan.questions.length && response.plan.tasks.length ? '模型标记了待确认口径，但已给出可安全执行的描述性任务。' : response.plan.questions.length ? '当前没有可安全执行的任务，请补充澄清信息后重新规划。' : '模型计划通过结构与字段校验，等待确认口径。']);
    } catch (e) { if (current === version.current) setError(e instanceof Error ? e.message : '规划失败'); }
    finally { if (current === version.current) setBusy(''); }
  }
  async function repair() {
    if (!planned || !dataset || stale || busy || !executionFailures.length || pendingTaskIds || repairRounds >= 2) return;
    const current = ++version.current, key = inputKey, attempt = repairRounds + 1;
    const c = new AbortController(); controller.current?.abort(); controller.current = c;
    setBusy('repair'); setError(''); setRepairRounds(attempt); setConfirmed(false);
    setEvents(events => [...events, '修正第 ' + attempt + ' 轮：发送失败任务口径和真实错误，成功任务不重复计算。']);
    try {
      const response = await aiRequest<PlanResponse>('repair-plan', { ...providerBody, question, context: requestContext, includeSamples: samples, includeCategories: categories, dataset: datasetContext(dataset, samples, categories), previous: { plan: planned.plan, datasetHash: planned.datasetHash }, failures: executionFailures, attempt }, c.signal);
      if (current !== version.current || key !== inputRef.current) return;
      const merged = mergeRepairPlan(planned, response, executionFailures);
      setRepairChanges(response.plan.tasks.map(task => ({ title: task.title, before: planned.plan.tasks.find(t => t.id === task.id)!.mapping, after: task.mapping })));
      setPlanned(merged); setPendingTaskIds(response.plan.tasks.map(task => task.id)); setReview(null);
      setEvents(events => [...events, '已收到修正建议，原口径与新口径已并列展示。请核对后再次确认，仅重算失败任务。']);
    } catch (e) { if (current === version.current) setError(e instanceof Error ? e.message : '修正计划失败'); }
    finally { if (current === version.current) setBusy(''); }
  }
  async function execute() {
    if (!planned || !confirmed || stale || busy || !dataset || (hasExecuted && !pendingTaskIds)) return;
    const current = ++version.current, key = inputKey;
    controller.current?.abort(); const c = new AbortController(); controller.current = c;
    setBusy('review'); setError(''); setReview(null); setConfirmed(false);
    let calculated: Fact[];
    let completed: Analysis[] = [];
    let executionFailuresForReview: PlanExecution['failures'] = [];
    try {
      const request = pendingTaskIds ? { ...planned, plan: { ...planned.plan, hypotheses: [], tasks: planned.plan.tasks.filter(task => pendingTaskIds.includes(task.id)) } } : planned;
      const execution = await onExecute(request, question);
      if (current !== version.current || key !== inputRef.current) return;
      const combined = mergeExecution(pendingTaskIds ? runResults : [], execution, planned);
      calculated = evidenceFacts(planned.plan, combined);
      completed = combined;
      executionFailuresForReview = execution.failures;
      onBundle?.({id:runKey.current,response:planned,results:combined,facts:calculated,review:null,failures:execution.failures});
      setRunResults(combined); setHasExecuted(true); setPendingTaskIds(null);
      setFacts(calculated); setRunIds(combined.map(r => r.id)); setRunTaskIds(combined.map(r => r.ai?.taskId || ''));
      setExecutionFailures(execution.failures);
      setEvents(events => [...events, '本轮完成 ' + execution.results.length + ' 个本地计算任务；当前保留 ' + combined.length + ' 个成功任务的来源证据。', ...(execution.failures.length ? [execution.failures.length + ' 个任务计算失败，真实错误已单独标注。'] : [])]);
      if (!calculated.length) { setError('本轮全部任务计算失败，未生成分析结论。可让 AI 根据错误修正计划。'); setBusy(''); return; }
    } catch (e) { if (current === version.current) { setError(e instanceof Error ? e.message : '计算失败'); setBusy(''); } return; }
    await reviewResults(planned, calculated, current, key, c, completed, executionFailuresForReview);
  }
  async function reviewResults(response: PlanResponse, computed: Fact[], current: number, key: string, c: AbortController, results = runResults, failures = executionFailures) {
    try {
      const result = await aiRequest<{ review: Review }>('review', { ...providerBody, question, context: requestContext, plan: response.plan, facts: computed }, c.signal);
      if (current !== version.current || key !== inputRef.current) return;
      onBundle?.({id:runKey.current,response,results,facts:computed,review:result.review,failures});
      setReview(result.review); setEvents(events => [...events, '模型解读已返回，证据引用通过校验。陈述的语义仍需结合原始数据复核。']);
    } catch (e) { if (current === version.current) setError((e instanceof Error ? e.message : '解读失败') + ' 已完成的真实计算仍可查看。'); }
    finally { if (current === version.current) setBusy(''); }
  }
  function retryReview() {
    if (!planned || !facts.length || stale || busy) return;
    const current = ++version.current, c = new AbortController(); controller.current = c; setBusy('review'); setError('');
    void reviewResults(planned, facts, current, inputKey, c);
  }
  const p = planned?.plan;
  return <section className="ai-workbench panel" aria-labelledby="ai-heading" aria-busy={!!busy}>
    <div className="section-heading"><div><h2 id="ai-heading"><BrainCircuit size={19} />AI 分析助手</h2><p>理解数据 → 确认口径 → 真实计算 → 失败修正 → 证据解读</p></div><button className="icon-button" type="button" onClick={onConfigure} aria-label="配置分析模型"><Settings2 size={18} /></button></div>
    <form onSubmit={e => void plan(e)} className="ai-intake">
      <div className="ai-connection"><span className="service-state">{status}</span>{profiles.length > 0 ? <label>当前模型<select aria-label="分析模型" value={providerId} onChange={e => onSelect(e.target.value)} disabled={!!busy}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label> : <button className="connect-prompt" type="button" onClick={onConfigure}><Settings2 size={16} /><span>连接你的 AI 模型<small>填写 API 地址、密钥和模型 ID</small></span><ChevronRight size={17} /></button>}{selected?.source === 'browser' && !ready && <button type="button" className="text-button" onClick={onConfigure}>补填 API Key 后开始分析</button>}</div>
      <label htmlFor="analysis-goal">分析目标</label><textarea id="analysis-goal" rows={2} maxLength={3000} value={goal} onChange={e => { setGoal(e.target.value); setConfirmed(false); }} placeholder="直接说你想了解什么，例如：哪些渠道变化最大？也可以留空，先让 AI 检查数据并提出探索方向。" />
      <details className="ai-optional" open={planned?.plan.questions.length ? true : undefined}><summary>补充背景与样本设置（可选）</summary>
      <label htmlFor="business-context">业务背景与字段口径</label><textarea id="business-context" rows={3} maxLength={Math.max(0,5000-(scope?scopeContext(scope).length+2:0))} value={context} onChange={e => { setContext(e.target.value); setConfirmed(false); }} placeholder="知道的话再补充：每行代表什么、指标单位、统计范围。不确定可以留空，AI 仅在影响计算时询问。" />
      <label className="ai-check"><input type="checkbox" checked={samples} onChange={e => { setSamples(e.target.checked); setConfirmed(false); }} />附带每列最多三个原始值样本（请先检查隐私；仅示例，不代表整体）</label>
      <label className="ai-check"><input type="checkbox" checked={categories} onChange={e => { setCategories(e.target.checked); setConfirmed(false); }} />授权发送低基数文本列的类别字典，帮助 AI 精确筛选（最多十二列，每列十六个值；请先检查隐私）</label><small>类别字典与样本分别授权。超出数量或长度的整列不发送；字典无频次，不代表分布。</small></details>
      <p className="ai-hint">点击下方按钮将发送问题、可选背景、字段与质量摘要；不发送完整文件。原始值样本和类别字典分别按勾选项发送。确认计划后发送计算结果摘要用于解读。</p>
      <div className="ai-actions"><button className="primary" type="submit" disabled={!dataset || loading || !ready || !!busy}>{busy === 'plan' ? <LoaderCircle className="spin" size={17} /> : <BrainCircuit size={17} />}{busy === 'plan' ? 'AI 正在理解目标…' : '理解数据并提出分析计划'}</button>{busy && <button className="secondary" type="button" onClick={cancel}>取消请求</button>}<small>{!dataset ? '请先导入数据或主动选择公开数据。' : '完整文件保留在浏览器；不允许模型直接编造统计值。'}</small></div>
    </form>
    {scope && <div className="followup-scope" role="status"><div><strong>限定范围：{scope.label}</strong><p>来自分析 #{scope.parentAnalysisId} · {scope.parentTitle} · {scope.rowIds.length.toLocaleString()} 条匹配记录</p><p>所有任务将在该范围内真实计算，可进一步筛选。分组标签和计算摘要将随问题发送；来源行明细保留在浏览器。</p></div><button className="text-button" type="button" onClick={()=>setScope(undefined)} disabled={!!busy}>解除范围，改为全表分析</button></div>}
    <RequestProgress active={!!busy} label={busy === 'review' ? '正在计算或等待 AI 解读' : busy === 'repair' ? '正在依据真实错误修正失败任务' : '正在等待 AI 分析计划'} />
    {error && <div className="ai-error" role="alert"><p>{error}</p>{!busy && !planned && ready && dataset && <button className="secondary" type="button" onClick={() => void plan()}>重新生成分析计划</button>}</div>}
    {stale && <p className="ai-warning" role="status">目标、背景、模型或数据已变化。下方是旧计划，请重新规划后再执行。</p>}
    {p && <div className="ai-plan"><div className="ai-plan-title"><h3>{p.questions.length && p.tasks.length ? '先看可执行结果，并确认这些口径' : p.questions.length ? '先补齐这些信息' : '请确认分析方向与口径'}</h3><small>{planned.providerName} · {planned.model}</small></div><dl className="ai-understanding"><div><dt>决策问题</dt><dd>{p.goal}</dd></div><div><dt>适用场景</dt><dd>{p.scene}</dd></div><div><dt>数据粒度</dt><dd>{p.grain}</dd></div></dl>
      <details><summary>字段理解与假设（需要核对）</summary><ul>{p.fieldRoles.map(f => <li key={f.field}><strong>{f.field}</strong>：{f.meaning}（{f.role}）</li>)}{p.assumptions.map((a, i) => <li key={'a'+i}>{a}</li>)}</ul></details>
      {(p.hypotheses ?? []).length > 0 && <div className="ai-hypotheses"><h4>候选解释（待真实结果验证）</h4><ol>{(p.hypotheses ?? []).map(h => <li key={h.id}><strong>{h.statement}</strong><span>验证任务：{h.testTaskIds.map(id => p.tasks.find(task => task.id === id)?.title || id).join('、')}</span></li>)}</ol><p>候选解释不是结论。系统只比较绑定任务的真实计算结果，不能仅凭相关变化证明原因。</p></div>}
      {p.questions.length > 0 && <div className="ai-questions"><ul>{p.questions.map((q, i) => <li key={i}>{q}</li>)}</ul><p>{p.tasks.length ? '这些问题不会阻止当前安全的描述性计算；补充后重新规划可获得更精确的口径。' : '请在上方展开的“业务背景与字段口径”补充这些问题，再点分析按钮。当前没有可安全执行的任务。'}</p></div>}
      {filterWarnings.length > 0 && <div className="ai-execution-warnings ai-preflight-warnings" role="status"><strong>计算前发现筛选问题</strong><ul>{filterWarnings.map(warning => <li key={warning.taskId}><b>{warning.title}</b>：{warning.message}</li>)}</ul><p>仅在本地检查等值筛选，不额外发送原始值，也不自动改写计划。其他任务仍可计算；范围、分桶和有效数值以真实 SQL 结果为准。</p></div>}
      {p.tasks.length > 0 && <><ol className="ai-tasks">{p.tasks.map(t => <li key={t.id}><strong>{t.title}</strong><p>{t.rationale}</p><div className="ai-task-mapping"><span>分组：{t.mapping.x}{t.mapping.timeBucket && t.mapping.timeBucket !== 'none' ? '（按'+(t.mapping.timeBucket === 'month' ? '月' : '年')+'）' : ''}</span><span>指标：{t.mapping.metric} · {t.mapping.rate ? '比例（%）' : aggregateNames[t.mapping.aggregate]}</span>{t.mapping.rate && <span>分子：{t.mapping.metric} = {JSON.stringify(t.mapping.rate.successValue)}；分母：{JSON.stringify(t.mapping.rate.eligibleValues)}；未知结果排除</span>}<span>单位：{t.mapping.unit || '未确认'}</span><span>分组范围：{t.mapping.from || '不限'} → {t.mapping.to || '不限'}</span>{t.mapping.filter && <span>筛选：{t.mapping.filter} = {t.mapping.value}</span>}{t.mapping.conditions?.map((c, i) => <span key={i}>{c.field} {c.operator === 'eq' ? '=' : c.operator === 'gte' ? '≥' : '≤'} {c.value}</span>)}</div></li>)}</ol><label className="ai-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={stale || !!busy} />我已核对行粒度、指标含义、单位、筛选与汇总方式，允许按此计划计算</label><button className="primary" type="button" onClick={() => void execute()} disabled={!confirmed || stale || !!busy || loading || (hasExecuted && !pendingTaskIds)}>{pendingTaskIds ? '确认修正并重算失败任务' : '确认计划并计算'}<ChevronRight size={16} /></button></>}
      {p.limitations.length > 0 && <div className="ai-limits"><strong>本次分析的边界</strong><ul>{p.limitations.map((v, i) => <li key={i}>{v}</li>)}</ul></div>}
    </div>}
    {repairChanges.length > 0 && <details className="ai-repair-changes" open><summary>修正口径对照 · 第 {repairRounds} 轮</summary>{repairChanges.map((change, i) => <article key={i}><strong>{change.title}</strong><p>修正前</p><p className="ai-repair-mapping">{describeMapping(change.before)}</p><p>待确认口径</p><p className="ai-repair-mapping">{describeMapping(change.after)}</p></article>)}<p>{pendingTaskIds ? '尚未执行修正计划。核对上方计划并勾选确认后，仅重算失败任务。' : '修正计划已经执行；本轮结果与保留结果分别绑定各自的真实计算证据。'}</p></details>}
    {executionFailures.length > 0 && <div className="ai-execution-warnings ai-failure-recovery" role="status"><strong>计算失败的任务</strong><ul>{executionFailures.map(f => <li key={f.taskId}><b>{f.title}</b>：{f.error}</li>)}</ul><p>成功结果保留。AI 可依据真实错误提出修正，核对新口径后重算；每次分析最多请求两轮修正。</p><button className="secondary" type="button" onClick={() => void repair()} disabled={stale || !!busy || loading || !!pendingTaskIds || repairRounds >= 2}>{busy === 'repair' ? '正在修正…' : pendingTaskIds ? '请先确认上方修正计划' : repairRounds >= 2 ? '已达到两轮修正上限，请补充口径后重新规划' : '让 AI 修正失败任务'}</button></div>}
    {runIds.length > 0 && <div className="ai-results"><h3>真实计算结果</h3><div className="ai-result-links">{runIds.map((id, i) => <button className="secondary" key={id} onClick={() => onEvidence(id)}>{p?.tasks.find(task => task.id === runTaskIds[i])?.title ?? '计算结果'}<ChevronRight size={14} /></button>)}</div><p>图表在分析画布中显示，点击引用可定位原始记录。计算不等待模型解读成功。</p>{!review && !busy && <button className="text-button" onClick={retryReview} disabled={stale}>重试 AI 解读（不重复计算）</button>}</div>}
    {review && <div className="ai-review"><h3>AI 辅助解读</h3><p className="ai-hint">{review.answerability === 'insufficient' ? '现有证据不足以回答原问题。' : review.answerability === 'partial' ? '现有数据只能回答问题的一部分。' : '本轮结果属于描述性分析。'} 引用有效不等于语义与因果已被证明。</p>{review.findings.map((f, i) => <article key={i}><span className="tag">{f.interpretation === 'hypothesis' ? '待验证假设' : '基于结果的观察'}</span><p>{f.statement}</p><div>{f.evidenceIds.map(id => { const fact = facts.find(v => v.id === id); return fact && <button className="ai-evidence" key={id} onClick={() => onEvidence(fact.analysisId, fact.label)}>{fact.text.split('；口径=')[0]} · {fact.label}<ChevronRight size={13} /></button>; })}</div></article>)}<details><summary>查看传给模型的计算事实</summary><ul>{facts.map(f => <li className="ai-fact" key={f.id}>{f.id}：{f.text}</li>)}</ul></details><div className="ai-limits"><strong>仍需注意</strong><ul>{review.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul></div>{review.nextQuestions.length > 0 && <div className="ai-next"><strong>继续核查</strong>{review.nextQuestions.map((q, i) => <button key={i} onClick={() => { setGoal(q); setConfirmed(false); document.getElementById('analysis-goal')?.focus(); }} disabled={!!busy}>{q}<ChevronRight size={14} /></button>)}</div>}</div>}
    {events.length > 0 && <details className="ai-events" open><summary>执行记录{busy ? ' · 请求进行中' : ''}</summary><ol>{events.map((event, i) => <li key={i}>{event}</li>)}</ol></details>}
  </section>;
}
