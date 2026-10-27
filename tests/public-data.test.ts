import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { downloadPublicDataset } from '../src/publicData'
import { PUBLIC_DATA_BYTES, PUBLIC_DATA_COMMIT, PUBLIC_DATA_MIRRORS, PUBLIC_DATA_SHA256 } from '../src/data'

// A small stand-in body: the tests below exercise the transfer rules, not the
// real CSV. The pinned constants are checked separately.
const payload = new TextEncoder().encode('country,year,renewables_electricity\n' + 'China,2022,2670.66\n'.repeat(512))
const digest = createHash('sha256').update(payload).digest('hex')
const mirrors = [{ label: '甲镜像', url: 'https://a.test/owid.csv' }, { label: '乙镜像', url: 'https://b.test/owid.csv' }]
const base = { bytes: payload.length, sha256: digest, mirrors, stallMs: 3000, candidateMs: 8000 }

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

describe('内置公开数据的下载', () => {
  it('固定提交的 URL、大小与 SHA-256 都是常量，镜像指向同一提交', () => {
    expect(PUBLIC_DATA_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(PUBLIC_DATA_BYTES).toBeGreaterThan(9_000_000)
    for (const mirror of PUBLIC_DATA_MIRRORS) expect(mirror.url).toContain(PUBLIC_DATA_COMMIT)
  })

  it('按顺序取第一个能完成的镜像，并原样返回字节', async () => {
    globalThis.fetch = (async () => new Response(payload)) as typeof fetch
    const result = await downloadPublicDataset({ ...base, signal: new AbortController().signal })
    expect(new TextDecoder().decode(result.bytes)).toContain('China,2022,2670.66')
    expect(result.source).toBe('甲镜像')
    expect(result.digest).toBe(digest)
  })

  it('镜像中途断开后，换下一个镜像从断点续传，不重复也不丢失字节', async () => {
    const calls: { url: string; range: string | null }[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const range = new Headers(init?.headers).get('range')
      calls.push({ url, range })
      if (url.includes('a.test')) {
        let sent = false
        const cut = new ReadableStream<Uint8Array>({
          // Deliver one chunk, then drop the connection on the next read.
          pull(controller) {
            if (!sent) { sent = true; controller.enqueue(payload.slice(0, 4096)); return }
            controller.error(new Error('连接被重置'))
          },
        })
        return new Response(cut)
      }
      expect(range).toBe('bytes=4096-')
      return new Response(payload.slice(4096), { status: 206 })
    }) as typeof fetch
    const result = await downloadPublicDataset({ ...base, signal: new AbortController().signal })
    expect(result.bytes.length).toBe(payload.length)
    expect(createHash('sha256').update(result.bytes).digest('hex')).toBe(digest)
    expect(result.source).toBe('乙镜像')
    expect(calls.filter(call => call.url.includes('a.test')).length).toBe(2)
  })

  it('大小相同但内容不同时拒绝载入，不把它当成同一份证据', async () => {
    const tampered = payload.slice()
    tampered[0] = 0
    globalThis.fetch = (async () => new Response(tampered)) as typeof fetch
    await expect(downloadPublicDataset({ ...base, signal: new AbortController().signal })).rejects.toThrow(/SHA-256/)
  })

  it('用户取消时立刻停止，不当作镜像失败继续重试', async () => {
    let requests = 0
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      requests++
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }) as typeof fetch
    const controller = new AbortController()
    const run = downloadPublicDataset({ ...base, signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests).toBe(1)
  })

  it('全部镜像都不可用时报告已收到的进度，而不是一句笼统的网络异常', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    await expect(downloadPublicDataset({ ...base, signal: new AbortController().signal })).rejects.toThrow(/下载中断，已收到 0\.0 MB/)
  })
})
