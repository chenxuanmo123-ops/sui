import { strToU8, zipSync } from 'fflate'
import type { Dataset, Mapping, Point } from './data'

// A portable bundle contains the cleaned rows, a schema, the exact executed SQL
// with its parameters inlined, and the expected result. The Python runner is
// the only executable part and uses the standard library alone.
export type ReproResult = {
  kind: 'exploration' | 'workspace'
  title: string
  question?: string
  spec?: unknown
  sql: string
  parameters: (string | number | null)[]
  columns: string[]
  rows: (string | number | null)[][]
  rowIds: number[][]
  total: number
  excluded: number
  truncated?: boolean
  unavailable?: { label: string; excluded: number; rowIds: number[] }[]
}

// The analysis workspace drops zero-denominator groups from points, while the
// executed SQL still returns them with a NULL value. Include those rows so the
// bundle reproduces the full SQL result instead of reporting a row-count
// mismatch. Their source_records are NULL by construction, so rowIds stay empty.
export function workspaceReproResult(active: { mapping: Mapping; points: Point[]; unavailableGroups?: { label: string; excluded: number; rowIds: number[] }[]; matched: number; skipped: number }) {
  const rate = active.mapping.rate
  const rows: (string | number | null)[][] = rate
    ? [...active.points.map(p => [p.label, p.rate?.numerator ?? null, p.rate?.denominator ?? null, p.rate?.excluded ?? null, p.value]), ...(active.unavailableGroups ?? []).map(g => [g.label, 0, 0, g.excluded, null])]
    : active.points.map(p => [p.label, p.value])
  const rowIds = rate
    ? [...active.points.map(p => p.rowIds), ...(active.unavailableGroups ?? []).map(() => [])]
    : active.points.map(p => p.rowIds)
  return {
    columns: rate ? ['分组', '分子', '分母', '排除', '结果'] : ['分组', '结果'],
    rows,
    rowIds,
    unavailable: active.unavailableGroups ?? [],
    total: active.matched,
    excluded: active.skipped,
    truncated: false,
  }
}

export type Bundle = { name: string; files: Record<string, string>; zip: Uint8Array }

const quoteName = (name: string) => '"' + name.replaceAll('"', '""') + '"'
const csvCell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
}
const sqlLiteral = (value: string | number | null) => {
  if (value === null) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SQL 参数包含无效数值，无法导出复现包。')
    return String(value)
  }
  return "'" + value.replaceAll("'", "''") + "'"
}

// Column names are only used to make the exported files readable. If they are
// not case-insensitively unique, fall back to cN names so SQLite does not merge
// or reject them. The analysis SQL always refers to cN aliases through a view.
export function exportColumnNames(dataset: Dataset, recordName: string) {
  const lower = dataset.headers.map(h => h.toLowerCase())
  const readable = new Set(lower).size === lower.length && !lower.includes(recordName.toLowerCase())
  return readable ? dataset.headers.slice() : dataset.headers.map((_, i) => 'c' + i)
}

export function recordColumnName(dataset: Dataset) {
  const lower = new Set(dataset.headers.map(h => h.toLowerCase()))
  let name = '__record__'
  while (lower.has(name.toLowerCase())) name += '_'
  return name
}

export function inlineSql(sql: string, parameters: (string | number | null)[]) {
  let index = 0, output = ''
  let state: 'normal' | 'single' | 'double' | 'comment' = 'normal'
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i], next = sql[i + 1]
    if (state === 'comment') {
      output += char
      if (char === '\n') state = 'normal'
      continue
    }
    if (state === 'single') {
      output += char
      if (char === "'" && next === "'") { output += next; i++ }
      else if (char === "'") state = 'normal'
      continue
    }
    if (state === 'double') {
      output += char
      if (char === '"' && next === '"') { output += next; i++ }
      else if (char === '"') state = 'normal'
      continue
    }
    if (char === '-' && next === '-') { output += char + next; i++; state = 'comment'; continue }
    if (char === "'") { output += char; state = 'single'; continue }
    if (char === '"') { output += char; state = 'double'; continue }
    if (char === '?') {
      if (index >= parameters.length) throw new Error('SQL 参数数量与复现包不一致。')
      output += sqlLiteral(parameters[index++])
      continue
    }
    output += char
  }
  if (index !== parameters.length) throw new Error('SQL 参数数量与复现包不一致。')
  return output
}

const markdownCell = (value: unknown) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')

