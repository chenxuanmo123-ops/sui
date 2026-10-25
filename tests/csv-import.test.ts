import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { csvLines, datasetFromImport, prepareTable, readCSV, suggestHeaderIndex } from '../src/importers'

const preamble = readFileSync(resolve('tests/fixtures/preamble-report.csv'), 'utf8')

describe('CSV 预览：首行不能当表头时由用户选择表头与范围', () => {
  it('保留原始记录与物理行号，标题行不会被当成字段名', async () => {
    const document = await readCSV(new File([preamble], 'preamble-report.csv', { type: 'text/csv' }))
    expect(document.format).toBe('CSV')
    expect(document.tables).toHaveLength(1)
    const table = document.tables[0]
    expect(table.name).toBe('CSV')
    expect(table.lines[0]).toEqual({ cells: ['年度销售导出（示例记录）'], sourceRow: 1 })
    expect(table.lines[1].cells).toEqual(['period', 'sales', 'region'])
    expect(table.lines[1].sourceRow).toBe(2)
    expect(table.warnings.join(' ')).toContain('逗号')
    expect(table.warnings.join(' ')).toContain('CSV 没有工作表结构')
    expect(table.warnings.join(' ')).toContain('有 1 个记录的列数与最常见的 3 列不同')
    expect(suggestHeaderIndex(table)).toBe(1)
  })

  it('按选定表头与截止行导入，标题保留文件名，来源行仍是原文件行号', async () => {
    const document = await readCSV(new File([preamble], 'preamble-report.csv', { type: 'text/csv' }))
    const table = document.tables[0]
    // Exclude the footer row by stopping at the last yearly record.
    const dataset = await datasetFromImport(document, table, 1, 5)
    expect(dataset.title).toBe('preamble-report.csv')
    expect(dataset.headers).toEqual(['period', 'sales', 'region'])
    expect(dataset.rows).toHaveLength(4)
    expect(dataset.rows[0]).toEqual({ period: '2020', sales: '120', region: '华东' })
    expect(dataset.origin).toMatchObject({ format: 'CSV', headerRow: 2, reviewed: true })
    expect(dataset.origin?.sheet).toBeUndefined()
    expect(dataset.origin?.locations[0]).toBe('CSV · 第 3 行')
    expect(dataset.origin?.fileHash).toHaveLength(64)
  })

  it('预览范围包含页脚时仍按用户选择导入，不静默丢弃或改写记录', async () => {
    const document = await readCSV(new File([preamble], 'preamble-report.csv', { type: 'text/csv' }))
    const table = document.tables[0]
    const included = prepareTable(table, 1, table.lines.length - 1)
    expect(included.rows.at(-1)).toEqual({ period: '合计', sales: '568', region: null })
  })

  it('引号内换行按一个字段保留，并推进后续记录的物理行号', () => {
    const parsed = csvLines('id,note\n1,"line1\nline2"\n2,ok\n', ',')
    expect(parsed.lines).toEqual([
      { cells: ['id', 'note'], sourceRow: 1 },
      { cells: ['1', 'line1\nline2'], sourceRow: 2 },
      { cells: ['2', 'ok'], sourceRow: 4 },
    ])
    expect(parsed.warnings).toEqual([])
  })

  it('未闭合引号给出警告而不是让预览直接失败', () => {
    const parsed = csvLines('id,note\n1,"open\n2,x\n', ',')
    expect(parsed.lines[1].cells).toEqual(['1', 'open\n2,x\n'])
    expect(parsed.warnings[0]).toContain('引号未闭合')
  })

  it('UTF-16 与分号分隔的 CSV 在预览中同样可读，并说明解码方式', async () => {
    const text = '年份;值\r\n2020;3\r\n'
    const bytes = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap(char => {
      const code = char.charCodeAt(0)
      return [code & 0xff, code >> 8]
    })])
    const document = await readCSV(new File([bytes], 'utf16-semicolon.csv', { type: 'text/csv' }))
    const table = document.tables[0]
    expect(table.lines[0].cells).toEqual(['年份', '值'])
    expect(table.method).toContain('分号')
    expect(table.warnings.join(' ')).toContain('UTF-16LE')
    expect(prepareTable(table, 0, 1).rows).toEqual([{ 年份: '2020', 值: '3' }])
  })

  it('宽度正常的重复表头保留在原行供修订，不把第一条数据推成表头', () => {
    const parsed = csvLines('a,a\nperiod,sales\n2020,1\n', ',')
    const table = { name: 'CSV', lines: parsed.lines, warnings: [], method: 'CSV 文本解析' }
    expect(suggestHeaderIndex(table)).toBe(0)
    expect(() => prepareTable(table, 0, 2)).toThrow('重复字段')
    expect(prepareTable(table, 1, 2).rows).toEqual([{ period: '2020', sales: '1' }])
  })
})
