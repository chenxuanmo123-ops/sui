import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowDownToLine, BarChart3, Code2, Link2, LoaderCircle, Play, ShieldCheck, Trash2, Upload } from 'lucide-react'
import type { Dataset } from './data'
import { download, parseCSV } from './data'
import { clearConsoleTable, loadConsoleTable, queryDataset } from './engine'
import type { ConsoleResult, ExtraTable } from './sql-console'
import { exportColumnNames } from './sql-names'

const SqlResultChart = lazy(() => import('./SqlResultChart'))

const EXAMPLE = 'SELECT "c0" AS 分组, COUNT(*) AS 记录数\nFROM data\nGROUP BY "c0"\nORDER BY 记录数 DESC\nLIMIT 20'
const numericExample = (dataset: Dataset) => 'SELECT "c0" AS 分组, strict_number("c' + (dataset.headers.length > 1 ? 1 : 0) + '") AS 数值\nFROM data\nWHERE strict_number("c' + (dataset.headers.length > 1 ? 1 : 0) + '") IS NOT NULL\nORDER BY 数值 DESC\nLIMIT 20'
const MAX_TABLE_BYTES = 30 * 1024 * 1024
const noteText = (text: string) => text.replace(/\s+/g, ' ').slice(0, 40)

// The example must not guess that column 0 of both tables is the key. Detect a
// main-table column that actually shares values with the extra table's first
// column; if none is found, say so in the comment instead of inventing a match.
function joinExample(dataset: Dataset, table: ExtraTable) {
  const key = table.headers[0]
  const sample = new Set(table.rows.slice(0, 200).map(row => row[key]).filter((value): value is string => Boolean(value)))
  const index = sample.size ? dataset.headers.findIndex(header => dataset.rows.slice(0, 500).some(row => row[header] !== null && sample.has(row[header]!))) : -1
  const main = 'c' + (index >= 0 ? index : 0)
  const note = index >= 0
    ? '-- 自动检测：主表 ' + noteText(dataset.headers[index]) + ' 与关联表 ' + noteText(key) + ' 有共同值，请核对口径\n'
    : '-- 未检测到共同值：下方连接键需按业务口径手动修改\n'
  return note + 'SELECT d."' + main + '" AS 主表键, e."c0" AS 关联表键, e."_row" AS 关联行号\nFROM data AS d\nLEFT JOIN extra AS e ON d."' + main + '" = e."c0"\nLIMIT 20'
}

type Props = { dataset: Dataset; table: ExtraTable | null; onTable: (table: ExtraTable | null) => void }

