import { useMemo } from 'react'
import type { AppData, MonthDoc } from '../domain/types'
import { cellKey } from '../domain/types'
import { monthDays } from '../domain/calendar'
import { techsOfLab } from '../domain/problem'

export type PaintMode = 'select' | 'PTO' | 'UNAVAIL' | 'OFF' | 'ON' | 'erase'

interface Props {
  data: AppData
  doc: MonthDoc
  derived: Record<string, string>
  hardKeys: Set<string>
  selected: { techId: string; date: string } | null
  paint: PaintMode
  onCellClick: (techId: string, date: string) => void
}

export function ScheduleGrid({ data, doc, derived, hardKeys, selected, paint, onCellClick }: Props) {
  const days = useMemo(() => monthDays(doc.month, data.holidays), [doc.month, data.holidays])
  const inputAt = useMemo(() => {
    const m: Record<string, { fixed?: 'PTO' | 'UNAVAIL'; req?: 'OFF' | 'ON' }> = {}
    for (const [tid, dates] of Object.entries(doc.inputs.pto)) for (const d of dates) (m[cellKey(tid, d)] ??= {}).fixed = 'PTO'
    for (const [tid, dates] of Object.entries(doc.inputs.unavailable)) for (const d of dates) (m[cellKey(tid, d)] ??= {}).fixed = 'UNAVAIL'
    for (const [tid, reqs] of Object.entries(doc.inputs.requests)) for (const [d, k] of Object.entries(reqs)) (m[cellKey(tid, d)] ??= {}).req = k
    return m
  }, [doc.inputs])

  return (
    <div className="gridwrap">
      <table className="sched">
        <thead>
          <tr>
            <th className="tech">Tech</th>
            {days.map(d => <th key={d.date} className={d.isHoliday ? 'holiday' : d.isWeekend ? 'weekend' : ''}>{d.dom}<span className="dow">{d.weekday.slice(0, 2)}{d.isHoliday ? ' H' : ''}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {data.labs.map(lab => {
            const techs = techsOfLab(data, lab.id)
            const roleCode = new Map(lab.roles.map(r => [r.id, r.code]))
            const open = new Set(lab.workdays)
            return [
              <tr key={lab.id + '_h'} className="labhead"><td colSpan={days.length + 1}>{lab.name} <span className="muted">· {lab.daysPerWeek}-day · {techs.length} techs</span></td></tr>,
              ...techs.map(t => (
                <tr key={t.id}>
                  <td className="tech" title={t.name}>{t.name} <span className="muted">{t.employment === 'PT' ? `PT${t.daysPerWeek}` : ''}</span></td>
                  {days.map(d => {
                    const key = cellKey(t.id, d.date)
                    const c = doc.cells[key]
                    const inp = inputAt[key]
                    const closed = !open.has(d.weekday) || d.isHoliday
                    const shift = inp?.fixed ?? c?.shift ?? 'OFF'
                    const cls = ['cell', `s-${shift}`, closed && shift === 'OFF' ? 'closed' : '', c?.locked ? 'locked' : '', hardKeys.has(key) ? 'hardbad' : '',
                      selected?.techId === t.id && selected.date === d.date ? 'selected' : '', paint !== 'select' ? 'paint' : ''].filter(Boolean).join(' ')
                    const code = shift === 'OFF' ? '' : shift === 'UNAVAIL' ? 'X' : shift
                    return (
                      <td key={key} className={cls} onClick={() => onCellClick(t.id, d.date)} title={`${t.name} · ${d.date}`}>
                        {code && <span className="code">{code}</span>}
                        {c?.roles.map(r => <span key={r} className="role">{roleCode.get(r) ?? r}</span>)}
                        {derived[key] && <span className="derived">{derived[key]}</span>}
                        {inp?.req && <span className="req">{inp.req === 'OFF' ? '○' : '●'}</span>}
                      </td>
                    )
                  })}
                </tr>
              )),
            ]
          })}
        </tbody>
      </table>
      <div className="legend">
        <span><i style={{ background: 'var(--cell-day)' }} />D day</span>
        <span><i style={{ background: 'var(--cell-late)' }} />L late</span>
        <span><i style={{ background: 'var(--cell-off)' }} />off</span>
        <span><i style={{ background: 'var(--cell-pto)' }} />PTO</span>
        <span><i style={{ background: 'var(--cell-unavail)' }} />X unavailable</span>
        <span>○ asked off · ● asked on · dot = locked · red border = rule broken</span>
        {data.labs.map(l => l.roles.filter(r => r.enabled).map(r => <span key={l.id + r.id}><b>{r.code}</b> {r.label}{data.labs.length > 1 ? ` (${l.name})` : ''}</span>))}
        {data.labs.filter(l => l.fridayRoleBecomesWeekendCall.enabled).map(l => <span key={l.id + 'd'}><b>{l.fridayRoleBecomesWeekendCall.code}</b> {l.fridayRoleBecomesWeekendCall.label} (from Friday {l.roles.find(r => r.id === l.fridayRoleBecomesWeekendCall.roleId)?.code})</span>)}
      </div>
    </div>
  )
}
