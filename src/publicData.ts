// Download of the built-in OWID file.
//
// The file is pinned to one upstream commit but is ~9 MB, and the raw GitHub
// host regularly stalls or resets partway through on this network. So:
//   · mirrors serving the same commit are tried in order;
//   · a transfer that stops making progress is dropped and the next candidate
//     resumes from the byte offset already received (Range);
//   · the finished bytes are hashed and must equal the pinned SHA-256 before
//     anything is shown as evidence. A mirror can be slow, but it cannot
//     silently change the data.
import { PUBLIC_DATA_BYTES, PUBLIC_DATA_MIRRORS, PUBLIC_DATA_SHA256 } from './data'

export type PublicDownloadProgress = { loaded: number; total: number; source: string }
type Mirror = { label: string; url: string }

export type PublicDownloadOptions = {
  signal: AbortSignal
  onProgress?: (progress: PublicDownloadProgress) => void
  /** Pinned size, digest and mirror list; overridden only by tests. */
  bytes?: number
  sha256?: string
  mirrors?: Mirror[]
  stallMs?: number
  candidateMs?: number
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function join(parts: Uint8Array[], size: number) {
  if (parts.length === 1 && parts[0]!.length === size) return parts[0]!
  const merged = new Uint8Array(size)
  let at = 0
  for (const part of parts) { merged.set(part, at); at += part.length }
  return merged
}

function describe(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return '连接停滞'
  if (error instanceof Error && error.message) return error.message
  return '网络异常'
}

type Sink = {
  parts: Uint8Array[]
  /** Bytes received so far, shared with the caller so a failed transfer still counts. */
  loaded: number
  size: number
  /** Mirror delivering the newest bytes, named in the progress line. */
  label: string
  report: (loaded: number) => void
}

/** Streams one URL into the sink, resuming at `sink.loaded`. */
async function stream(url: string, sink: Sink, signal: AbortSignal, stallMs: number, candidateMs: number) {
  const local = new AbortController()
  const combined = AbortSignal.any([signal, local.signal])
  const reap = (message: string) => local.abort(new DOMException(message, 'TimeoutError'))
  let idle: ReturnType<typeof setTimeout> | undefined
  const rearm = () => {
    clearTimeout(idle)
    idle = setTimeout(() => reap('下载停滞'), stallMs)
  }
  const cap: ReturnType<typeof setTimeout> = setTimeout(() => reap('该来源超时'), candidateMs)
  try {
    rearm()
    const start = sink.loaded
    const response = await fetch(url, {
      signal: combined,
      cache: 'no-store',
      headers: start ? { Range: `bytes=${start}-` } : {},
    })
    if (start && response.status === 200) {
      // The host ignored Range and restarted from zero; drop what this run held.
      sink.parts.length = 0
      sink.report(0)
    } else if (!response.ok) {
      throw new Error(`来源返回 HTTP ${response.status}`)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('响应没有可读取的数据流')
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      rearm()
      sink.parts.push(value)
      sink.report(sink.loaded + value.length)
      if (sink.loaded > sink.size) throw new Error('来源返回的文件大于固定提交')
    }
  } finally {
    clearTimeout(idle)
    clearTimeout(cap)
  }
}

/**
 * Downloads the pinned OWID CSV and verifies it byte for byte. `bytes` is the
 * raw file; `source` names the mirror that finished the transfer.
 */
export async function downloadPublicDataset(options: PublicDownloadOptions) {
  const { signal, onProgress } = options
  const size = options.bytes ?? PUBLIC_DATA_BYTES
  const expected = options.sha256 ?? PUBLIC_DATA_SHA256
  const mirrors = options.mirrors ?? PUBLIC_DATA_MIRRORS
  const stallMs = options.stallMs ?? 20_000
  const candidateMs = options.candidateMs ?? 75_000
  const retries = 2
  const failures: string[] = []
  let last = 0
  let source = ''
  const sink: Sink = {
    parts: [],
    loaded: 0,
    size,
    label: '',
    report: (loaded) => {
      sink.loaded = loaded
      source = sink.label
      const now = performance.now()
      if (now - last < 120 && loaded < size) return
      last = now
      onProgress?.({ loaded, total: size, source })
    },
  }

  for (const mirror of mirrors) {
    for (let attempt = 0; attempt < retries; attempt++) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError')
      if (sink.loaded >= size) break
      const before = sink.loaded
      sink.label = mirror.label
      try {
        await stream(mirror.url, sink, signal, stallMs, candidateMs)
        break
      } catch (error) {
        if (signal.aborted) throw new DOMException('已取消', 'AbortError')
        failures.push(`${mirror.label}：${describe(error)}`)
        // Two attempts without a single new byte: this mirror is not helping.
        if (sink.loaded === before && attempt > 0) break
      }
    }
    if (sink.loaded >= size) break
  }

  if (sink.loaded !== size) {
    const detail = failures.length ? `（${[...new Set(failures)].slice(-2).join('；')}）` : ''
    throw new Error(`下载中断，已收到 ${(sink.loaded / 1e6).toFixed(1)} MB / ${(size / 1e6).toFixed(1)} MB${detail}`)
  }
  const bytes = join(sink.parts, sink.loaded)
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes))
  if (digest !== expected) {
    throw new Error(`下载内容 SHA-256 与固定提交不一致（${digest.slice(0, 12)}…），已拒绝载入，请重试或手动下载后导入`)
  }
  onProgress?.({ loaded: bytes.length, total: bytes.length, source })
  return { bytes, source, digest }
}
