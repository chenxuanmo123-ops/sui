import { analyze, profileDataset, formatNumber } from './data';
import type { Dataset, Mapping, Analysis, AnalysisScope } from './data';
import { validateScope } from './follow-up';
export type Provider = { id: string; name: string; model: string };
export type Task = { id: string; title: string; rationale: string; chart: 'line' | 'bar'; mapping: Mapping };
export type Hypothesis = { id: string; statement: string; testTaskIds: string[] };
export type Plan = { goal: string; scene: string; grain: string; fieldRoles: { field: string; meaning: string; role: string }[]; assumptions: string[]; questions: string[]; hypotheses?: Hypothesis[]; tasks: Task[]; limitations: string[] };
export type PlanExecution = { results: Analysis[]; failures: { taskId: string; title: string; error: string }[] };
export type PlanResponse = { scope?: AnalysisScope; plan: Plan; datasetHash: string; model: string; providerName: string; generatedAt: string };
export type Fact = { id: string; text: string; taskId: string; analysisId: number; label?: string };
export type Review = { answerability: 'partial' | 'descriptive_only' | 'insufficient'; findings: { statement: string; evidenceIds: string[]; interpretation: 'observation' | 'hypothesis' }[]; limitations: string[]; nextQuestions: string[] };
export const CATEGORY_LIMITS = { columns: 12, values: 16, valueLength: 120, totalChars: 8000 } as const;
export function datasetContext(dataset: Dataset, samples: boolean, categories = false) {
  let dictionaryColumns = 0, dictionaryChars = 0;
  return { name: dataset.title, hash: dataset.fingerprint, rowCount: dataset.rows.length, provenance: dataset.isPublic ? dataset.sourceUrl : '用户上传文件，代表性待用户确认', samplePolicy: samples ? '每列最先遇到的非空唯一值，最多三个，不代表整体分布' : '不发送原始单元格样本', categoryPolicy: categories ? '仅发送有界低基数文本列的完整取值集合，无频次；不代表业务定义或总体分布' : '不发送类别取值字典', columns: profileDataset(dataset).map(p => {
    const values: string[] = [];
    if (samples) for (const row of dataset.rows) { const raw = row[p.key]; if (raw !== null && !values.includes(raw.slice(0, 120))) values.push(raw.slice(0, 120)); if (values.length === 3) break; }
    let categoryValues: string[] | undefined;
    if (categories && p.kind === '文本' && dictionaryColumns < CATEGORY_LIMITS.columns) {
      const unique = new Set<string>();
      let eligible = true;
      for (const row of dataset.rows) {
        const value = row[p.key];
        if (value === null || !value.trim()) continue;
        if (value.length > CATEGORY_LIMITS.valueLength) { eligible = false; break; }
        unique.add(value);
        if (unique.size > CATEGORY_LIMITS.values) { eligible = false; break; }
      }
      const chars = [...unique].reduce((n, value) => n + value.length, 0);
      if (eligible && unique.size && dictionaryChars + chars <= CATEGORY_LIMITS.totalChars) {
        categoryValues = [...unique]; dictionaryColumns++; dictionaryChars += chars;
      }
    }
    return { field: p.key, typeCandidate: p.kind, missing: p.missing, nonempty: p.nonempty, numeric: p.numeric, ...(samples ? { examples: values } : {}), ...(categoryValues ? { categoryValues, categoryValuesComplete: true } : {}) };
  }) };
}
export async function aiRequest<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/ai/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(195000)]) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'AI 服务请求失败（HTTP ' + response.status + '）');
    return result as T;
  } catch (error) {
    if (signal.aborted) throw new Error('请求已取消。');
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('模型等待超时，请重试或切换更快的模型。');
    if (error instanceof SyntaxError) throw new Error('分析服务没有返回有效响应。请使用 npm run dev 启动完整服务，而不是静态预览。');
    if (error instanceof TypeError) throw new Error('分析服务连接中断，请检查本地服务是否仍在运行。');
    throw error;
  }
}
export async function executePlan(dataset: Dataset, response: PlanResponse, question: string, startId: number): Promise<PlanExecution> {
  if (response.datasetHash !== dataset.fingerprint) throw new Error('数据已变化，请基于新数据重新规划。');
  if (response.scope) validateScope(dataset, response.scope);
  const p = response.plan;
  if (!p.tasks.length || p.tasks.length > 6) throw new Error('当前计划没有可安全执行的任务，请补充口径后重新规划。');
  const ids = new Set<string>();
  for (const task of p.tasks) {
    if (!task.id?.trim() || ids.has(task.id)) throw new Error('任务标识缺失或重复');
    ids.add(task.id);
  }
  const results: Analysis[] = [];
  const failures: PlanExecution['failures'] = [];
  for (const [i, task] of p.tasks.entries()) {
    try {
      const result = await analyze(dataset, task.mapping, question, startId + i, response.scope);
      results.push({ ...result, ai: { goal: p.goal, taskId: task.id, taskTitle: task.title, model: response.model, plannedAt: response.generatedAt } });
    } catch (error) {
      failures.push({ taskId: task.id, title: task.title, error: error instanceof Error ? error.message : '任务执行失败' });
    }
  }
  return { results, failures };
}
export type PlanWarning = { taskId: string; title: string; message: string };
export function inspectPlanFilters(dataset: Dataset, plan: Plan): PlanWarning[] {
  return plan.tasks.flatMap(task => {
    const conditions = [
      ...(task.mapping.filter ? [{ field: task.mapping.filter, value: task.mapping.value }] : []),
      ...(task.mapping.conditions ?? []).filter(condition => condition.operator === 'eq'),
    ].filter(condition => dataset.headers.includes(condition.field));
    if (!conditions.length) return [];
    const absent = conditions.filter(condition => !dataset.rows.some(row => row[condition.field] === condition.value));
    if (absent.length) return [{ taskId: task.id, title: task.title, message: absent.map(condition => condition.field + ' = ' + JSON.stringify(condition.value)).join('、') + '：当前数据没有精确匹配记录。请核对原始值后重新规划。' }];
    if (!dataset.rows.some(row => conditions.every(condition => row[condition.field] === condition.value))) {
      return [{ taskId: task.id, title: task.title, message: '这些等值筛选组合当前没有匹配记录，请核对筛选口径后重新规划。' }];
    }
    return [];
  });
}
export function evidenceFacts(plan: Plan, results: Analysis[]): Fact[] {
  const taskIds = new Set(plan.tasks.map(task => task.id));
  if (taskIds.size !== plan.tasks.length) throw new Error('计划存在重复任务标识，无法绑定证据。');
  const seen = new Set<string>();
  return results.flatMap(r => {
    const task = plan.tasks.find(candidate => candidate.id === r.ai?.taskId);
    if (!task || seen.has(task.id)) throw new Error('计算结果缺少唯一的计划任务绑定，已拒绝生成证据。');
    seen.add(task.id);
    const points = r.points;
    if (!points.length) throw new Error('计算结果为空，无法生成证据。');
    const extrema = [...points].sort((a, b) => a.value - b.value);
    const selected = [...new Map([points[0], points.at(-1)!, extrema[0], extrema.at(-1)!].map(p => [p.label, p])).values()];
    return selected.map((p, j) => ({ id: task.id + ':fact' + j, taskId: task.id, analysisId: r.id, label: p.label, text: task.title + '；口径=' + JSON.stringify(r.mapping) + '；分组=' + p.label + '；结果=' + formatNumber(p.value, 8) + (r.mapping.unit ? ' ' + r.mapping.unit : '（单位未确认）') + (p.rate ? '；分子=' + p.rate.numerator + '；分母=' + p.rate.denominator + '；排除未知或缺失结果=' + p.rate.excluded : '') + '；来源记录数=' + p.rowIds.length + (r.scope ? '；追问范围=' + JSON.stringify(r.scope.label) + '；锁定来源分析=' + r.scope.parentAnalysisId + '；锁定匹配行数=' + r.scope.rowIds.length : '') + '；数据快照=' + r.datasetHash }));
  });
}

