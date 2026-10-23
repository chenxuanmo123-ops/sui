import type { Database, SqlValue } from 'sql.js'
import type { Row } from './data'
import { exportColumnNames } from './sql-names'

export type ConsoleRow = (string | number | null)[]
export type ExtraTable = { headers: string[]; rows: Row[] }
export const CONSOLE_TABLE = 'extra'

// Reader-facing SQL console: one read-only statement over the loaded snapshot.
// The worker database already sets PRAGMA query_only, so this check is a second
// line of defence, not the only one.
const FORBIDDEN = /\b(insert|update|delete|replace|drop|alter|create|attach|detach|pragma|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|load_extension|writefile|readfile|fsdir|edit)\b/i
const PARAMETER = /[?:@$][A-Za-z0-9_]*/g

// Replace comments and quoted values with spaces while keeping the rest of the
// statement intact. This prevents a keyword or semicolon inside a string/comment
// from being treated as SQL syntax.
export function maskSql(sql: string) {
  let output = ''
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line' | 'block' = 'normal'
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i], next = sql[i + 1]
    if (state === 'line') {
      output += char === '\n' ? '\n' : ' '
      if (char === '\n') state = 'normal'
      continue
    }
    if (state === 'block') {
      if (char === '*' && next === '/') { output += '  '; i++; state = 'normal' }
      else output += char === '\n' ? '\n' : ' '
      continue
    }
    if (state === 'single') {
      if (char === "'" && next === "'") { output += '  '; i++ }
      else if (char === "'") { output += ' '; state = 'normal' }
      else output += char === '\n' ? '\n' : ' '
      continue
    }
    if (state === 'double') {
      if (char === '"' && next === '"') { output += '  '; i++ }
      else if (char === '"') { output += ' '; state = 'normal' }
      else output += char === '\n' ? '\n' : ' '
      continue
    }
    if (state === 'backtick') {
      if (char === '`') { output += ' '; state = 'normal' }
      else output += char === '\n' ? '\n' : ' '
      continue
    }
    if (state === 'bracket') {
      if (char === ']') { output += ' '; state = 'normal' }
      else output += char === '\n' ? '\n' : ' '
      continue
    }
    if (char === '-' && next === '-') { output += '  '; i++; state = 'line'; continue }
    if (char === '/' && next === '*') { output += '  '; i++; state = 'block'; continue }
    if (char === "'") { output += ' '; state = 'single'; continue }
    if (char === '"') { output += ' '; state = 'double'; continue }
    if (char === '`') { output += ' '; state = 'backtick'; continue }
    if (char === '[') { output += ' '; state = 'bracket'; continue }
    output += char
  }
  return output
}

export function validateReadOnlyQuery(input: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('请输入一条 SELECT 或 WITH 查询。')
  const sql = trimmed.replace(/;\s*$/, '')
  if (!sql.trim()) throw new Error('请输入一条 SELECT 或 WITH 查询。')
  const masked = maskSql(sql)
  if (masked.includes(';')) throw new Error('一次只能执行一条语句，请删除多余的分号。')
  const first = masked.trim().match(/^([A-Za-z]+)/)?.[1]?.toLowerCase()
  if (first !== 'select' && first !== 'with') throw new Error('只允许 SELECT 或 WITH ... SELECT 查询，不执行写操作。')
  const forbidden = masked.match(FORBIDDEN)?.[1]
  if (forbidden) throw new Error('查询包含不允许的关键字：' + forbidden.toUpperCase() + '。此控制台只读。')
  const parameter = masked.match(PARAMETER)?.[0]
  if (parameter) throw new Error('暂不支持查询参数（' + parameter + '），请直接写明确的字面值。')
  if (/\bsqlite_[a-z_]+/i.test(masked)) throw new Error('不开放 SQLite 内部表，请查询 data 或 readable。')
  return sql
}

const display = (value: SqlValue): string | number | null => {
  if (value === null) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  return '[BLOB ' + value.byteLength + ' bytes]'
}

export type ConsoleResult = { columns: string[]; rows: ConsoleRow[]; truncated: boolean; elapsedMs: number; sql: string }

const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"'

// The optional second table is session-only. Its name is fixed so a query can
// never create a table; its columns are cN and _row is the imported data row.
export function installExtraTable(db: Database, table: ExtraTable) {
  if (!table.headers.length || table.headers.length > 200) throw new Error('关联表需要 1—200 列。')
  if (table.headers.some(header => !header.trim())) throw new Error('关联表存在空列名，请补充列名后上传。')
  if (table.rows.length > 100000) throw new Error('关联表最多 100,000 行。')
  const names = exportColumnNames(table, '_row')
  db.run('PRAGMA query_only = OFF')
  try {
    db.run('BEGIN')
    db.run('DROP VIEW IF EXISTS extra_readable')
    db.run('DROP TABLE IF EXISTS ' + quote(CONSOLE_TABLE))
    db.run('CREATE TABLE ' + quote(CONSOLE_TABLE) + ' ("_row" INTEGER PRIMARY KEY, ' + table.headers.map((_, i) => '"c' + i + '" TEXT').join(', ') + ')')
    const insert = db.prepare('INSERT INTO ' + quote(CONSOLE_TABLE) + ' VALUES (' + Array(table.headers.length + 1).fill('?').join(',') + ')')
    try { table.rows.forEach((row, i) => insert.run([i + 1, ...table.headers.map(header => row[header] ?? null)])) } finally { insert.free() }
    db.run('CREATE VIEW extra_readable AS SELECT "_row" AS "_row"' + names.map((name, i) => ', "c' + i + '" AS ' + quote(name)).join('') + ' FROM ' + quote(CONSOLE_TABLE))
    db.run('COMMIT')
  } catch (error) {
    try { db.run('ROLLBACK') } catch { /* transaction already closed */ }
    throw error
  } finally {
    db.run('PRAGMA query_only = ON')
  }
  return { name: CONSOLE_TABLE, columns: table.headers.length, rows: table.rows.length, names }
}

// Removing the extra table must reach the worker: keeping it there would make
// "移除" a label change while a JOIN still resolved against stale rows.
export function dropExtraTable(db: Database) {
  db.run('PRAGMA query_only = OFF')
  try {
    db.run('DROP VIEW IF EXISTS extra_readable')
    db.run('DROP TABLE IF EXISTS ' + quote(CONSOLE_TABLE))
  } finally {
    db.run('PRAGMA query_only = ON')
  }
  return { name: CONSOLE_TABLE, columns: 0, rows: 0, names: [] }
}

export function runConsoleQuery(db: Database, input: string, limit = 500): ConsoleResult {
  const sql = validateReadOnlyQuery(input)
  const started = performance.now()
  const statement = db.prepare(sql)
  try {
    const columns = statement.getColumnNames()
    const rows: ConsoleRow[] = []
    while (statement.step()) rows.push(statement.get().map(display))
    const truncated = rows.length > limit
    if (truncated) rows.length = limit
    return { columns, rows, truncated, elapsedMs: Math.round(performance.now() - started), sql }
  } finally {
    statement.free()
  }
}