export function buildBundle(dataset: Dataset, result: ReproResult): Bundle {
  if (!result.columns.length || result.rows.some(row => row.length !== result.columns.length)) throw new Error('结果列与行不一致，无法导出复现包。')
  if (result.rowIds.length !== result.rows.length) throw new Error('结果来源记录与行数不一致，无法导出复现包。')
  const recordName = recordColumnName(dataset)
  const exportHeaders = exportColumnNames(dataset, recordName)
  const headerLine = [recordName, ...exportHeaders].map(csvCell).join(',')
  const csvLines = [headerLine, ...dataset.rows.map((row, i) => [i + 2, ...dataset.headers.map(h => row[h])].map(csvCell).join(','))]
  const csv = csvLines.join('\r\n') + '\r\n'

  const ddl = dataset.headers.map((_, i) => '  ' + quoteName(exportHeaders[i]) + ' TEXT' + (i === dataset.headers.length - 1 ? '' : ',')).join('\n')
  const viewColumns = ['  ' + quoteName(recordName) + ' AS "_record",', ...dataset.headers.map((_, i) => '  ' + quoteName(exportHeaders[i]) + ' AS "c' + i + '"' + (i === dataset.headers.length - 1 ? '' : ','))].join('\n')
  const mapping = dataset.headers.map((h, i) => '-- c' + i + ' = ' + JSON.stringify(h)).join('\n')
  const schema = [
    '-- 数鉴 Agent · SQLite schema（由真实执行结果导出）',
    '-- 数据快照 SHA-256：' + dataset.fingerprint,
    '-- 来源：' + (dataset.sourceUrl || '用户文件'),
    '-- 数值列以 TEXT 保存原始值；严格数值解析由 run_analysis.py 中的 strict_number 提供。',
    mapping,
    '',
    'DROP VIEW IF EXISTS data;',
    'DROP TABLE IF EXISTS listings;',
    'CREATE TABLE listings (',
    '  ' + quoteName(recordName) + ' INTEGER PRIMARY KEY,',
    ddl,
    ');',
    'CREATE VIEW data AS SELECT',
    viewColumns,
    'FROM listings;',
    '',
  ].join('\n')

  const inlined = inlineSql(result.sql, result.parameters)
  const analysis = [
    '-- 数鉴 Agent · 可复现分析 SQL',
    '-- 数据快照 SHA-256：' + dataset.fingerprint,
    '-- 分析：' + result.title.replaceAll('\n', ' '),
    '-- 参数已按实际执行值内联；原始模板与参数列表见 expected.json。',
    '-- 依赖 UDF：strict_number、compare_labels、time_bucket，定义见 run_analysis.py。',
    '-- record 列 ' + recordName + ' 与界面“来源记录”编号一致。',
    '',
    inlined.trimEnd() + ';',
    '',
  ].join('\n')

  const expected = {
    schemaVersion: 1,
    generator: '数鉴 Agent',
    dataset: {
      title: dataset.title,
      sourceUrl: dataset.sourceUrl,
      fingerprint: dataset.fingerprint,
      originalFileName: dataset.originalFileName ?? null,
      originalFileHash: dataset.originalFileHash ?? null,
      loadedAt: dataset.loadedAt,
      rows: dataset.rows.length,
      columns: dataset.headers.length,
      preparation: dataset.preparation ?? null,
      sourceRecords: dataset.sourceRecords ?? null,
      recordColumn: recordName,
    },
    result: {
      kind: result.kind,
      title: result.title,
      question: result.question ?? null,
      spec: result.spec ?? null,
      columns: result.columns,
      rows: result.rows,
      rowIds: result.rowIds,
      total: result.total,
      excluded: result.excluded,
      truncated: result.truncated ?? false,
      unavailable: result.unavailable ?? [],
    },
    sql: { template: result.sql, parameters: result.parameters },
    notes: [
      '数值来自当前数据快照上的真实 SQL 执行，不使用估算或模型生成值。',
      '空单元格在 data.csv 中为空串，导入后为 NULL；无效数值不会按 0 处理。',
      '中位数、P25、P75 使用线性插值 rank = 1 + (n - 1) × p。',
    ],
  }

  const readme = [
    '# 数鉴 Agent · 可复现 SQL 包',
    '',
    '本包来自一次真实执行的浏览器内 SQLite 查询，用于在应用之外独立复算并核对结果。',
    '',
    '| 文件 | 内容 |',
    '| --- | --- |',
    '| `data.csv` | 当前清洗后数据快照；首列 `' + markdownCell(recordName) + '` 是来源记录号，与界面一致 |',
    '| `schema.sql` | SQLite 建表与 `data` 视图；视图把列映射为 `c0`、`c1`… |',
    '| `analysis.sql` | 实际执行的 SQL，参数已按本次执行值内联 |',
    '| `expected.json` | 数据快照、结果值、来源记录、原始 SQL 模板与参数 |',
    '| `run_analysis.py` | 仅用 Python 标准库重建数据库、执行 SQL 并逐行核对结果 |',
    '',
    '## 一键复现',
    '',
    '```sh',
    'python run_analysis.py',
    '```',
    '',
    '需要 Python 3.8+，不依赖第三方包。脚本会创建临时数据库、导入 CSV、注册分析所需的三个 UDF，然后执行 `analysis.sql`，并把结果与 `expected.json` 逐行比较。成功时输出 `PASS`，失败时以非零状态退出。',
    '',
    '## 口径说明',
    '',
    '- 快照 SHA-256：`' + dataset.fingerprint + '`。结果只对这份快照成立，换数据后必须重新执行。',
    '- `' + markdownCell(recordName) + '` 与界面“来源记录”编号相同；`sourceRecords` 可继续映射回原文件记录。',
    '- 数值列保留原始文本；`strict_number` 只接受标准十进制或科学计数法，其余为 NULL，不当作 0。',
    '- `compare_labels` 对数值按数值比较、对 `YYYY-MM-DD` / `YYYY/MM/DD` 按日期比较；其他文本按自然顺序比较。Python 的文本排序不等同于浏览器的中文拼音排序，涉及中文文本范围筛选时需人工核对。',
    '- `time_bucket` 支持原样、按月、按年三种粒度；无效日期会报错，不静默转换。',
    '- 中位数、P25、P75 使用线性插值，与 numpy.quantile / DuckDB quantile_cont 的定义一致。',
    '',
    '## 限制',
    '',
    '- 这是描述性结果，不证明因果、总体代表性或预测能力。',
    '- 若要用 DuckDB 或 PostgreSQL 直接运行，需要自行实现同名 UDF；本包的一键复现只保证 SQLite + Python 标准库。',
    '- `expected.json` 中的 `rowIds` 是快照记录号，不是原文件物理行号；原始行号保留在数据集的 `sourceRecords` / 来源定位中。',
    '',
    '## 数据来源',
    '',
    '- 标题：' + markdownCell(dataset.title),
    '- 来源：' + markdownCell(dataset.sourceUrl || '用户上传文件'),
    '- 原始文件：' + markdownCell(dataset.originalFileName || '未记录'),
    '- 原始文件 SHA-256：`' + (dataset.originalFileHash || '未记录') + '`',
    '',
  ].join('\n')

  const files = {
    'data.csv': csv,
    'schema.sql': schema,
    'analysis.sql': analysis,
    'expected.json': JSON.stringify(expected, null, 2) + '\n',
    'README.md': readme,
    'run_analysis.py': runnerSource(),
  }
  const name = '数鉴-可复现SQL包-' + safeFileName(dataset.title || '分析结果') + '.zip'
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])), { level: 6 })
  return { name, files, zip }
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[\\/:*?"<>|\r\n]+/g, '-').trim()
  return (cleaned || '数据集').slice(0, 60)
}