export function mergeRepairPlan(previous: PlanResponse, repaired: PlanResponse, failures: PlanExecution['failures']): PlanResponse {
  if (previous.datasetHash !== repaired.datasetHash) throw new Error('修正计划的数据快照不符。');
  const failed = new Set(failures.map(failure => failure.taskId));
  const previousIds = new Set(previous.plan.tasks.map(task => task.id));
  const tasks = new Map(repaired.plan.tasks.map(task => [task.id, task]));
  if (!failed.size || failed.size !== failures.length || [...failed].some(id => !previousIds.has(id)) || tasks.size !== failed.size || tasks.size !== repaired.plan.tasks.length || [...tasks.keys()].some(id => !failed.has(id))) throw new Error('修正计划必须逐一对应失败任务，不能替换成功任务或新增任务。');
  return { ...repaired, scope: previous.scope, plan: { ...previous.plan, questions: repaired.plan.questions, assumptions: [...new Set([...previous.plan.assumptions, ...repaired.plan.assumptions])], limitations: [...new Set([...previous.plan.limitations, ...repaired.plan.limitations])], tasks: previous.plan.tasks.map(task => tasks.get(task.id) ?? task) } };
}
export function mergeExecution(previous: Analysis[], current: PlanExecution, plan: PlanResponse): Analysis[] {
  const allowed = new Map(plan.plan.tasks.map(task => [task.id, task]));
  const combined = [...previous, ...current.results];
  const seen = new Set<string>();
  for (const result of combined) {
    const id = result.ai?.taskId;
    if (!id || !allowed.has(id) || seen.has(id) || result.datasetHash !== plan.datasetHash || JSON.stringify(result.scope) !== JSON.stringify(plan.scope) || JSON.stringify(result.mapping) !== JSON.stringify(allowed.get(id)!.mapping)) throw new Error('修正结果与计划、数据快照或已有任务绑定不符。');
    seen.add(id);
  }
  return combined;
}
