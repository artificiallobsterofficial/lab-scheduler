import type { AppData, Cell, LabConfig, MonthDoc, ShiftCode } from '../domain/types'
import { cellKey } from '../domain/types'
import type { Problem } from '../domain/problem'

interface Props {
  data: AppData
  doc: MonthDoc
  lab: LabConfig
  problem: Problem
  techId: string
  date: string
  updateDoc: (fn: (m: MonthDoc) => MonthDoc) => void
  onClose: () => void
}

export function CellEditor({ data, doc, lab, problem, techId, date, updateDoc, onClose }: Props) {
  const tech = data.techs.find(t => t.id === techId)!
  const key = cellKey(techId, date)
  const cell: Cell = doc.cells[key] ?? { shift: 'OFF', roles: [], locked: false }
  const day = problem.days.find(d => d.date === date)!
  const isLabDay = problem.isLabDay[day.idx]
  const fixed = (doc.inputs.pto[techId] ?? []).includes(date) ? 'PTO' : (doc.inputs.unavailable[techId] ?? []).includes(date) ? 'UNAVAIL' : null
  const block = problem.blockOfDay[day.idx] >= 0 ? problem.blocks[problem.blockOfDay[day.idx]] : null

  const write = (patch: Partial<Cell>, alsoDates: string[] = []) => updateDoc(d => {
    const cells = { ...d.cells }
    for (const dt of [date, ...alsoDates]) {
      const k = cellKey(techId, dt)
      const prev = cells[k] ?? { shift: 'OFF', roles: [], locked: false }
      cells[k] = { ...prev, ...patch, locked: true }
    }
    return { ...d, cells }
  })

  const setShift = (s: ShiftCode) => write({ shift: s, roles: s === 'OFF' ? cell.roles.filter(r => lab.roles.find(x => x.id === r)?.kind === 'weekend') : cell.roles })
  const toggleRole = (rid: string) => {
    const role = lab.roles.find(r => r.id === rid)!
    const has = cell.roles.includes(rid)
    const roles = has ? cell.roles.filter(r => r !== rid) : [...cell.roles, rid]
    if (role.kind === 'weekend' && block) {
      // apply to every day of the block so the block stays whole
      const others = block.days.map(d => problem.days[d].date).filter(dt => dt !== date)
      updateDoc(d => {
        const cells = { ...d.cells }
        for (const dt of [date, ...others]) {
          const k = cellKey(techId, dt)
          const prev = cells[k] ?? { shift: 'OFF', roles: [], locked: false }
          cells[k] = { ...prev, roles: has ? prev.roles.filter(r => r !== rid) : Array.from(new Set([...prev.roles, rid])), locked: true }
        }
        return { ...d, cells }
      })
      return
    }
    write({ roles })
  }
  const unlock = () => updateDoc(d => ({ ...d, cells: { ...d.cells, [key]: { ...cell, locked: false } } }))

  const shownRoles = lab.roles.filter(r => r.enabled && (isLabDay ? r.kind === 'weekday' : r.kind === 'weekend'))

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{tech.name} · {date} ({day.weekday}{day.isHoliday ? ', holiday' : ''})</b>
        <button className="small" onClick={onClose}>close</button>
      </div>
      {fixed && <p className="note">This day is {fixed === 'PTO' ? 'PTO' : 'unavailable'} (set via paint mode). Erase it in paint mode to schedule the tech.</p>}
      {!fixed && isLabDay && (
        <div className="row" style={{ marginTop: 8 }}>
          {(['D', 'L', 'OFF'] as ShiftCode[]).map(s => (
            <label key={s}><input type="radio" name="shift" checked={cell.shift === s} onChange={() => setShift(s)} />{s === 'D' ? `D · ${lab.shiftLabels.D}` : s === 'L' ? `L · ${lab.shiftLabels.L}` : 'Off'}</label>
          ))}
        </div>
      )}
      {!fixed && !isLabDay && <p className="note">Lab closed this day. Only call roles apply{block ? ` (block: ${block.days.map(d => problem.days[d].dom).join('–')})` : ''}.</p>}
      {shownRoles.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          {shownRoles.map(r => (
            <label key={r.id} title={tech.eligible[r.id] ? '' : 'Not eligible — will flag a hard violation'}>
              <input type="checkbox" checked={cell.roles.includes(r.id)} disabled={!!fixed} onChange={() => toggleRole(r.id)} />
              {r.label}{!tech.eligible[r.id] && <span className="muted"> (not eligible)</span>}
            </label>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        {cell.locked ? <><span className="pill">locked</span><button className="small" onClick={unlock}>Unlock (let the solver change it)</button></> : <span className="note">Editing locks this cell.</span>}
      </div>
    </div>
  )
}
