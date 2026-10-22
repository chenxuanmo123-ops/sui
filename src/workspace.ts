import type { Dataset, Analysis, Mapping } from './data'
import type { AnalysisBundle } from './AnalysisResults'
import type { ExploreSession } from './ExploreView'
import type { CompareSession } from './CompareView'
import { validateScope } from './follow-up'

export type WorkspaceView = 'workspace' | 'prepare' | 'explore' | 'compare' | 'branches' | 'source'
export type WorkspaceState = {
 dataset: Dataset; preparationHistory: Dataset[]; history: Analysis[]; bundles: AnalysisBundle[];
 currentBundleKey: string | null; activeId: number | null; mapping: Mapping; question: string;
 chartKind: 'line' | 'bar'; view: WorkspaceView; dataTab: 'fields' | 'raw' | 'result'; inspectorOpen: boolean;
 exploreSession: ExploreSession | null; compareSession: CompareSession | null;
}
export type WorkspaceSnapshot = { version: 1; savedAt: string; state: WorkspaceState }
export const WORKSPACE_DB = 'shujian-workspace'
export const bundleKey = (bundle: AnalysisBundle) => bundle.id || bundle.response.generatedAt

// This store contains the current local workspace only; model credentials never enter it.
let connection: Promise<IDBDatabase> | undefined
let operations: Promise<unknown> = Promise.resolve()
function database(): Promise<IDBDatabase> {
 if (connection) return connection
 connection = new Promise<IDBDatabase>((resolve, reject) => {
  if (!globalThis.indexedDB) { reject(new Error('浏览器未提供本机存储，请导出报告保存成果。')); return }
  const request = indexedDB.open(WORKSPACE_DB, 1)
  let expired = false
  const fail = (message: string) => { expired = true; clearTimeout(timer); reject(new Error(message)) }
  const timer = setTimeout(() => fail('打开本机工作区超时，请关闭其他同站点页面后重试。'), 8000)
  request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('workspace')) request.result.createObjectStore('workspace') }
  request.onerror = () => fail('无法打开本机工作区，请检查浏览器的站点存储设置。')
  request.onblocked = () => fail('本机工作区被其他页面占用，请关闭其他同站点页面后重试。')
  request.onsuccess = () => {
   clearTimeout(timer)
   if (expired) { request.result.close(); return }
   const db = request.result
   db.onversionchange = () => { db.close(); connection = undefined }
   resolve(db)
  }
 }).catch(error => { connection = undefined; throw error })
 return connection
}
function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
 const work = operations.catch(() => undefined).then(async () => {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
   const tx = db.transaction('workspace', mode)
   let result: T
   let request: IDBRequest<T>
   try { request = action(tx.objectStore('workspace')) }
   catch(error) { tx.abort(); reject(new Error(error instanceof DOMException && error.name === 'QuotaExceededError' ? '浏览器存储空间不足，尚未保存本轮修改；请先导出报告或释放站点空间。' : '本机工作区操作失败，请先导出报告保存成果。')); return }
   const timer = setTimeout(() => { try { tx.abort() } catch { /* already closed */ } reject(new Error('本机保存超时，请先导出报告。')) }, 10000)
   request.onsuccess = () => { result = request.result }
   tx.oncomplete = () => { clearTimeout(timer); resolve(result) }
   tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(new Error(tx.error?.name === 'QuotaExceededError' || request.error?.name === 'QuotaExceededError' ? '浏览器存储空间不足，尚未保存本轮修改；请先导出报告或释放站点空间。' : '本机工作区操作失败，尚未保存本轮修改；请先导出报告。')) }
  })
 })
 operations = work
 return work
}
function invalid(): never { throw new Error('保存的工作区版本或数据关联无效，已停止恢复且保留旧记录。可清除本机工作区后重新导入。') }
function validDataset(value: unknown): value is Dataset {
 if (!value || typeof value !== 'object') return false
 const d = value as Dataset
 return typeof d.title === 'string' && typeof d.fingerprint === 'string' && /^[a-f0-9]{64}$/i.test(d.fingerprint) && typeof d.loadedAt === 'string' && Number.isFinite(Date.parse(d.loadedAt)) && typeof d.isPublic === 'boolean' && Array.isArray(d.headers) && d.headers.length > 0 && d.headers.length <= 200 && d.headers.every(h => typeof h === 'string' && h.length > 0) && new Set(d.headers).size === d.headers.length && Array.isArray(d.rows) && d.rows.length > 0 && d.rows.length <= 100000 && d.rows.every(row => row && typeof row === 'object' && d.headers.every(h => row[h] === null || typeof row[h] === 'string'))
}
export function decodeWorkspace(value: unknown): WorkspaceSnapshot {
 try {
  if (!value || typeof value !== 'object') return invalid()
  const snapshot = value as WorkspaceSnapshot, s = snapshot.state
  if (snapshot.version !== 1 || typeof snapshot.savedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.savedAt)) || !s || !validDataset(s.dataset) || !Array.isArray(s.preparationHistory) || !s.preparationHistory.every(validDataset) || !Array.isArray(s.history) || !Array.isArray(s.bundles)) return invalid()
  const ids = new Set<number>()
  for (const result of s.history) {
   if (!result || !Number.isInteger(result.id) || result.id < 1 || ids.has(result.id) || result.datasetHash !== s.dataset.fingerprint || !result.mapping || !Array.isArray(result.points) || result.points.some(p => !p || typeof p.label !== 'string' || !Number.isFinite(p.value) || !Array.isArray(p.rowIds) || p.rowIds.some(id => !Number.isInteger(id) || id < 2 || id > s.dataset.rows.length + 1))) return invalid()
   ids.add(result.id)
   if (result.scope) validateScope(s.dataset, result.scope)
  }
  const byId = new Map(s.history.map(result => [result.id, result]))
  const keys = new Set<string>()
  for (const bundle of s.bundles) {
   if (!bundle?.response || bundle.response.datasetHash !== s.dataset.fingerprint || !bundle.response.plan || !Array.isArray(bundle.response.plan.tasks) || !Array.isArray(bundle.results) || !Array.isArray(bundle.facts) || !Array.isArray(bundle.failures) || !bundleKey(bundle) || keys.has(bundleKey(bundle))) return invalid()
   keys.add(bundleKey(bundle))
   if (bundle.response.scope) validateScope(s.dataset, bundle.response.scope)
   for (const result of bundle.results) {
    const original = byId.get(result.id)
    if (!original || original.datasetHash !== result.datasetHash || JSON.stringify(original.scope) !== JSON.stringify(bundle.response.scope)) return invalid()
   }
   bundle.results = bundle.results.map(result => byId.get(result.id)!)
  }
  if (s.activeId !== null && !ids.has(s.activeId) || s.currentBundleKey !== null && !keys.has(s.currentBundleKey) || !s.mapping || typeof s.mapping.x !== 'string' || typeof s.question !== 'string' || !['line','bar'].includes(s.chartKind) || !['workspace','prepare','explore','compare','branches','source'].includes(s.view) || !['fields','raw','result'].includes(s.dataTab) || typeof s.inspectorOpen !== 'boolean') return invalid()
  for (const session of [s.exploreSession,s.compareSession]) if (session && (session.datasetHash !== s.dataset.fingerprint || !session.spec || session.result && session.result.datasetHash !== s.dataset.fingerprint)) return invalid()
  return snapshot
 } catch { return invalid() }
}
export async function readWorkspace(): Promise<WorkspaceSnapshot | null> {
 const value = await transaction('readonly', store => store.get('current'))
 return value === undefined ? null : decodeWorkspace(value)
}
export async function saveWorkspace(state: WorkspaceState): Promise<string> {
 const savedAt = new Date().toISOString()
 await transaction('readwrite', store => store.put({ version: 1, savedAt, state } satisfies WorkspaceSnapshot, 'current'))
 return savedAt
}
export async function clearWorkspace(): Promise<void> {
 await transaction('readwrite', store => store.delete('current'))
}