export default function SqlConsole({ dataset, table, onTable }: Props) {
  const names = useMemo(() => exportColumnNames(dataset, '_record'), [dataset])
  const extraNames = useMemo(() => table ? exportColumnNames(table, '_row') : [], [table])
  const [sql, setSql] = useState('SELECT * FROM readable LIMIT 20')
  const [result, setResult] = useState<ConsoleResult | null>(null)
  const [showChart, setShowChart] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tableBusy, setTableBusy] = useState(false)
  const [tableError, setTableError] = useState('')
  const running = useRef<AbortController | null>(null)
  const tableInput = useRef<HTMLInputElement>(null)
  const tableRef = useRef(table)
  tableRef.current = table
  useEffect(() => () => running.current?.abort(), [])

  // The worker can be replaced (timeout, reload) while the chosen extra table
  // still belongs to this dataset. Re-install it when the console mounts so the
  // visible "已装载" state always matches the database a query runs against.
  useEffect(() => {
    const initial = tableRef.current
    if (!initial) return
    loadConsoleTable(dataset, initial).catch(e => setTableError(e instanceof Error ? e.message : '关联表恢复失败，请重新上传。'))
  }, [dataset])

  async function execute() {
    if (busy) return
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    setBusy(true); setError('')
    try {
      setResult(await queryDataset(dataset, sql, controller.signal))
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '查询失败')
    } finally {
      if (running.current === controller) setBusy(false)
    }
  }

  async function pickTable(file: File | undefined) {
    if (!file || tableBusy) return
    setTableError('')
    if (!/\.csv$/i.test(file.name)) { setTableError('关联表目前只支持 CSV 文件。'); return }
    if (file.size > MAX_TABLE_BYTES) { setTableError('关联表最大 30 MB，请先在本地裁剪后再上传。'); return }
    setTableBusy(true)
    try {
      const parsed = parseCSV(await file.text())
      await loadConsoleTable(dataset, parsed)
      onTable(parsed)
      setResult(null)
    } catch (e) {
      setTableError(e instanceof Error ? e.message : '关联表读取失败。')
    } finally {
      setTableBusy(false)
    }
  }

  async function removeTable() {
    if (tableBusy) return
    setTableBusy(true); setTableError('')
    try {
      await clearConsoleTable(dataset)
      onTable(null)
      setResult(null)
    } catch (e) {
      setTableError(e instanceof Error ? e.message : '关联表移除失败。')
    } finally {
      setTableBusy(false)
    }
  }

  function csv() {
    if (!result) return
    const quote = (v: string | number | null) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
    download('﻿' + [result.columns.map(quote).join(','), ...result.rows.map(row => row.map(quote).join(','))].join('\r\n'), 'text/csv;charset=utf-8', '数鉴-SQL查询结果.csv')
  }

  return <div className="core-workspace">
    <header className="core-heading"><div><span className="core-caption">只读 · 本地 SQLite · 真实结果</span><h2>SQL 查询</h2><p>在当前数据快照上直接运行一条 SELECT 或 WITH 查询，可 JOIN 本次会话中上传的第二个 CSV。写操作、多条语句和查询参数会被拒绝；结果不经过 AI。</p></div><span className="tag"><ShieldCheck size={14} />只读</span></header>
    <div className="explore-layout">
      <section className="panel core-panel explore-controls">
        <h3><Code2 size={17} />可用对象</h3>
        <p className="core-muted"><code>data</code> 使用 <code>c0…c{dataset.headers.length - 1}</code>；<code>readable</code> 使用原表头（重名时回退 cN），并保留 <code>_record</code> 来源记录号。</p>
        <details className="sql-schema"><summary>字段映射（{dataset.headers.length} 列）</summary><div className="core-table-wrap"><table><thead><tr><th>列</th><th>原表头</th></tr></thead><tbody>{dataset.headers.map((_, i) => <tr key={i}><td>c{i}</td><td>{names[i]}</td></tr>)}</tbody></table></div></details>
        <p className="core-muted">可用函数：<code>strict_number(列)</code> 严格解析数值，<code>compare_labels(a,b)</code> 比较数字/日期/文本，<code>time_bucket(列,'month'|'year')</code> 分桶。空值不会被当作 0。</p>
        <button className="text-button" onClick={() => setSql(EXAMPLE)}>填入分组计数示例</button>
        <button className="text-button" onClick={() => setSql(numericExample(dataset))}>填入严格数值示例</button>

        <h3><Link2 size={17} />关联表（可选）</h3>
        <p className="core-muted">上传第二个 CSV 后，可在同一条查询里与主表 JOIN。它只在当前浏览器会话内有效，固定名为 <code>extra</code>（原表头视图为 <code>extra_readable</code>），<code>_row</code> 是关联表的数据行号；不写入数据快照，也不自动进入分析、图表或证据链。</p>
        <input ref={tableInput} type="file" accept=".csv,text/csv" className="sr-only" aria-label="上传关联表 CSV" onChange={e => { void pickTable(e.target.files?.[0]); e.target.value = '' }} />
        {table ? <>
          <p className="console-table-state"><strong>{table.rows.length} 行 × {table.headers.length} 列</strong> 已装载为 <code>extra</code></p>
          <details className="sql-schema"><summary>关联表字段映射</summary><div className="core-table-wrap"><table><thead><tr><th>列</th><th>原表头</th></tr></thead><tbody>{table.headers.map((_, i) => <tr key={i}><td>c{i}</td><td>{extraNames[i]}</td></tr>)}</tbody></table></div></details>
          <div className="console-table-actions">
            <button className="text-button" onClick={() => tableInput.current?.click()}>更换关联表</button>
            <button className="text-button danger-text" onClick={() => void removeTable()} disabled={tableBusy}><Trash2 size={14} />移除关联表</button>
          </div>
          <button className="text-button" onClick={() => setSql(joinExample(dataset, table))}>填入 JOIN 示例</button>
        </> : <button className="secondary" onClick={() => tableInput.current?.click()} disabled={tableBusy}>{tableBusy ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}{tableBusy ? '装载中…' : '上传关联表 CSV'}</button>}
        {tableBusy && table && <p className="core-muted">正在更新 Worker 中的关联表…</p>}
        {tableError && <p className="ai-error" role="alert"><AlertCircle size={16} />{tableError}</p>}
      </section>
      <div className="explore-output">
        <section className="panel core-panel">
          <label htmlFor="console-sql" className="console-label">查询语句</label>
          <textarea id="console-sql" className="sql-console-editor" value={sql} spellCheck={false} onChange={e => setSql(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void execute() } }} />
          <div className="core-actions console-actions"><button className="primary" onClick={() => void execute()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}运行查询</button><span className="core-muted">Ctrl / Cmd + Enter 运行 · 最多返回 500 行</span></div>
          {error && <p className="ai-error" role="alert"><AlertCircle size={16} />{error}</p>}
        </section>
        {result && <section className="panel core-panel">
          <div className="section-heading"><div><h3>查询结果</h3><p className="core-muted">{result.rows.length} 行 · {result.elapsedMs} ms · {result.columns.length} 列{result.truncated ? ' · 已截断，仅显示前 500 行' : ''}</p></div><div className="core-actions"><button className="secondary" aria-expanded={showChart} onClick={() => setShowChart(value => !value)} disabled={!result.rows.length}><BarChart3 size={15} />{showChart ? '收起图表' : '结果图表'}</button><button className="secondary" onClick={csv} disabled={!result.rows.length}><ArrowDownToLine size={15} />结果 CSV</button></div></div>
          {result.truncated && <p className="core-warning">结果超过 500 行，当前仅显示前 500 行；导出 CSV 也只包含这些行。请加 WHERE 或 LIMIT 缩小范围。</p>}
          {showChart && result.rows.length > 0 && <Suspense fallback={<p className="core-muted">正在加载图表引擎…</p>}><SqlResultChart columns={result.columns} rows={result.rows} /></Suspense>}
          {result.rows.length === 0 ? <p className="small-empty">查询执行成功，但没有返回行。</p> : <div className="core-table-wrap console-results"><table><thead><tr>{result.columns.map((column, i) => <th key={i}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value === null ? '∅' : String(value)}</td>)}</tr>)}</tbody></table></div>}
          <p className="core-muted">以上是本次 SQL 的直接结果。控制台不自动建立图表或来源绑定；需要回查记录时，请选择 <code>_record</code> 并对照片段来源。JOIN 结果的两侧行号需自行核对，控制台不替你判断连接是否合理。</p>
        </section>}
        {!result && !error && <section className="panel core-panel exploration-empty"><h3>从一条明确的查询开始</h3><p>先用 <code>SELECT * FROM readable LIMIT 20</code> 看清真实数据，或选择左侧示例。查询在浏览器 Worker 内执行，不上传数据到服务端。</p><span>当前未执行查询，不生成示意结果。</span></section>}
      </div>
    </div>
  </div>
}
