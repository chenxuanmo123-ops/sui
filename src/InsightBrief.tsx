import { Compass, TrendingDown, TrendingUp, Waves } from 'lucide-react'
import { buildInsight } from './insight'
import type { Analysis } from './data'

const TONE_ICON = { up: TrendingUp, down: TrendingDown, flat: Waves, mixed: Compass }

/**
 * Answer-first reading of a computed result. Every sentence below is derived
 * from the Analysis object; no model call and no invented business numbers.
 */
export default function InsightBrief({ result, compact = false }: { result: Analysis; compact?: boolean }) {
  const brief = buildInsight(result)
  const Icon = TONE_ICON[brief.tone]
  return <section className={'insight-brief tone-' + brief.tone + (compact ? ' is-compact' : '')} aria-label="结果解读">
    <header>
      <span className="insight-kicker"><Compass size={14} />结果解读 · 由本次计算结果生成</span>
      <div className="insight-headline"><Icon size={19} strokeWidth={1.8} aria-hidden="true" /><h3>{brief.headline}</h3></div>
    </header>
    <div className="insight-sections">
      {brief.sections.map(section => <article className={'insight-section is-' + section.key} key={section.key}>
        <h4>{section.title}</h4>
        <p>{section.body}</p>
      </article>)}
    </div>
    <p className="insight-footnote">这里的“意味着”是根据汇总结果列出的候选解释，不是已经证实的业务原因。</p>
  </section>
}
