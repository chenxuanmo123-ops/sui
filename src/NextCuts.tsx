import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Compass, X } from 'lucide-react'
import DataChart from './DataChart'
import InsightBrief from './InsightBrief'
import { ResultTable } from './ResultTable'
import { aggregateNames, analyze, formatNumber } from './data'
import { buildCheckup } from './checkup'
import { buildNextCuts } from './next-cuts'
import type { NextCut } from './next-cuts'
import type { Analysis, Dataset } from './data'
import type { Checkup, CheckupOverrides } from './checkup'
import { useLabels } from './labels'

let temporaryId = 900000

/**
 * "What next" without a model: offer other groupings of the same measure and
 * recompute them locally. Nothing here reads AI output, and the original result
 * is never relabelled — the dialog is a separate SQLite computation.
 */
export default function NextCuts({ dataset, result, overrides = {} }: { dataset: Dataset; result: Analysis; overrides?: CheckupOverrides }) {
  const [checkup, setCheckup] = useState<Checkup | null>(null)
  const [cut, setCut] = useState<NextCut | null>(null)
  const labels = useLabels()
  const cuts = checkup ? buildNextCuts(result, checkup, undefined, labels.field) : []

  return <>
    <details className="next-cuts" onToggle={event => {
      if (!event.currentTarget.open || checkup) return
      try { setCheckup(buildCheckup(dataset, overrides)) } catch { setCheckup(null) }
    }}>
      <summary><Compass size={15} /><span>接着看：换一个维度</span><small>同一指标，本地重新计算</small></summary>
      {cuts.length ? <div className="next-cut-list">{cuts.map(item => <button key={item.id} onClick={() => setCut(item)}>
        <strong>{item.label}</strong><span>{item.why}</span><ArrowRight size={15} />
      </button>)}</div>
        : <p className="next-cut-empty">这份数据里没有其他可用的分组字段；可在「数据处理」检查字段类型，或手动选择字段分析。</p>}
    </details>
    {cut && <CutDialog dataset={dataset} result={result} cut={cut} onClose={() => setCut(null)} />}
  </>
}

function CutDialog({ dataset, result, cut, onClose }: { dataset: Dataset; result: Analysis; cut: NextCut; onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; analysis?: Analysis; error?: string }>({ loading: true })
  const [selected, setSelected] = useState('')
  const [kind, setKind] = useState<'line' | 'bar'>(cut.kind === 'time' ? 'line' : 'bar')
  const idRef = useRef(++temporaryId)

  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true })
    analyze(dataset, cut.mapping, '换维度对照：' + cut.label, idRef.current, result.scope, controller.signal)
      .then(analysis => setState({ loading: false, analysis }))
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setState({ loading: false, error: error instanceof Error ? error.message : '重算失败' })
      })
    return () => controller.abort()
  }, [dataset, cut, result.scope])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const labels = useLabels()
  const analysis = state.analysis
  const point = analysis?.points.find(item => item.label === selected)
  const rows = (point?.scopeRowIds ?? point?.rowIds ?? []).slice(0, 6)

  return createPortal(<div className="cut-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="cut-dialog" role="dialog" aria-modal="true" aria-label={'换维度对照：' + cut.label}>
      <header>
        <div><span className="cut-kicker">同口径 · 本地重新计算</span><h2>{cut.label}</h2><p>{cut.why}</p></div>
        <button className="icon-button" aria-label="关闭对照分析" onClick={onClose}><X size={18} /></button>
      </header>
      {state.loading && <div className="cut-body cut-loading"><span className="loading-indicator" />正在用本地 SQLite 重新计算…</div>}
      {state.error && <div className="cut-body"><p role="alert" className="cut-error">重算失败：{state.error}</p></div>}
      {analysis && <div className="cut-body">
        <p className="cut-scope">分组字段：{analysis.mapping.x}{analysis.mapping.timeBucket === 'month' ? '（按月）' : analysis.mapping.timeBucket === 'year' ? '（按年）' : ''} · 汇总：{aggregateNames[analysis.mapping.aggregate]} · 纳入 {formatNumber(analysis.usedRows, 0)} 条记录{analysis.scope ? ' · 沿用来源分组范围' : ''}</p>
        <InsightBrief result={analysis} compact />
        <div className="cut-chart-toolbar">
          <div className="segmented compact" aria-label="对照图表类型">
            <button aria-pressed={kind === 'line'} className={kind === 'line' ? 'active' : ''} onClick={() => setKind('line')}>折线</button>
            <button aria-pressed={kind === 'bar'} className={kind === 'bar' ? 'active' : ''} onClick={() => setKind('bar')}>柱状</button>
          </div>
          <span>点击图形或表格查看来源记录</span>
        </div>
        <DataChart points={analysis.points} metric={analysis.ai?.taskTitle || analysis.mapping.metric} unit={analysis.mapping.unit} kind={kind} selected={selected} onSelect={setSelected} interaction="select" facetField={analysis.mapping.x} />
        <ResultTable result={analysis} onSelect={setSelected} selected={selected} onEvidence={(_id, label) => setSelected(label ?? '')} />
        {point && <section className="cut-sources" aria-label="所选分组的来源记录">
          <h3>{labels.value(analysis.mapping.x, point.label)} · {formatNumber(point.value, 2)}{analysis.mapping.unit}</h3>
          <p>共 {(point.scopeRowIds ?? point.rowIds).length.toLocaleString()} 条匹配记录，预览前 {rows.length} 条。</p>
          <ul>{rows.map(id => {
            const row = dataset.rows[id - 2]
            return <li key={id}><span>{dataset.origin?.locations[id - 2] || `来源记录 #${dataset.sourceRecords?.[id - 2] ?? id}`}</span><strong>{row?.[analysis.mapping.x]} · {row?.[analysis.mapping.metric]} {analysis.mapping.unit}</strong></li>
          })}</ul>
        </section>}
        <details className="cut-sql"><summary>本次重算的 SQL 与参数</summary><pre>{analysis.sql}</pre><pre>{JSON.stringify(analysis.parameters)}</pre></details>
        <p className="cut-footnote">这是另一次真实计算，不会改写原结果或分析路径；数值全部来自当前数据快照。</p>
      </div>}
    </div>
  </div>, document.body)
}
