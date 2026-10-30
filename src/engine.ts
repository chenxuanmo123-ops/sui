import type { Analysis, AnalysisScope, Dataset, Mapping } from './data'
import type { ExploreResult, ExploreSpec, ComparisonSpec, ComparisonResult } from './analytics'
import type { ConsoleResult, ExtraTable } from './sql-console'

let worker: Worker | undefined, sequence = 0
let queue: Promise<unknown> = Promise.resolve()
// A worker is trusted only after it returns a result. Until then a silent stall
// or an error usually means the SQLite runtime asset is still downloading, or
// arrived truncated; that is retried once on a fresh worker instead of being
// reported as a slow query.
const readyWorkers = new WeakSet<Worker>()

function request<T>(payload: object, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let current: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined
    let release: (() => void) | undefined, settled = false, attempt = 0
    const id = ++sequence
    const finish = (error?: Error, result?: T, terminate = false) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      current?.removeEventListener('message', message)
      current?.removeEventListener('error', failed)
      if (terminate && current) {
        current.terminate()
        if (worker === current) worker = undefined
      }
      release?.()
      if (error) reject(error)
      else resolve(result as T)
    }
    const abort = () => finish(new DOMException('计算已停止。', 'AbortError'), undefined, true)
    const restart = () => {
      clearTimeout(timer)
      current?.removeEventListener('message', message)
      current?.removeEventListener('error', failed)
      const dead = current
      current = undefined
      if (dead) { dead.terminate(); if (worker === dead) worker = undefined }
      attempt++
      launch()
    }
    const message = (event: MessageEvent) => {
      if (event.data.id !== id) return
      if (event.data.error) {
        if (attempt === 0 && current && !readyWorkers.has(current)) restart()
        else finish(new Error(event.data.error))
        return
      }
      if (current) readyWorkers.add(current)
      finish(undefined, event.data.result as T)
    }
    const failed = () => {
      if (attempt === 0 && current && !readyWorkers.has(current)) restart()
      else finish(new Error('SQL 引擎启动失败，请重试。'), undefined, true)
    }
    const launch = () => {
      if (settled) return
      try {
        worker ??= new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
        current = worker
        current.addEventListener('message', message)
        current.addEventListener('error', failed)
        timer = setTimeout(() => {
          if (attempt === 0 && current && !readyWorkers.has(current)) { restart(); return }
          finish(new Error(current && readyWorkers.has(current)
            ? 'SQL 查询超过 30 秒，已终止独立计算线程；请缩小数据范围。'
            : '计算引擎加载超过 30 秒，可能是 SQLite 运行时下载不完整。请重试或刷新页面。'), undefined, true)
        }, 30000)
        current.postMessage({ ...payload, id })
      } catch (error) {
        finish(error instanceof Error ? error : new Error('SQL 引擎请求失败。'), undefined, true)
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }

    // Cancelling a queued request must not terminate the preceding request's worker.
    const work = queue.catch(() => {}).then(() => {
      if (settled) return
      return new Promise<void>(done => {
        release = done
        launch()
      })
    })
    queue = work
  })
}

export const aggregateDataset = (dataset: Dataset, mapping: Mapping, question: string, analysisId: number, scope?: AnalysisScope, signal?: AbortSignal) => request<Analysis>({ type: 'aggregate', dataset, mapping, question, analysisId, scope }, signal)
export const exploreDataset = (dataset: Dataset, spec: ExploreSpec, signal?: AbortSignal) => request<ExploreResult>({ type: 'explore', dataset, spec }, signal)
export const compareDataset = (dataset: Dataset, spec: ComparisonSpec, signal?: AbortSignal) => request<ComparisonResult>({ type: 'compare', dataset, spec }, signal)
export const queryDataset = (dataset: Dataset, sql: string, signal?: AbortSignal) => request<ConsoleResult>({ type: 'query', dataset, sql }, signal)
export const loadConsoleTable = (dataset: Dataset, table: ExtraTable, signal?: AbortSignal) => request<{ name: string; columns: number; rows: number; names: string[] }>({ type: 'table', dataset, table }, signal)
export const clearConsoleTable = (dataset: Dataset, signal?: AbortSignal) => request<{ name: string; columns: number; rows: number; names: string[] }>({ type: 'table', dataset, table: null }, signal)
