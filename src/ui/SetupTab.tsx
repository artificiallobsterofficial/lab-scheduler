import { useState } from 'react'
import type { AppData, LabConfig, RoleConfig, Tech, Weekday, Weights } from '../domain/types'
import { DEFAULT_WEIGHTS, WEEKDAYS, WEIGHT_LABELS } from '../domain/types'
import { fourDayLab, initialsOf, makeTech, newId } from '../seed'
import type { SetData } from './App'

export function SetupTab({ data, setData }: { data: AppData; setData: SetData }) {
  const [labId, setLabId] = useState(data.labs[0]?.id ?? '')
  const lab = data.labs.find(l => l.id === labId) ?? data.labs[0]
  const updateLab = (fn: (l: LabConfig) => LabConfig) => setData(d => ({ ...d, labs: d.labs.map(l => l.id === lab.id ? fn(l) : l) }))

  const addLab = () => {
    const id = newId('lab')
    setData(d => ({ ...d, labs: [...d.labs, fourDayLab(id, 'New Lab')] }))
    setLabId(id)
  }
  const removeLab = () => {
    if (!lab || data.labs.length <= 1) return
    if (!confirm(`Delete ${lab.name} and its ${data.techs.filter(t => t.labId === lab.id).length} techs?`)) return
    setData(d => ({ ...d, labs: d.labs.filter(l => l.id !== lab.id), techs: d.techs.filter(t => t.labId !== lab.id) }))
    setLabId(data.labs.find(l => l.id !== lab.id)!.id)
  }

  if (!lab) return <div className="panel">No labs. <button onClick={addLab}>Add a lab</button></div>

  return (
    <div>
      <div className="panel">
        <div className="row">
          <label>Lab
            <select value={lab.id} onChange={e => setLabId(e.target.value)}>
              {data.labs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <button onClick={addLab}>+ Add lab</button>
          <button className="danger" onClick={removeLab} disabled={data.labs.length <= 1}>Delete lab</button>
        </div>
      </div>

      <LabEditor lab={lab} updateLab={updateLab} />
      <TechTable data={data} setData={setData} lab={lab} />
      <Holidays data={data} setData={setData} />
      <WeightsEditor lab={lab} updateLab={updateLab} />
    </div>
  )
}

function LabEditor({ lab, updateLab }: { lab: LabConfig; updateLab: (fn: (l: LabConfig) => LabConfig) => void }) {
  const toggleWorkday = (wd: Weekday) => updateLab(l => ({
    ...l, workdays: l.workdays.includes(wd) ? l.workdays.filter(x => x !== wd) : WEEKDAYS.filter(x => x === wd || l.workdays.includes(x)),
  }))
  const setRole = (id: string, patch: Partial<RoleConfig>) => updateLab(l => ({ ...l, roles: l.roles.map(r => r.id === id ? { ...r, ...patch } : r) }))
  const addRole = () => updateLab(l => ({ ...l, roles: [...l.roles, { id: newId('role'), label: 'New role', code: 'R', kind: 'weekday', perDay: 1, enabled: true }] }))
  const removeRole = (id: string) => updateLab(l => ({ ...l, roles: l.roles.filter(r => r.id !== id) }))

  return (
    <div className="panel">
      <h2>Lab rules</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <label>Name <input value={lab.name} onChange={e => updateLab(l => ({ ...l, name: e.target.value }))} /></label>
        <label>Full-time days / week <input type="number" min={1} max={7} value={lab.daysPerWeek} onChange={e => updateLab(l => ({ ...l, daysPerWeek: +e.target.value }))} /></label>
        <label>Day shift label <input value={lab.shiftLabels.D} onChange={e => updateLab(l => ({ ...l, shiftLabels: { ...l.shiftLabels, D: e.target.value } }))} /></label>
        <label>Late shift label <input value={lab.shiftLabels.L} onChange={e => updateLab(l => ({ ...l, shiftLabels: { ...l.shiftLabels, L: e.target.value } }))} /></label>
      </div>

      <h3>Open days, minimum coverage, late-shift seats</h3>
      <table className="list">
        <thead><tr><th></th>{WEEKDAYS.map(wd => <th key={wd}>{wd}</th>)}</tr></thead>
        <tbody>
          <tr><td>Lab open</td>{WEEKDAYS.map(wd => <td key={wd}><input type="checkbox" checked={lab.workdays.includes(wd)} onChange={() => toggleWorkday(wd)} /></td>)}</tr>
          <tr><td>Min techs in lab</td>{WEEKDAYS.map(wd => <td key={wd}>{lab.workdays.includes(wd) && <input type="number" min={0} value={lab.coverageMin[wd] ?? 0} onChange={e => updateLab(l => ({ ...l, coverageMin: { ...l.coverageMin, [wd]: +e.target.value } }))} />}</td>)}</tr>
          <tr><td>Late-shift seats</td>{WEEKDAYS.map(wd => <td key={wd}>{lab.workdays.includes(wd) && <input type="number" min={0} value={lab.lateSlots[wd] ?? 0} onChange={e => updateLab(l => ({ ...l, lateSlots: { ...l.lateSlots, [wd]: +e.target.value } }))} />}</td>)}</tr>
        </tbody>
      </table>

      <h3>On-call roles</h3>
      <table className="list">
        <thead><tr><th>On</th><th>Label</th><th>Code</th><th>Kind</th><th>Slots</th><th></th></tr></thead>
        <tbody>
          {lab.roles.map(r => (
            <tr key={r.id}>
              <td><input type="checkbox" checked={r.enabled} onChange={e => setRole(r.id, { enabled: e.target.checked })} /></td>
              <td><input value={r.label} onChange={e => setRole(r.id, { label: e.target.value })} /></td>
              <td><input style={{ width: 60 }} value={r.code} onChange={e => setRole(r.id, { code: e.target.value })} /></td>
              <td>
                <select value={r.kind} onChange={e => setRole(r.id, { kind: e.target.value as RoleConfig['kind'] })}>
                  <option value="weekday">Weekday (must be in lab)</option>
                  <option value="weekend">Weekend / holiday block</option>
                </select>
              </td>
              <td><input type="number" min={1} value={r.perDay} onChange={e => setRole(r.id, { perDay: Math.max(1, +e.target.value) })} /></td>
              <td><button className="small danger" onClick={() => removeRole(r.id)}>remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small" onClick={addRole} style={{ marginTop: 6 }}>+ Add role</button>

      <h3>Special rules</h3>
      <div className="row">
        <label><input type="checkbox" checked={lab.fridayRoleBecomesWeekendCall.enabled} onChange={e => updateLab(l => ({ ...l, fridayRoleBecomesWeekendCall: { ...l.fridayRoleBecomesWeekendCall, enabled: e.target.checked } }))} />
          Friday holder of</label>
        <select value={lab.fridayRoleBecomesWeekendCall.roleId} onChange={e => updateLab(l => ({ ...l, fridayRoleBecomesWeekendCall: { ...l.fridayRoleBecomesWeekendCall, roleId: e.target.value } }))}>
          {lab.roles.filter(r => r.kind === 'weekday').map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <span>covers the weekend as</span>
        <input value={lab.fridayRoleBecomesWeekendCall.label} onChange={e => updateLab(l => ({ ...l, fridayRoleBecomesWeekendCall: { ...l.fridayRoleBecomesWeekendCall, label: e.target.value } }))} />
        <input style={{ width: 70 }} value={lab.fridayRoleBecomesWeekendCall.code} onChange={e => updateLab(l => ({ ...l, fridayRoleBecomesWeekendCall: { ...l.fridayRoleBecomesWeekendCall, code: e.target.value } }))} />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label><input type="checkbox" checked={lab.rotateOffDay.enabled} onChange={e => updateLab(l => ({ ...l, rotateOffDay: { ...l.rotateOffDay, enabled: e.target.checked } }))} />
          Rotate which weekday is off fairly (4-day labs). Track:</label>
        {WEEKDAYS.filter(wd => lab.workdays.includes(wd)).map(wd => (
          <label key={wd}><input type="checkbox" checked={lab.rotateOffDay.candidates.includes(wd)} onChange={e => updateLab(l => ({ ...l, rotateOffDay: { ...l.rotateOffDay, candidates: e.target.checked ? [...l.rotateOffDay.candidates, wd] : l.rotateOffDay.candidates.filter(x => x !== wd) } }))} />{wd}</label>
        ))}
      </div>
    </div>
  )
}

function TechTable({ data, setData, lab }: { data: AppData; setData: SetData; lab: LabConfig }) {
  const techs = data.techs.filter(t => t.labId === lab.id)
  const roles = lab.roles.filter(r => r.enabled)
  const update = (id: string, fn: (t: Tech) => Tech) => setData(d => ({ ...d, techs: d.techs.map(t => t.id === id ? fn(t) : t) }))
  const add = () => setData(d => ({ ...d, techs: [...d.techs, makeTech(lab.id, 'New tech', 'FT', lab.daysPerWeek, roles.map(r => r.id))] }))
  const remove = (t: Tech) => { if (confirm(`Remove ${t.name}? Their history goes with them.`)) setData(d => ({ ...d, techs: d.techs.filter(x => x.id !== t.id) })) }

  return (
    <div className="panel">
      <h2>Techs in {lab.name} <span className="muted">({techs.length})</span></h2>
      <table className="list">
        <thead>
          <tr>
            <th>Active</th><th>Name</th><th>Initials</th><th>FT/PT</th><th>Days/wk</th>
            {roles.map(r => <th key={r.id}>{r.code}</th>)}
            <th>Late OK</th><th>Avoid late</th><th>Prefers off</th><th>History</th><th></th>
          </tr>
        </thead>
        <tbody>
          {techs.map(t => (
            <tr key={t.id} style={{ opacity: t.active ? 1 : .5 }}>
              <td><input type="checkbox" checked={t.active} onChange={e => update(t.id, x => ({ ...x, active: e.target.checked }))} /></td>
              <td><input value={t.name} onChange={e => update(t.id, x => ({ ...x, name: e.target.value, initials: initialsOf(e.target.value) }))} /></td>
              <td><input style={{ width: 50 }} value={t.initials} onChange={e => update(t.id, x => ({ ...x, initials: e.target.value }))} /></td>
              <td><select value={t.employment} onChange={e => update(t.id, x => ({ ...x, employment: e.target.value as 'FT' | 'PT' }))}><option>FT</option><option>PT</option></select></td>
              <td><input type="number" min={1} max={7} value={t.daysPerWeek} onChange={e => update(t.id, x => ({ ...x, daysPerWeek: +e.target.value }))} /></td>
              {roles.map(r => <td key={r.id}><input type="checkbox" checked={!!t.eligible[r.id]} onChange={e => update(t.id, x => ({ ...x, eligible: { ...x.eligible, [r.id]: e.target.checked } }))} /></td>)}
              <td><input type="checkbox" checked={t.eligible.late !== false} onChange={e => update(t.id, x => ({ ...x, eligible: { ...x.eligible, late: e.target.checked } }))} /></td>
              <td><input type="checkbox" checked={t.prefs.avoidLate} onChange={e => update(t.id, x => ({ ...x, prefs: { ...x.prefs, avoidLate: e.target.checked } }))} /></td>
              <td>
                <select value={t.prefs.preferredOffDay ?? ''} onChange={e => update(t.id, x => ({ ...x, prefs: { ...x.prefs, preferredOffDay: (e.target.value || undefined) as Weekday | undefined } }))}>
                  <option value="">—</option>
                  {lab.workdays.map(wd => <option key={wd} value={wd}>{wd}</option>)}
                </select>
              </td>
              <td className="note">{Object.entries(t.history).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' ') || '—'}{t.historyAsOf ? ` (thru ${t.historyAsOf})` : ''}</td>
              <td><button className="small danger" onClick={() => remove(t)}>remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="small" onClick={add} style={{ marginTop: 6 }}>+ Add tech</button>
      <p className="note">Role columns = eligible for that on-call role. Days/wk for part-timers sets their weekly target and scales their fair share of every burden.</p>
    </div>
  )
}

function Holidays({ data, setData }: { data: AppData; setData: SetData }) {
  const [val, setVal] = useState('')
  const add = () => { if (/^\d{4}-\d{2}-\d{2}$/.test(val) && !data.holidays.includes(val)) { setData(d => ({ ...d, holidays: [...d.holidays, val].sort() })); setVal('') } }
  return (
    <div className="panel">
      <h2>Holidays <span className="muted">(labs closed; treated like a weekend for call)</span></h2>
      <div className="row">
        <input type="date" value={val} onChange={e => setVal(e.target.value)} />
        <button className="small" onClick={add}>Add</button>
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {data.holidays.map(h => <span className="chip" key={h}>{h}<button onClick={() => setData(d => ({ ...d, holidays: d.holidays.filter(x => x !== h) }))}>×</button></span>)}
        {!data.holidays.length && <span className="note">none yet</span>}
      </div>
    </div>
  )
}

function WeightsEditor({ lab, updateLab }: { lab: LabConfig; updateLab: (fn: (l: LabConfig) => LabConfig) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="panel">
      <h2>Penalty weights for {lab.name} <button className="small" onClick={() => setOpen(o => !o)}>{open ? 'hide' : 'show'}</button></h2>
      {open && (
        <>
          <table className="list">
            <tbody>
              {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map(k => (
                <tr key={k}><td>{WEIGHT_LABELS[k]}</td><td><input type="number" min={0} value={lab.weights[k]} onChange={e => updateLab(l => ({ ...l, weights: { ...l.weights, [k]: +e.target.value } }))} /></td></tr>
              ))}
            </tbody>
          </table>
          <button className="small" onClick={() => updateLab(l => ({ ...l, weights: { ...DEFAULT_WEIGHTS } }))} style={{ marginTop: 6 }}>Reset to defaults</button>
          <p className="note">Higher = the solver tries harder to avoid it. Fairness uses squared spread, so a small weight still bites when one person drifts far from the group.</p>
        </>
      )}
    </div>
  )
}
