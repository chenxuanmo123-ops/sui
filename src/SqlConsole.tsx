import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowDownToLine, ArrowUpRight, BarChart3, Database, Link2, LoaderCircle, Play, Plus, Search, ShieldCheck, Trash2, Upload } from 'lucide-react'
import type { Dataset } from './data'
import { decodeTextBytes, download, parseCSV } from './data'
import { clearConsoleTable, loadConsoleTable, queryDataset } from './engine'
import type { ConsoleResult, ExtraTable } from './sql-console'
import { exportColumnNames } from './sql-names'
import ChartBoundary from './ChartBoundary'

const SqlResultChart = lazy(() => import('./SqlResultChart'))

const EXAMPLE = 'SELECT "c0" AS 分组, COUNT(*) AS 记录数\nFROM data\nGROUP BY "c0"\nORDER BY 记录数 DESC\nLIMIT 20'
const numericExample = (dataset: Dataset) => 'SELECT "c0" AS 分组, strict_number("c' + (dataset.headers.length > 1 ? 1 : 0) + '") AS 数值\nFROM data\nWHERE strict_number("c' + (dataset.headers.length > 1 ? 1 : 0) + '") IS NOT NULL\nORDER BY 数值 DESC\nLIMIT 20'
const PREVIEW = 'SELECT * FROM readable LIMIT 20'
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

type Props = {
  dataset: Dataset
  table: ExtraTable | null
  onTable: (table: ExtraTable | null) => void
  onImport?: () => void
  onPublic?: () => void
}

