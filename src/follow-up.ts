import type { Analysis, AnalysisScope, Dataset, Mapping } from './data'
export type AssistantSeed = { question: string; context?: string; nonce: number; scope?: AnalysisScope }
export function validateScope(dataset: Dataset, scope: AnalysisScope): void {
 if (scope.datasetHash !== dataset.fingerprint || scope.loadedAt !== dataset.loadedAt) throw new Error('追问范围属于旧数据，请从当前结果重新选择。')
 if (!Number.isInteger(scope.parentAnalysisId) || scope.parentAnalysisId < 1 || !scope.label || !Array.isArray(scope.rowIds) || !scope.rowIds.length || scope.rowIds.length > dataset.rows.length || new Set(scope.rowIds).size !== scope.rowIds.length || scope.rowIds.some(id => !Number.isInteger(id) || id < 2 || id > dataset.rows.length + 1)) throw new Error('追问来源记录无效，已停止计算。')
}
export function createFollowUpScope(dataset: Dataset, result: Analysis, label: string): AnalysisScope {
 if (result.datasetHash !== dataset.fingerprint) throw new Error('原结果与当前数据快照不一致，请重新计算。')
 const point = result.points.find(p => p.label === label)
 if (!point || !point.scopeRowIds?.length) throw new Error('该结果缺少完整分组来源，请重新计算后选择。')
 const scope: AnalysisScope = { datasetHash: dataset.fingerprint, loadedAt: dataset.loadedAt, parentAnalysisId: result.id, parentTitle: result.ai?.taskTitle || result.question, label, rowIds: [...point.scopeRowIds], baseline: { metric: result.mapping.metric, aggregate: result.mapping.aggregate, unit: result.mapping.unit, value: point.value, rate: result.mapping.rate ? structuredClone(result.mapping.rate) : undefined, counts: point.rate ? { ...point.rate } : undefined } }
 validateScope(dataset, scope)
 return scope
}
export function scopeContext(scope: AnalysisScope): string {
 return '本次是从已完成计算发起的分组追问。计算引擎强制限制到原分组的全部匹配行（包括原指标无效或缺失的行），不能扩展到全表；可以进一步筛选。范围标签、范围记录数和已计算结果由用户主动选择后发送，不发送来源行明细。\n' + JSON.stringify({ sourceAnalysis: scope.parentAnalysisId, sourceTask: scope.parentTitle, selectedGroup: scope.label, scopeRows: scope.rowIds.length, baseline: scope.baseline }) + '\n继承原比例指标时必须保持分子和分母取值口径；如需全表或与范围外对比，应说明当前范围限制，由用户另建分析。分组差异不代表因果。'
}

export function validateScopedMapping(mapping: Mapping, scope?: AnalysisScope): void {
 if (!scope?.baseline.rate || mapping.metric !== scope.baseline.metric || !mapping.rate) return
 const previous = scope.baseline.rate
 if (mapping.rate.successValue !== previous.successValue || JSON.stringify([...mapping.rate.eligibleValues].sort()) !== JSON.stringify([...previous.eligibleValues].sort())) throw new Error('追问修改了原比例的分子或分母口径，已停止该任务。请保留原口径，或解除范围后明确创建新分析。')
}

export function rateBaseline(result: Analysis): number | undefined {
 const baseline=result.scope?.baseline
 if (!baseline?.rate || !result.mapping.rate || baseline.metric!==result.mapping.metric || baseline.aggregate!==result.mapping.aggregate || baseline.unit!==result.mapping.unit) return undefined
 const current=result.mapping.rate
 return baseline.rate.successValue===current.successValue && JSON.stringify([...baseline.rate.eligibleValues].sort())===JSON.stringify([...current.eligibleValues].sort()) ? baseline.value : undefined
}
