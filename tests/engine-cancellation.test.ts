import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dataset, Mapping } from '../src/data'

// Worker protocol doubles only; these values are request metadata, never analytical results.
class TestWorker extends EventTarget {
 static instances: TestWorker[] = []
 requests: { id: number }[] = []
 terminated = false
 constructor() { super(); TestWorker.instances.push(this) }
 postMessage(request: { id: number }) { this.requests.push(request) }
 terminate() { this.terminated = true }
 complete(id = this.requests.at(-1)!.id) { this.dispatchEvent(new MessageEvent('message', { data: { id, result: { protocolAcknowledged: true } } })) }
}
const dataset = {} as Dataset, mapping = {} as Mapping
beforeEach(() => { vi.resetModules(); TestWorker.instances = []; vi.stubGlobal('Worker', TestWorker) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
describe('SQL Worker 取消与队列恢复', () => {
 it('排队请求取消不终止正在计算的前一任务', async () => {
  const { aggregateDataset } = await import('../src/engine')
  const first = aggregateDataset(dataset, mapping, '', 1); await flush()
  const controller = new AbortController()
  const queued = aggregateDataset(dataset, mapping, '', 2, undefined, controller.signal)
  const rejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejection
  expect(TestWorker.instances[0].terminated).toBe(false)
  TestWorker.instances[0].complete(); await first; await flush()
  expect(TestWorker.instances[0].requests).toHaveLength(1)
 })
 it('取消当前任务终止 Worker，后续排队任务使用新 Worker', async () => {
  const { aggregateDataset } = await import('../src/engine'), controller = new AbortController()
  const current = aggregateDataset(dataset, mapping, '', 1, undefined, controller.signal); await flush()
  const next = aggregateDataset(dataset, mapping, '', 2)
  const rejection = expect(current).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejection; await flush()
  expect(TestWorker.instances[0].terminated).toBe(true); expect(TestWorker.instances).toHaveLength(2)
  TestWorker.instances[0].complete(); TestWorker.instances[1].complete(); await next
 })
 it('忽略错误请求 ID，超时释放队列而不是永久阻塞', async () => {
  vi.useFakeTimers()
  const { aggregateDataset } = await import('../src/engine')
  const current = aggregateDataset(dataset, mapping, '', 1); await flush()
  TestWorker.instances[0].complete(-1)
  const rejection = expect(current).rejects.toThrow('超过 30 秒')
  await vi.advanceTimersByTimeAsync(30000); await rejection
  const next = aggregateDataset(dataset, mapping, '', 2); await flush()
  expect(TestWorker.instances).toHaveLength(2); TestWorker.instances[1].complete(); await next
 })
 it('消息发送异常也能释放队列并重建计算线程', async () => {
  const { aggregateDataset } = await import('../src/engine')
  vi.spyOn(TestWorker.prototype, 'postMessage').mockImplementationOnce(() => { throw new Error('DataCloneError test') })
  await expect(aggregateDataset(dataset, mapping, '', 1)).rejects.toThrow('DataCloneError')
  const next = aggregateDataset(dataset, mapping, '', 2); await flush()
  expect(TestWorker.instances).toHaveLength(2); TestWorker.instances[1].complete(); await next
  vi.restoreAllMocks()
 })
})