export default function SqlConsole({ dataset, table, onTable, onImport, onPublic }: Props) {
  const names = useMemo(() => exportColumnNames(dataset, '_record'), [dataset])
  const extraNames = useMemo(() => table ? exportColumnNames(table, '_row') : [], [table])
  const [sql, setSql] = useState(PREVIEW)
  const [result, setResult] = useState<ConsoleResult | null>(null)
  const [showChart, setShowChart] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tableBusy, setTableBusy] = useState(false)
  const [tableError, setTableError] = useState('')
  const [scope, setScope] = useState<'readable' | 'data'>('readable')
  const [fieldFilter, setFieldFilter] = useState('')
  const running = useRef<AbortController | null>(null)
  const tableInput = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
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

  const fields = useMemo(() => dataset.headers
    .map((header, index) => ({ key: 'c' + index, name: names[index], header }))
    .filter(field => {
      const query = fieldFilter.trim().toLowerCase()
      return !query || field.key.toLowerCase().includes(query) || field.header.toLowerCase().includes(query) || field.name.toLowerCase().includes(query)
    }), [dataset, names, fieldFilter])

  const lineCount = Math.max(sql.split('\n').length, 8)
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1), [lineCount])

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
      const parsed = parseCSV(decodeTextBytes(new Uint8Array(await file.arrayBuffer())).text)
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

  // Clicking a dictionary entry writes a quoted identifier at the caret instead
  // of replacing the whole statement, so a query can be composed field by field.
  function insertField(field: { key: string; header: string }) {
    const identifier = '"' + (scope === 'readable' ? field.header.replaceAll('"', '""') : field.key) + '"'
    const node = editor.current
    if (!node) { setSql(value => value + ' ' + identifier); return }
    const start = node.selectionStart ?? sql.length
    const end = node.selectionEnd ?? sql.length
    const before = sql.slice(0, start)
    const after = sql.slice(end)
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    const trail = after && !/^\s/.test(after) ? ' ' : ''
    const next = before + lead + identifier + trail + after
    setSql(next)
    const caret = (before + lead + identifier).length
    requestAnimationFrame(() => { node.focus(); node.setSelectionRange(caret, caret) })
  }

  function csv() {
    if (!result) return
    const quote = (v: string | number | null) => '"' + String(v ?? '').replaceAll('"', '""') + '"'
    download('﻿' + [result.columns.map(quote).join(','), ...result.rows.map(row => row.map(quote).join(','))].join('\r\n'), 'text/csv;charset=utf-8', '数鉴-SQL查询结果.csv')
  }

  const templates = [
    { label: '原表预览', detail: '前 20 行', sql: PREVIEW },
    { label: '分组计数', detail: 'COUNT(*)', sql: EXAMPLE },
    { label: '严格数值', detail: 'strict_number', sql: numericExample(dataset) },
    ...(table ? [{ label: '关联表 JOIN', detail: 'extra', sql: joinExample(dataset, table) }] : []),
  ]

  return <div className="core-workspace sql-studio">
    <header className="sql-head">
      <span className="sql-head-grid" aria-hidden="true" />
      <div className="sql-head-copy">
        <span className="sql-kicker"><i />QUERY DECK · LOCAL SQLITE</span>
        <h2>SQL 查询</h2>
        <p>直接查询当前数据快照。语句、参数和每一行结果都能回到来源，不经过 AI。</p>
        <div className="sql-head-facts">
          <span><strong>{dataset.rows.length.toLocaleString()}</strong>行</span>
          <span><strong>{dataset.headers.length}</strong>列</span>
          <span><strong>{table ? 4 : 3}</strong>个可用模板</span>
          <span className="sql-badge"><ShieldCheck size={13} />只读事务</span>
        </div>
      </div>
      <div className="sql-head-actions">
        {onImport && <button className="secondary" onClick={onImport}><Upload size={15} />更换文件</button>}
        {onPublic && <button className="text-button" onClick={onPublic}>公开数据<ArrowUpRight size={14} /></button>}
      </div>
      <div className="sql-head-orbit" aria-hidden="true"><span /><span /><span /></div>
    </header>

    <div className="sql-layout">
      <aside className="sql-dictionary" aria-label="数据字典">
        <div className="sql-dictionary-head">
          <div><span className="sql-overline">SCHEMA</span><h3>数据字典</h3></div>
          <span className="sql-count">{dataset.headers.length}</span>
        </div>

        <div className="sql-scope-switch" role="group" aria-label="对象视图">
          <button aria-pressed={scope === 'readable'} className={scope === 'readable' ? 'is-on' : ''} onClick={() => setScope('readable')}>readable<small>原表头</small></button>
          <button aria-pressed={scope === 'data'} className={scope === 'data' ? 'is-on' : ''} onClick={() => setScope('data')}>data<small>c0…cN</small></button>
        </div>

        <label className="sql-search">
          <Search size={14} />
          <input value={fieldFilter} onChange={e => setFieldFilter(e.target.value)} placeholder="搜索字段名或 cN" aria-label="搜索字段" />
          {fieldFilter && <button type="button" onClick={() => setFieldFilter('')} aria-label="清空字段搜索">×</button>}
        </label>

        <ul className="sql-field-list">
          {fields.map(field => <li key={field.key}>
            <button onClick={() => insertField(field)} title={'插入 ' + (scope === 'readable' ? '"' + field.header + '"' : '"' + field.key + '"')}>
              <span className="sql-field-key">{field.key}</span>
              <span className="sql-field-name">{scope === 'readable' ? field.header : field.name}</span>
              <Plus size={13} />
            </button>
          </li>)}
          {!fields.length && <li className="sql-field-none">没有匹配的字段。</li>}
        </ul>

        <p className="sql-dictionary-note">点击字段插入到光标处。<code>readable</code> 保留 <code>_record</code> 来源记录号；<code>data</code> 固定使用列号。</p>

        <details className="sql-reference">
          <summary>函数与口径</summary>
          <dl>
            <div><dt><code>strict_number(col)</code></dt><dd>严格解析数值，空值不会当作 0。</dd></div>
            <div><dt><code>compare_labels(a,b)</code></dt><dd>按数字 / 日期 / 文本顺序比较。</dd></div>
            <div><dt><code>time_bucket(col,'month'|'year')</code></dt><dd>把时间列分桶。</dd></div>
          </dl>
        </details>

        <section className="sql-join-card" aria-label="关联表">
          <div className="sql-join-head">
            <span><Link2 size={14} />关联表<small>可选</small></span>
            <span className={'sql-join-state' + (table ? ' is-loaded' : '')}>{table ? '已装载' : '未装载'}</span>
          </div>
          <input ref={tableInput} type="file" accept=".csv,text/csv" className="sr-only" aria-label="上传关联表 CSV" onChange={e => { void pickTable(e.target.files?.[0]); e.target.value = '' }} />
          {table ? <>
            <p><strong>{table.rows.length.toLocaleString()} 行 × {table.headers.length} 列</strong> 作为 <code>extra</code>，<code>_row</code> 为行号。仅在当前会话有效。</p>
            <details className="sql-reference"><summary>关联表字段映射</summary><div className="sql-schema-wrap"><table><thead><tr><th>列</th><th>原表头</th></tr></thead><tbody>{table.headers.map((_, i) => <tr key={i}><td>c{i}</td><td>{extraNames[i]}</td></tr>)}</tbody></table></div></details>
            <div className="sql-join-actions">
              <button className="text-button" onClick={() => tableInput.current?.click()} disabled={tableBusy}>更换</button>
              <button className="text-button danger-text" onClick={() => void removeTable()} disabled={tableBusy}><Trash2 size={13} />移除</button>
            </div>
          </> : <>
            <p>上传第二个 CSV 后可与主表 JOIN。不写入快照，也不自动进入分析或证据链。</p>
            <button className="secondary sql-join-upload" onClick={() => tableInput.current?.click()} disabled={tableBusy}>{tableBusy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}{tableBusy ? '装载中…' : '上传关联表 CSV'}</button>
          </>}
          {tableBusy && table && <p className="sql-muted">正在更新 Worker 中的关联表…</p>}
          {tableError && <p className="ai-error" role="alert"><AlertCircle size={15} />{tableError}</p>}
        </section>
      </aside>

      <div className="sql-stage">
        <section className="sql-editor" aria-label="查询编辑器">
          <div className="sql-editor-chrome">
            <span className="sql-dot" aria-hidden="true" />
            <span className="sql-file">query.sql</span>
            <span className="sql-editor-mode">READ ONLY</span>
            <span className="sql-editor-engine"><Database size={12} />sql.js worker</span>
          </div>
          <label htmlFor="console-sql" className="sr-only">查询语句</label>
          <div className="sql-editor-wrap">
            <pre className="sql-gutter" aria-hidden="true">{lineNumbers.join('\n')}</pre>
            <textarea
              ref={editor}
              id="console-sql"
              className="sql-console-editor"
              value={sql}
              spellCheck={false}
              aria-label="查询语句"
              onChange={e => setSql(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void execute() } }}
            />
          </div>
          <div className="sql-commandbar">
            <button className="primary" onClick={() => void execute()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}{busy ? '正在执行…' : '运行查询'}</button>
            <span className="sql-shortcut"><kbd>Ctrl</kbd><kbd>Enter</kbd>运行 · 最多 500 行</span>
            <div className="sql-template-row" role="group" aria-label="查询模板">
              {templates.map(template => <button key={template.label} onClick={() => setSql(template.sql)} title={template.sql}>
                <strong>{template.label}</strong><small>{template.detail}</small>
              </button>)}
            </div>
          </div>
        </section>

        {error && <p className="ai-error sql-error" role="alert"><AlertCircle size={16} />{error}</p>}

        {result ? <section className="sql-result" aria-live="polite">
          <div className="sql-result-head">
            <div>
              <span className="sql-overline">RESULT SET</span>
              <h3>查询结果</h3>
              <p>{result.rows.length} 行 · {result.elapsedMs} ms · {result.columns.length} 列{result.truncated ? ' · 已截断，仅显示前 500 行' : ''}</p>
            </div>
            <div className="sql-result-actions">
              <button className="secondary" aria-expanded={showChart} onClick={() => setShowChart(value => !value)} disabled={!result.rows.length}><BarChart3 size={15} />{showChart ? '收起图表' : '结果图表'}</button>
              <button className="secondary" onClick={csv} disabled={!result.rows.length}><ArrowDownToLine size={15} />结果 CSV</button>
            </div>
          </div>
          {result.truncated && <p className="sql-warning">结果超过 500 行，当前仅显示前 500 行；导出 CSV 也只包含这些行。请加 WHERE 或 LIMIT 缩小范围。</p>}
          {showChart && result.rows.length > 0 && <ChartBoundary><Suspense fallback={<p className="sql-muted">正在加载图表引擎…</p>}><SqlResultChart columns={result.columns} rows={result.rows} /></Suspense></ChartBoundary>}
          {result.rows.length === 0
            ? <div className="sql-no-rows"><span>0 行</span><p>查询执行成功，但没有返回行。条件可能过窄，或该字段没有匹配值。</p></div>
            : <div className="sql-table-wrap console-results"><table><thead><tr>{result.columns.map((column, i) => <th key={i}>{column}</th>)}</tr></thead><tbody>{result.rows.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j}>{value === null ? '∅' : String(value)}</td>)}</tr>)}</tbody></table></div>}
          <p className="sql-muted">以上是本次 SQL 的直接结果。控制台不自动建立图表或来源绑定；回查记录请选择 <code>_record</code>。JOIN 两侧行号需自行核对。</p>
        </section> : !error && <section className="sql-idle" aria-label="等待执行查询">
          <div className="sql-idle-copy">
            <span className="sql-overline">STANDBY</span>
            <h3>从一条明确的查询开始</h3>
            <p>编辑区默认加载 <code>SELECT * FROM readable LIMIT 20</code>。运行后，这里会显示真实行数、耗时与原始结果。</p>
            <ol>
              <li><span>01</span><div><strong>选对象</strong><small>readable 用原表头，data 用 c0…cN</small></div></li>
              <li><span>02</span><div><strong>写条件</strong><small>只允许单条 SELECT 或 WITH</small></div></li>
              <li><span>03</span><div><strong>核对</strong><small>结果、耗时和来源记录号一起保留</small></div></li>
            </ol>
          </div>
          <div className="sql-idle-art" aria-hidden="true">
            <span className="sql-idle-ring" /><span className="sql-idle-ring ring-b" /><span className="sql-idle-ring ring-c" />
            <span className="sql-idle-scan" />
            <span className="sql-idle-core"><Play size={30} /></span>
            <span className="sql-idle-label">READY</span>
          </div>
        </section>}
      </div>
    </div>
  </div>
}
