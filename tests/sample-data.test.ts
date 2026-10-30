import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCSV } from '../src/data'
import type { Dataset } from '../src/data'
import { sourceInfo } from '../src/provenance'
import { SAMPLE_DATA_PATH, SAMPLE_DATA_SHA256, SAMPLE_DESCRIPTION, SAMPLE_SOURCE_URL, SAMPLE_TITLE } from '../src/sampleData'

// The bundled sample is a convenience copy, not a fixture: it must stay
// byte-identical to the copy cited under docs/real-demo/, or the app refuses to
// load it. These checks fail the build if the file and the pin drift apart.
const file = fileURLToPath(new URL('../public/' + SAMPLE_DATA_PATH, import.meta.url))
const bytes = readFileSync(file)

describe('内置真实示例数据', () => {
  it('固定摘要与路径都是常量，来源指向 UCI 原始数据集', () => {
    expect(SAMPLE_DATA_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(SAMPLE_DATA_PATH).toBe('demo/uci-bike-sharing-day.csv')
    expect(SAMPLE_SOURCE_URL).toContain('archive.ics.uci.edu')
    expect(SAMPLE_TITLE).toContain('Bike Sharing')
    expect(SAMPLE_DESCRIPTION).toContain('731')
  })

  it('随应用附带的文件与固定 SHA-256 完全一致', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(SAMPLE_DATA_SHA256)
  })

  it('与 docs/real-demo 中引用的副本逐字节相同', () => {
    const cited = readFileSync(fileURLToPath(new URL('../docs/real-demo/day.csv', import.meta.url)))
    expect(Buffer.compare(bytes, cited)).toBe(0)
  })

  it('解析为 731 行、16 列，字段与真实 UCI 数据一致', () => {
    const parsed = parseCSV(bytes.toString('utf8'))
    expect(parsed.headers).toHaveLength(16)
    expect(parsed.rows).toHaveLength(731)
    expect(parsed.headers).toContain('instant')
    expect(parsed.headers).toContain('cnt')
    expect(parsed.headers).toContain('temp')
  })

  it('来源说明写明是附带副本，不冒充实时下载或已核验总体', () => {
    const dataset = { title: SAMPLE_TITLE, sourceUrl: SAMPLE_SOURCE_URL, originalFileHash: SAMPLE_DATA_SHA256, fingerprint: 'f'.repeat(64) } as unknown as Dataset
    const info = sourceInfo(dataset)
    expect(info.status).toContain('附带')
    expect(info.status).toContain('SHA-256')
    expect(info.notes).toContain('不是实时下载')
    expect(info.url).toContain('archive.ics.uci.edu')
  })
})
