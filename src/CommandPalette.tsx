import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'

export type CommandAction = {
  id: string
  group: string
  label: string
  hint?: string
  shortcut?: string
  icon: ReactNode
  run: () => void
  disabled?: boolean
  disabledReason?: string
}

export default function CommandPalette({ open, onClose, actions }: {
  open: boolean
  onClose: () => void
  actions: CommandAction[]
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<Element | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter(action =>
      `${action.label} ${action.hint ?? ''} ${action.group}`.toLowerCase().includes(needle))
  }, [actions, query])

  useEffect(() => {
    if (!open) return
    returnFocus.current = document.activeElement
    setQuery('')
    setActive(0)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (open) return
    const previous = returnFocus.current as HTMLElement | null
    previous?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActive(index => Math.min(index + 1, Math.max(0, filtered.length - 1)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActive(index => Math.max(0, index - 1))
        return
      }
      if (event.key === 'Enter') {
        const action = filtered[active]
        if (!action) return
        event.preventDefault()
        if (action.disabled) return
        action.run()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, active, onClose])

  useEffect(() => { setActive(0) }, [query])

  if (!open) return null

  return <div className="command-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="command-panel" role="dialog" aria-modal="true" aria-label="命令面板">
      <div className="command-input-row">
        <Search size={16} />
        <input
          ref={inputRef}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索命令：导入、字段、体检、分支、导出…"
          aria-label="搜索命令"
          autoComplete="off"
        />
        <kbd>Esc</kbd>
      </div>
      <div className="command-list">
        {filtered.length === 0 && <p className="command-empty">没有匹配的命令。试试“导入”“字段”或“分支”。</p>}
        {filtered.map((action, index) => {
          const showGroup = index === 0 || filtered[index - 1].group !== action.group
          return <div key={action.id}>
            {showGroup && <div className="command-group">{action.group}</div>}
            <button
              className="command-item"
              data-active={index === active}
              disabled={action.disabled}
              onMouseEnter={() => setActive(index)}
              onClick={() => { if (!action.disabled) { action.run(); onClose() } }}
            >
              {action.icon}
              <span className="command-item-copy">
                <strong>{action.label}</strong>
                {(action.disabled ? action.disabledReason : action.hint) && <small>{action.disabled ? action.disabledReason : action.hint}</small>}
              </span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
            </button>
          </div>
        })}
      </div>
      <div className="command-foot"><span>↑↓ 选择 · Enter 执行 · Esc 关闭</span><span>仅执行当前可用操作</span></div>
    </div>
  </div>
}