// The runner intentionally lives in the bundle, so it cannot import app code.
// Keep it dependency-free and aligned with src/analytics.ts UDF semantics.
function runnerSource() {
  return String.raw`#!/usr/bin/env python3
"""Rebuild the snapshot in SQLite and verify analysis.sql against expected.json."""
import calendar
import csv
import json
import math
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NUMBER = re.compile(r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$')
DATE = re.compile(r'^([0-9]{4})[-/]([0-9]{1,2})(?:[-/]([0-9]{1,2}))?$')
BUCKET = re.compile(r'^([0-9]{4})(?:[-/]([0-9]{1,2})(?:[-/]([0-9]{1,2})(?:[T ](?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:[0-9]{2})?)?)?)?$')


def strict_number(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text or not NUMBER.fullmatch(text):
        return None
    number = float(text)
    return number if math.isfinite(number) else None


def compare_labels(first, second):
    left = '' if first is None else str(first)
    right = '' if second is None else str(second)
    ln, rn = strict_number(left), strict_number(right)
    if ln is not None and rn is not None:
        return (ln > rn) - (ln < rn)
    lm, rm = DATE.fullmatch(left), DATE.fullmatch(right)
    if lm and rm:
        lt = tuple(int(part or 1) for part in lm.groups())
        rt = tuple(int(part or 1) for part in rm.groups())
        return (lt > rt) - (lt < rt)
    return natural(left, right)


def natural(left, right):
    parts = re.compile(r'([0-9]+|[^0-9]+)')
    a, b = parts.findall(left), parts.findall(right)
    for x, y in zip(a, b):
        if x.isdigit() and y.isdigit():
            xn, yn = int(x), int(y)
            if xn != yn:
                return (xn > yn) - (xn < yn)
        elif x != y:
            return (x.casefold() > y.casefold()) - (x.casefold() < y.casefold())
    return (len(a) > len(b)) - (len(a) < len(b))


def time_bucket(value, bucket):
    text = '' if value is None else str(value).strip()
    if bucket in (None, '', 'none'):
        return text
    match = BUCKET.fullmatch(text)
    if not match or (bucket == 'month' and not match.group(2)):
        raise ValueError('日期不能按所选粒度分桶，请确认标准年月日格式。')
    year, month, day = int(match.group(1)), int(match.group(2) or 1), int(match.group(3) or 1)
    if month < 1 or month > 12 or day < 1 or day > calendar.monthrange(year, month)[1]:
        raise ValueError('日期字段包含无效日期，未进行静默转换。')
    return match.group(1) if bucket == 'year' else '%04d-%02d' % (year, month)


def load(connection, name):
    connection.executescript((ROOT / name).read_text(encoding='utf-8'))


def import_csv(connection):
    with (ROOT / 'data.csv').open(encoding='utf-8', newline='') as handle:
        reader = csv.reader(handle)
        header = next(reader)
        columns = ','.join('"' + name.replace('"', '""') + '"' for name in header)
        marks = ','.join('?' for _ in header)
        rows = ([None if value == '' else value for value in row] for row in reader)
        connection.executemany('INSERT INTO listings (%s) VALUES (%s)' % (columns, marks), rows)


def same(actual, expected):
    if actual is None or expected is None:
        return actual is None and expected is None
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        return isinstance(actual, (int, float)) and math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-9)
    return str(actual) == str(expected)


def canonical(row):
    return json.dumps(row, ensure_ascii=False, sort_keys=True, default=str)


def main():
    connection = sqlite3.connect(':memory:')
    connection.create_function('strict_number', 1, strict_number)
    connection.create_function('compare_labels', 2, compare_labels)
    connection.create_function('time_bucket', 2, time_bucket)
    load(connection, 'schema.sql')
    import_csv(connection)
    sql = (ROOT / 'analysis.sql').read_text(encoding='utf-8').strip().rstrip(';')
    actual = connection.execute(sql).fetchall()
    expected = json.loads((ROOT / 'expected.json').read_text(encoding='utf-8'))
    wanted = expected['result']['rows']
    width = len(expected['result']['columns'])
    if len(actual) != len(wanted):
        print('FAIL 行数不一致：实际 %d，预期 %d' % (len(actual), len(wanted)))
        return 1
    if any(len(row) < width for row in actual):
        print('FAIL 实际结果的列数少于 expected.json 记录的结果列。')
        return 1
    pairs = sorted(zip(actual, wanted), key=lambda pair: canonical(pair[0][:width]))
    for row, (got, want) in enumerate(pairs, 1):
        if any(not same(a, b) for a, b in zip(got[:width], want)):
            print('FAIL 第 %d 行不一致：实际 %r，预期 %r' % (row, got[:width], want))
            return 1
    if all(len(row) > width for row in actual):
        actual_ids = set()
        for row in actual:
            for value in str(row[width] or '').split(','):
                if value.strip():
                    actual_ids.add(int(float(value)))
        expected_ids = {int(value) for ids in expected['result']['rowIds'] for value in ids}
        if actual_ids != expected_ids:
            print('FAIL 来源记录不一致：实际 %d 条，预期 %d 条。' % (len(actual_ids), len(expected_ids)))
            return 1
    print('PASS 复现结果与 expected.json 一致（%d 行，来源记录已核对），数据快照 %s' % (len(actual), expected['dataset']['fingerprint']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
`
}
