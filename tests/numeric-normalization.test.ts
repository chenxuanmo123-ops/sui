import { describe, expect, it } from 'vitest'
import type { Dataset } from '../src/data'
import { normalizeNumericText, previewCleaning } from '../src/preparation'

function dataset(values: (string | null)[]): Dataset {
  return {
    title: '数字格式边界测试',
    sourceUrl: '',
    loadedAt: '2026-10-23',
    fingerprint: 'numeric-format-fixture',
    isPublic: false,
    headers: ['金额'],
    rows: values.map(value => ({ 金额: value })),
    sourceRecords: values.map((_, index) => index + 2),
  }
}

function clean(value: string | null, extra: Partial<Parameters<typeof previewCleaning>[1]> = {}) {
  const data = dataset([value])
  return {
    data,
    preview: previewCleaning(data, {
      field: '金额',
      trim: false,
      numeric: true,
      markers: '',
      dropMissing: false,
      deduplicate: false,
      ...extra,
    }),
  }
}

describe('明确选择的数字规范化，不猜测金额单位', () => {
  it('识别货币符号、千分位与会计括号负数', () => {
    expect(normalizeNumericText('$1,234.50')).toEqual({ value: '1234.50', percent: false })
    expect(normalizeNumericText('($1,234.50)')).toEqual({ value: '-1234.50', percent: false })
    expect(normalizeNumericText('-¥98')).toEqual({ value: '-98', percent: false })
    expect(normalizeNumericText('USD 1,234.50')).toEqual({ value: '1234.50', percent: false })
  })

  it('识别全角、空格分组与欧洲小数逗号', () => {
    expect(normalizeNumericText('１２３４．５０')).toEqual({ value: '1234.50', percent: false })
    expect(normalizeNumericText('¥ 1 234,50')).toEqual({ value: '1234.50', percent: false })
    expect(normalizeNumericText('1.234,56')).toEqual({ value: '1234.56', percent: false })
    expect(normalizeNumericText('1 234,50')).toEqual({ value: '1234.50', percent: false })
    expect(normalizeNumericText('1 234,50')).toEqual({ value: '1234.50', percent: false })
    expect(normalizeNumericText('　$1,234　')).toEqual({ value: '1234', percent: false })
  })

  it('百分号只移除符号，不擅自除以 100', () => {
    const { preview } = clean('12.5%')
    expect(preview.rows[0]['金额']).toBe('12.5')
    expect(preview.percentValues).toBe(1)
    expect(preview.steps.join('')).toContain('未自动除以 100')
  })

  it('不猜测万元等乘数，也不接受错误分组', () => {
    for (const value of ['1.2万元', '12,34', 'N/A']) {
      expect(normalizeNumericText(value)).toBeNull()
      const { preview } = clean(value)
      expect(preview.rows[0]['金额']).toBe(value)
      expect(preview.failedNumeric).toBe(1)
    }
  })

  it('无法识别时给出原值与来源记录，原文不被修改', () => {
    const { data, preview } = clean('N/A')
    expect(preview.failedExamples).toEqual([{ record: 2, value: 'N/A' }])
    expect(data.rows[0]['金额']).toBe('N/A')
  })

  it('只有明确勾选时才把无法识别的值置空', () => {
    expect(clean('N/A').preview.rows[0]['金额']).toBe('N/A')
    const { preview } = clean('N/A', { blankFailed: true })
    expect(preview.rows[0]['金额']).toBeNull()
    expect(preview.blankedNumeric).toBe(1)
    expect(preview.failedNumeric).toBe(1)
  })

  it('已经是纯数字的值不产生改动', () => {
    const { preview } = clean('1234.50')
    expect(preview.changedCells).toBe(0)
    expect(preview.failedNumeric).toBe(0)
  })
})
