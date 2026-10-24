import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, ArrowUpRight, Clock3, Hash, ShieldCheck, Settings2, Sparkles, Table2 } from 'lucide-react'
import { formatNumber } from './data'
import type { Dataset } from './data'
import { buildCheckup } from './checkup'
import type { Checkup, CheckupQuestion } from './checkup'

type Profile = { key: string; kind: string; missing: number; nonempty: number }
type Props = {
  dataset: Dataset
  profiles: Profile[]
  onPrepare: () => void
  onExplore: () => void
  onData: () => void
  onField: (key: string) => void
  onRunQuestion: (question: CheckupQuestion) => void
  onRunExploreQuestion: (question: CheckupQuestion) => void
  onAsk: (question: string) => void
}

const KIND_LABELS: Record<CheckupQuestion['kind'], string> = {
  trend: '时间趋势',
  rate: '比例比较',
  rank: '分组排名',
  count: '分布计数',
  top: '前 20 名',
  correlation: '两列关系',
}

export default function AnalysisStart({ dataset, profiles, onPrepare, onExplore, onData, onField, onRunQuestion, onRunExploreQuestion, onAsk }: Props) {
  const headers = dataset.headers.slice(0, 6)
  const missing = profiles.reduce((total, profile) => total + profile.missing, 0)
  const [checkup, setCheckup] = useState<Checkup | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setCheckup(null); setError('')
    // Let the first paint show the imported file before a full quality pass.
    const timer = setTimeout(() => {
      try {
        const next = buildCheckup(dataset)
        if (!cancelled) setCheckup(next)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '无法完成数据体检')
      }
    }, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [dataset])

  const fields = checkup?.all ?? profiles.map(profile => ({ key: profile.key, roleLabel: profile.kind, missing: profile.missing }))
  const timeRange = checkup?.timeField?.time ? `${checkup.timeField.time.min}–${checkup.timeField.time.max}` : ''
  const questionCount = checkup?.questions.length ?? 0

  return <div className="data-review">
    <header className="review-intro">
      <div>
        <span className="task-status"><ShieldCheck size={15} />文件已读取{checkup ? ' · 本地体检完成' : ''}</span>
        <h1>{checkup ? '先看清数据，再问好问题。' : '正在读这份数据…'}</h1>
        <p>{checkup?.summary ?? '正在检查字段、缺失、时间范围与可计算的问题；原文件不会上传。'}</p>
      </div>
      <div className="review-intro-actions">
        <button className="secondary" onClick={onExplore}>直接创建图表<ArrowUpRight size={16} /></button>
        <button className="text-button" onClick={() => onAsk('请先帮我判断这份数据能回答什么问题，并指出需要补充的口径与限制。')}><Sparkles size={15} />让 AI 帮我判断<ArrowRight size={14} /></button>
      </div>
    </header>

    <div className="review-facts">
      <span><strong>{dataset.rows.length.toLocaleString()}</strong> 条原始记录</span>
      <span><strong>{dataset.headers.length}</strong> 个字段</span>
      <span className={missing ? 'has-issues' : ''}><strong>{missing.toLocaleString()}</strong> 个空值单元格</span>
      {checkup && <span><strong>{formatNumber(checkup.completeness * 100, 0)}%</strong> 单元格完整度</span>}
      {timeRange && <span><strong>{timeRange}</strong> 时间范围</span>}
      <button className="text-button" onClick={onPrepare}><Settings2 size={15} />{missing ? '检查并处理空值' : '检查数据质量'}<ArrowRight size={14} /></button>
    </div>

    {error && <p className="checkup-error" role="alert"><AlertCircle size={15} />数据体检未能完成：{error}。仍可手动选择字段分析。</p>}

    {checkup && <>
      <section className={'checkup-verdict tone-' + (checkup.questions.length ? 'ready' : 'limited')} aria-label="数据体检结论">
        <div className="checkup-score">
          <strong>{formatNumber(checkup.completeness * 100, 0)}<small>%</small></strong>
          <span>单元格完整度</span>
        </div>
        <div className="checkup-verdict-copy">
          <span className="checkup-kicker">数据体检 · 未调用模型</span>
          <h2>{questionCount ? `这份数据可以先从 ${questionCount} 个问题开始。` : '这份数据还需要先确认字段口径。'}</h2>
          <p>{questionCount
            ? '下面的问题都对应可执行的描述性计算：点一下就会生成真实 SQL、图表和来源记录。它们不代表已经知道业务原因。'
            : '没有找到稳定的时间字段、数值指标或可分组维度。可以先做字段清理，或者让 AI 帮你判断这份表适合问什么。'}</p>
        </div>
        <div className="checkup-role-counts">
          <span><strong>{checkup.measures.length}</strong> 数值指标</span>
          <span><strong>{checkup.categories.length}</strong> 分类维度</span>
          <span><strong>{checkup.binaries.length}</strong> 二值结果</span>
          <span><strong>{checkup.timeField ? 1 : 0}</strong> 时间字段</span>
        </div>
      </section>

      <section className="answerable-questions" aria-label="可直接执行的问题">
        <header>
          <div><span className="section-kicker">从这里开始</span><h2>这份数据现在能回答</h2><p>不用先懂字段配置。每个问题都会落到一条可核对的 SQL；你可以先看结果，再决定要不要追问。</p></div>
          <button className="text-button" onClick={() => onAsk('请根据这份数据体检结果，补充我可能没想到的分析角度，并说明哪些问题当前数据回答不了。')}><Sparkles size={15} />让 AI 再想几个<ArrowUpRight size={14} /></button>
        </header>
        <div className="question-grid">
          {checkup.questions.map((question, index) => <article className="question-card" key={question.id}>
            <div className="question-card-top">
              <span className="question-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="question-kind">{KIND_LABELS[question.kind]}</span>
            </div>
            <h3>{question.title}</h3>
            <p>{question.why}</p>
            <div className="question-card-actions">
              <button className="primary" onClick={() => question.execution.kind === 'aggregate' ? onRunQuestion(question) : onRunExploreQuestion(question)}>
                {question.execution.kind === 'aggregate' ? '直接算给我看' : '查看关系图'}<ArrowRight size={15} />
              </button>
              <button className="text-button" onClick={() => onAsk(question.question + ' 请说明需要核对的口径、证据边界和不能得出的结论。')}>让 AI 深入</button>
            </div>
          </article>)}
          {!checkup.questions.length && <div className="question-empty">
            <Hash size={22} strokeWidth={1.5} />
            <h3>还没有可以自动生成的问题</h3>
            <p>先检查字段类型与缺失，或让 AI 根据字段摘要提出方向。手动选择字段也始终可用。</p>
            <div><button className="secondary" onClick={onPrepare}>检查数据质量</button><button className="text-button" onClick={() => onAsk('这份数据没有自动生成可执行问题，请帮我判断原因并给出下一步。')}>让 AI 帮我找问题<ArrowRight size={14} /></button></div>
          </div>}
        </div>
      </section>

      <section className="checkup-warnings" aria-label="需要先确认的数据问题">
        <header><span className="section-kicker">体检提示</span><h2>先确认这些，不是“错误”</h2><p>系统只报告候选，不自动删改原始值。</p></header>
        <ul>{checkup.warnings.map((warning, index) => <li key={index} className={'tone-' + warning.tone}>
          <span className="warning-dot" aria-hidden="true" />
          <div><strong>{warning.title}</strong><p>{warning.detail}</p></div>
        </li>)}</ul>
      </section>
    </>}

    <section className="canvas-data-preview" aria-label="原始数据快速预览">
      <header><span><Table2 size={16} />原始记录</span><small>前 {Math.min(dataset.rows.length, 5)} 行 · 前 {headers.length} 列</small><button className="text-button" onClick={onData}>查看全部数据<ArrowUpRight size={14} /></button></header>
      <div className="canvas-preview-scroll"><table><thead><tr><th>记录号</th>{headers.map(header => <th key={header} title={header}>{header}</th>)}</tr></thead><tbody>{dataset.rows.slice(0, 5).map((row, index) => <tr key={index}><td>{dataset.sourceRecords?.[index] ?? index + 2}</td>{headers.map(header => <td key={header} title={String(row[header] ?? '')}>{String(row[header] ?? '—')}</td>)}</tr>)}</tbody></table></div>
    </section>

    <div className="review-fields">
      <p>字段速览 <span>角色是候选；点击核对含义和质量</span></p>
      <div>{fields.slice(0, 10).map(field => <button key={field.key} onClick={() => onField(field.key)} title={field.key + ' · ' + field.roleLabel + (field.missing ? ' · 空值 ' + field.missing : '')}>
        <span>{field.key}</span><small>{field.roleLabel}</small>{field.missing > 0 && <i />}
      </button>)}{fields.length > 10 && <button className="remaining-fields" onClick={() => onField('')}>其余 {fields.length - 10} 个字段<ArrowUpRight size={13} /></button>}</div>
      {checkup && <p className="review-fields-note"><Clock3 size={13} />时间字段按真实取值验证，不只凭列名；单位仍需要你确认。</p>}
    </div>
  </div>
}
