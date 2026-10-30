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
 fail(id = this.requests.at(-1)!.id, error = '引擎错误') { this.dispatchEvent(new MessageEvent('message', { data: { id, error } })) }
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
  // The first 30 s only proves the worker never came up, so it is replaced
  // once; the replacement gets its own timeout before the request fails.
  await vi.advanceTimersByTimeAsync(30000); await flush()
  expect(TestWorker.instances).toHaveLength(2)
  expect(TestWorker.instances[0].terminated).toBe(true)
  const rejection = expect(current).rejects.toThrow('计算引擎加载超过 30 秒')
  await vi.advanceTimersByTimeAsync(30000); await rejection
  expect(TestWorker.instances).toHaveLength(2)
  const next = aggregateDataset(dataset, mapping, '', 2); await flush()
  expect(TestWorker.instances).toHaveLength(3); TestWorker.instances[2].complete(); await next
 })
 it('首次失败视为引擎加载问题，换新线程重试一次后正常返回', async () => {
  const { aggregateDataset } = await import('../src/engine')
  const current = aggregateDataset(dataset, mapping, '', 1); await flush()
  const first = TestWorker.instances[0], id = first.requests[0].id
  first.fail(id, 'WebAssembly compile is disallowed')
  await flush()
  expect(first.terminated).toBe(true)
  expect(TestWorker.instances).toHaveLength(2)
  TestWorker.instances[1].complete(id)
  await expect(current).resolves.toEqual({ protocolAcknowledged: true })
 })
 it('重试后仍失败才把错误交给用户，不再继续换线程', async () => {
  const { aggregateDataset } = await import('../src/engine')
  const current = aggregateDataset(dataset, mapping, '', 1); await flush()
  const id = TestWorker.instances[0].requests[0].id
  TestWorker.instances[0].fail(id, '首次失败')
  await flush()
  TestWorker.instances[1].fail(id, '仍然失败')
  await expect(current).rejects.toThrow('仍然失败')
  expect(TestWorker.instances).toHaveLength(2)
 })
 it('已成功计算过的线程报错时直接返回错误，不重复执行', async () => {
  const { aggregateDataset } = await import('../src/engine')
  const first = aggregateDataset(dataset, mapping, '', 1); await flush()
  TestWorker.instances[0].complete(); await first
  const second = aggregateDataset(dataset, mapping, '', 2); await flush()
  TestWorker.instances[0].fail(TestWorker.instances[0].requests[1].id, '真实口径错误')
  await expect(second).rejects.toThrow('真实口径错误')
  expect(TestWorker.instances).toHaveLength(1)
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
