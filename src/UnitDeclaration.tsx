import { useEffect, useState } from 'react'
import { Ruler } from 'lucide-react'

/** Unit is metadata supplied by the user. It never feeds back into SQL or the
 * calculated values; saving it only updates labels, descriptions and exports.
 * A unit already present in a confirmed plan is shown as such, not as a user
 * declaration, until the user explicitly records it here. */
export function UnitDeclaration({ id, unit, source, onSave }: { id: number; unit: string; source?: 'user'; onSave: (unit: string) => void }) {
  const [draft, setDraft] = useState(unit)
  useEffect(() => setDraft(unit), [unit])
  const inputId = 'declared-unit-' + id
  const declared = source === 'user' && Boolean(unit)
  return <form className="unit-declaration" onSubmit={event => { event.preventDefault(); onSave(draft) }}>
    <div className="unit-declaration-heading">
      <Ruler size={15} />
      <label htmlFor={inputId}>指标单位</label>
      <span className={declared ? 'is-set' : ''}>{declared ? '已声明 ' + unit : unit ? '口径单位 ' + unit : '未声明'}</span>
    </div>
    <div className="unit-declaration-entry">
      <input id={inputId} value={draft} onChange={event => setDraft(event.target.value)} placeholder="未声明，例如 TWh、次、%" maxLength={40} autoComplete="off" />
      <button className="secondary" type="submit">{source === 'user' ? '更新单位' : unit ? '确认并记录' : '记录单位'}</button>
    </div>
    <p>{source === 'user'
      ? '由你声明，不是系统推断；只改变本次结果的图表、结论与导出标注，不改变已算出的数值。留空保存表示撤回声明。'
      : unit
        ? '当前单位来自已确认的分析口径，尚未记为你的声明；确认后报告与导出会注明由你声明。单位不参与计算。'
        : '由你声明，不是系统推断；只改变本次结果的图表、结论与导出标注，不改变已算出的数值。留空保存表示撤回声明。'}</p>
  </form>
}
