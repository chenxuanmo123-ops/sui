import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'

export type ExportItem = {
  /** Short format badge, e.g. PNG / XLSX. */
  format: string
  label: string
  hint: string
  run: () => void | Promise<void>
  disabled?: boolean
  disabledHint?: string
}

type Props = {
  title: string
  summary: string
  items: ExportItem[]
  label?: string
  /** `menu` opens on click; `panel` keeps every option and its hint visible. */
  variant?: 'menu' | 'panel'
  iconOnly?: boolean
  className?: string
  onError?: (message: string) => void
}

/** One place that names each export, its format and what the file contains. */
export function ExportMenu({ title, summary, items, label = '导出', variant = 'menu', iconOnly = false, className = '', onError }: Props) {
  const ref = useRef<HTMLDetailsElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<string | null>(null)
  // The menu is right-aligned to its trigger, which can sit near either edge in
  // a narrow card. Shift it back inside the viewport, and flip above the
  // trigger when it would otherwise run past the bottom.
  function place() {
    const element = pop.current, details = ref.current
    if (!element || !details?.open) return
    element.style.transform = 'none'
    const rect = element.getBoundingClientRect()
    const margin = 8
    let dx = 0, dy = 0
    if (rect.left < margin) dx = margin - rect.left
    else if (rect.right > innerWidth - margin) dx = innerWidth - margin - rect.right
    if (rect.bottom > innerHeight - margin) {
      const trigger = details.querySelector('summary')?.getBoundingClientRect()
      const above = trigger ? trigger.height + 12 + rect.height : 0
      dy = trigger && trigger.top - above >= margin ? -above : innerHeight - margin - rect.bottom
    }
    element.style.transform = dx || dy ? `translate(${Math.round(dx)}px, ${Math.round(dy)}px)` : ''
  }
  useEffect(() => {
    const details = ref.current
    if (variant !== 'menu' || !details) return
    const toggle = () => {
      if (details.open) requestAnimationFrame(place)
      else if (pop.current) pop.current.style.transform = ''
    }
    const resize = () => place()
    details.addEventListener('toggle', toggle)
    addEventListener('resize', resize)
    return () => { details.removeEventListener('toggle', toggle); removeEventListener('resize', resize) }
  }, [variant])
  useEffect(() => {
    if (variant !== 'menu') return
    const dismiss = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !ref.current?.open) return
      ref.current.open = false
      ref.current.querySelector('summary')?.focus()
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape, true)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape, true) }
  }, [variant])

  async function run(item: ExportItem) {
    if (item.disabled || pending) return
    setPending(item.label)
    try { await item.run() }
    catch (error) { onError?.(error instanceof Error ? error.message : String(error)) }
    finally {
      setPending(null)
      if (ref.current) ref.current.open = false
    }
  }

  const list = <ul className="export-list">{items.map(item => <li key={item.label}>
    <button type="button" aria-label={item.label} disabled={item.disabled || pending !== null} onClick={() => void run(item)} title={item.disabled ? item.disabledHint : item.hint}>
      <span className="export-format">{item.format}</span>
      <span className="export-copy"><strong>{item.label}</strong><small>{item.disabled ? item.disabledHint ?? item.hint : item.hint}</small></span>
      {pending === item.label ? <span className="export-pending">导出中…</span> : <ArrowDownToLine size={15} />}
    </button>
  </li>)}</ul>

  if (variant === 'panel') return <section className={'export-panel ' + className} aria-label={label + '「' + title + '」'}>
    <header><h3>{label}「{title}」</h3><p>{summary}</p></header>
    {list}
  </section>

  return <details ref={ref} className={'export-menu ' + className}>
    <summary aria-label={label + '「' + title + '」'} title={iconOnly ? label + '「' + title + '」' : undefined}>{iconOnly ? <ArrowDownToLine size={15} /> : <><ArrowDownToLine size={15} /><span>{label}</span></>}</summary>
    <div ref={pop} className="export-popover">
      <p className="export-head"><strong>导出「{title}」</strong><span>{summary}</span></p>
      {list}
    </div>
  </details>
}
