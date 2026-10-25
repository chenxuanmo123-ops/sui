import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RotateCcw, Search, X } from 'lucide-react'
import { roleOptions } from './checkup'
import type { CheckupField, CheckupOverrides, CheckupRole } from './checkup'
import type { Dataset } from './data'

/**
 * Local correction of detected field roles.
 *
 * A role can only be changed to one the imported values actually support; an
 * unsupported option stays visible but disabled with the reason. The correction
 * never edits cell values and never rewrites an existing result.
 */
export default function FieldRoles({ dataset, fields, overrides, onChange, onClose }: {
  dataset: Dataset
  fields: CheckupField[]
  overrides: CheckupOverrides
  onChange: (next: CheckupOverrides) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const options = useMemo(() => new Map(fields.map(field => [field.key, roleOptions(dataset, field)])), [dataset, fields])
  const corrected = fields.filter(field => field.overridden)
  const visible = query.trim()
    ? fields.filter(field => field.key.toLowerCase().includes(query.trim().toLowerCase()))
    : fields

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  function change(field: CheckupField, role: CheckupRole | '') {
    const next = { ...overrides }
    if (!role) delete next[field.key]
    else next[field.key] = role
    onChange(next)
  }

  return createPortal(<div className="cut-dialog-backdrop">
    <div className="cut-dialog field-roles" role="dialog" aria-modal="true" aria-label="纠正字段角色" ref={dialogRef}>
      <header>
        <div>
          <span className="cut-kicker">字段角色 · 本地纠正 · 未调用模型</span>
          <h2>字段类型不对？在这里改。</h2>
          <p>体检按真实取值判断角色。纠正只改变“这个字段怎么被理解和使用”，不会修改原始值，也不会改写已经算出的结果；纠正后请重新计算要用的分析。无法支撑所选角色的选项会保持禁用并说明原因。</p>
        </div>
        <button className="text-button" onClick={onClose} aria-label="关闭字段角色纠正"><X size={16} /></button>
      </header>
      <div className="cut-body">
        <div className="field-role-tools">
          <label><Search size={14} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索字段名" aria-label="搜索字段" autoFocus /></label>
          <span>{corrected.length ? `已纠正 ${corrected.length} 个字段` : '当前全部使用自动判断'}</span>
          {corrected.length > 0 && <button className="text-button" onClick={() => onChange({})}><RotateCcw size={14} />全部恢复自动</button>}
        </div>
        <div className="field-role-list">
          {visible.map(field => {
            const choices = options.get(field.key) ?? []
            const selected = overrides[field.key] ?? ''
            const current = choices.find(option => option.role === (selected || field.role))
            return <div className={'field-role-row' + (field.overridden ? ' corrected' : '')} key={field.key}>
              <div className="field-role-name">
                <strong title={field.key}>{field.key}</strong>
                <small>{field.overridden ? `已纠正 · 自动判断：${field.autoRoleLabel}` : field.roleLabel}</small>
                <span className="field-role-detail">{field.detail}</span>
              </div>
              <div className="field-role-choose">
                <select aria-label={`字段 ${field.key} 的角色`} value={selected} onChange={event => change(field, event.target.value as CheckupRole | '')}>
                  <option value="">自动判断（{field.autoRoleLabel ?? field.roleLabel}）</option>
                  {choices.map(option => <option key={option.role} value={option.role} disabled={!option.enabled} title={option.reason}>
                    {option.label}{option.enabled ? '' : '（不支持）'}
                  </option>)}
                </select>
                <span className={'field-role-reason' + (current?.enabled === false ? ' blocked' : '')}>{current?.reason ?? field.detail}</span>
              </div>
            </div>
          })}
          {!visible.length && <p className="field-role-empty">没有匹配“{query.trim()}”的字段。</p>}
        </div>
        <p className="cut-footnote">纠正保存在当前设备的工作区，刷新后仍会保留；它不改变数据类型本身，也不保证字段的业务含义——单位、口径和范围仍需要你确认。</p>
      </div>
    </div>
  </div>, document.body)
}
