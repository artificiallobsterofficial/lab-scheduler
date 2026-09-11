import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppData, MonthDoc, RequestKind, Warning } from '../domain/types'
import { cellKey } from '../domain/types'
import { monthLabel, nextMonth, prevMonth } from '../domain/calendar'
import { evaluateLab } from '../solver/solve'
import { derivedMarkers } from '../domain/derived'
import type { WorkerOut } from '../solver/worker'
import { getMonthDoc, type SetData } from './App'
import { ScheduleGrid, type PaintMode } from './ScheduleGrid'
import { CellEditor } from './CellEditor'
import { FairnessTable } from './FairnessTable'

const ITER_OPTIONS = [{ label: 'Quick', n: 10000 }, { label: 'Normal', n: 40000 }, { label: 'Thorough', n: 150000 }]

export function MonthTab({ data, setData, month, setMonth }: { data: AppData; setData: SetData; month: string; setMonth: (m: string) => void }) {
  const doc = getMonthDoc(data, month)
  const committed = doc.status === 'committed'
  const [labFilter, setLabFilter] = useState<string>(data.labs[0]?.id ?? 'all')
  const shownLabs = useMemo(() => labFilter === 'all' ? data.labs : data.labs.filter(l => l.id === labFilter), [data.labs, labFilter])
  const shownIds = useMemo(() => new Set(shownLabs.map(l => l.id)), [shownLabs])
  const shownTechIds = useMemo(() => new Set(data.techs.filter(t => shownIds.has(t.labId)).map(t => t.id)), [data.techs, shownIds])
  const [paint, setPaint] = useState<PaintMode>('select')
  const [selected, setSelected] = useState<{ techId: string; date: string } | null>(null)
  const [iters, setIters] = useState(40000)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  const evals = useMemo(() => data.labs.map(lab => ({ lab, ...evaluateLab(data, lab, doc) })), [data, doc])
  const derived = useMemo(() => Object.assign({}, ...data.labs.map(lab => derivedMarkers(data, lab, doc))) as Record<string, string>, [data, doc])
  const shownEvals = useMemo(() => evals.filter(e => shownIds.has(e.lab.id)), [evals, shownIds])
  const warnings: Warning[] = useMemo(() => shownEvals.flatMap(e => e.evaluation.warnings).sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0) || (a.date ?? '').localeCompare(b.date ?? '')), [shownEvals])
  const hardKeys = useMemo(() => new Set(warnings.filter(w => w.hard && w.techId && w.date).map(w => cellKey(w.techId!, w.date!))), [warnings])
  const hasCells = Object.keys(doc.cells).some(k => shownTechIds.has(k.split('|')[0]))

  const updateDoc = (fn: (m: MonthDoc) => MonthDoc) => setData(d => ({ ...d, months: { ...d.months, [month]: fn(getMonthDoc(d, month)) } }))

  useEffect(() => () => workerRef.current?.terminate(), [])

  const generate = () => {
    if (running || committed) return
    setRunning(true); setProgress({}); setError(null)
    const w = new Worker(new URL('../solver/worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = w
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') setProgress(p => ({ ...p, [m.labId]: m.iter }))
      if (m.type === 'done') { updateDoc(d => ({ ...d, cells: m.cells })); setRunning(false); w.terminate(); workerRef.current = null }
    }
    w.onerror = err => { console.error('solver worker error', err); setError('Solver failed: ' + (err.message || 'see browser console')); setRunning(false); w.terminate(); workerRef.current = null }
    w.postMessage({ type: 'solve', data, month: doc, iterations: iters, labIds: labFilter === 'all' ? undefined : [labFilter] })
  }
  const cancel = () => { workerRef.current?.terminate(); workerRef.current = null; setRunning(false) }

  const clearUnlocked = () => {
    const scope = labFilter === 'all' ? 'every lab' : shownLabs[0]?.name
    if (!confirm(`Clear every unlocked cell in ${scope}? Locked cells and PTO/requests stay.`)) return
    updateDoc(d => ({ ...d, cells: Object.fromEntries(Object.entries(d.cells).filter(([k, c]) => c.locked || !shownTechIds.has(k.split('|')[0]))) }))
  }
  const unlockAll = () => updateDoc(d => ({ ...d, cells: Object.fromEntries(Object.entries(d.cells).map(([k, c]) => [k, shownTechIds.has(k.split('|')[0]) ? { ...c, locked: false } : c])) }))

  const onCellClick = (techId: string, date: string) => {
    if (committed) return
    if (paint === 'select') { setSelected({ techId, date }); return }
    updateDoc(d => {
      const inputs = { pto: { ...d.inputs.pto }, unavailable: { ...d.inputs.unavailable }, requests: { ...d.inputs.requests } }
      const toggleList = (rec: Record<string, string[]>) => {
        const list = rec[techId] ?? []
        rec[techId] = list.includes(date) ? list.filter(x => x !== date) : [...list, date].sort()
      }
      const removeFrom = (rec: Record<string, string[]>) => { if (rec[techId]) rec[techId] = rec[techId].filter(x => x !== date) }
      const setReq = (kind: RequestKind | null) => {
        const r = { ...(inputs.requests[techId] ?? {}) }
        if (kind === null || r[date] === kind) delete r[date]; else r[date] = kind
        inputs.requests[techId] = r
      }
      let cells = d.cells
      const dropCell = () => { cells = { ...cells }; delete cells[cellKey(techId, date)] }
      if (paint === 'PTO') { removeFrom(inputs.unavailable); toggleList(inputs.pto); dropCell() }
      else if (paint === 'UNAVAIL') { removeFrom(inputs.pto); toggleList(inputs.unavailable); dropCell() }
      else if (paint === 'OFF') setReq('OFF')
      else if (paint === 'ON') setReq('ON')
      else if (paint === 'erase') { removeFrom(inputs.pto); removeFrom(inputs.unavailable); setReq(null); dropCell() }
      return { ...d, inputs, cells }
    })
  }

  const selectedLab = selected ? data.labs.find(l => l.id === data.techs.find(t => t.id === selected.techId)?.labId) : undefined
  const selectedEval = selectedLab ? evals.find(e => e.lab.id === selectedLab.id) : undefined

  return (
    <div>
      <div className="panel">
        <div className="tabs labtabs">
          {data.labs.map(l => <button key={l.id} className={labFilter === l.id ? 'active' : ''} onClick={() => { setLabFilter(l.id); setSelected(null) }} disabled={running}>{l.name}</button>)}
          <button className={labFilter === 'all' ? 'active' : ''} onClick={() => { setLabFilter('all'); setSelected(null) }} disabled={running}>All labs</button>
        </div>
        <div className="toolbar">
          <button className="small" onClick={() => setMonth(prevMonth(month))}>‹</button>
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
          <button className="small" onClick={() => setMonth(nextMonth(month))}>›</button>
          <b>{monthLabel(month)}</b>
          {committed && <span className="pill committed">committed</span>}
          {!committed && hasCells && <span className="pill">draft</span>}
          <span className="sep" />
          <select value={iters} onChange={e => setIters(+e.target.value)} disabled={running}>
            {ITER_OPTIONS.map(o => <option key={o.n} value={o.n}>{o.label} ({o.n / 1000}k)</option>)}
          </select>
          {!running
            ? <button className="primary" onClick={generate} disabled={committed}>{hasCells ? 'Re-generate' : 'Generate'} {labFilter === 'all' ? 'all labs' : shownLabs[0]?.name}{hasCells ? ' (keeps locked cells)' : ''}</button>
            : <button onClick={cancel}>Cancel</button>}
          <button className="small" onClick={clearUnlocked} disabled={!hasCells || committed}>Clear unlocked</button>
          <button className="small" onClick={unlockAll} disabled={!hasCells || committed}>Unlock all</button>
        </div>
        {error && <p className="note" style={{ color: 'var(--bad)' }}>{error}</p>}
        {running && (
          <div>
            {shownLabs.map(l => <div key={l.id} className="note">{l.name} <div className="progress"><div style={{ width: `${Math.min(100, ((progress[l.id] ?? 0) / iters) * 100)}%` }} /></div></div>)}
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span className="note">Click cells to:</span>
          {([['select', 'Select / edit'], ['PTO', 'Paint PTO'], ['UNAVAIL', 'Paint unavailable'], ['OFF', 'Request off'], ['ON', 'Request on'], ['erase', 'Erase input']] as [PaintMode, string][]).map(([m, label]) => (
            <button key={m} className={'small ' + (paint === m ? 'active' : '')} onClick={() => setPaint(m)} disabled={committed}>{label}</button>
          ))}
          <span className="note" style={{ marginLeft: 8 }}>Enter PTO and requests first, then generate. Any cell you edit by hand becomes locked (dot) and survives re-generate.</span>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <div className="panel">
            <ScheduleGrid data={data} labs={shownLabs} doc={doc} derived={derived} hardKeys={hardKeys} selected={selected} paint={committed ? 'select' : paint} onCellClick={onCellClick} />
          </div>
          {shownLabs.map(lab => <FairnessTable key={lab.id} data={data} lab={lab} doc={doc} />)}
        </div>
        <div>
          {selected && selectedLab && selectedEval && !committed && (
            <CellEditor data={data} doc={doc} lab={selectedLab} problem={selectedEval.problem} techId={selected.techId} date={selected.date} updateDoc={updateDoc} onClose={() => setSelected(null)} />
          )}
          <div className="panel">
            <h3>Score</h3>
            {shownEvals.map(e => (
              <div key={e.lab.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{e.lab.name}</span>
                <span>
                  {e.evaluation.hard > 0 && <b style={{ color: 'var(--bad)' }}>{e.evaluation.hard} hard </b>}
                  <span className="muted">penalty {Math.round(e.evaluation.soft)}</span>
                </span>
              </div>
            ))}
            <p className="note">Lower penalty is better. Hard = a rule that must never be broken (only possible via manual edits).</p>
          </div>
          <div className="panel">
            <h3>Warnings ({warnings.length})</h3>
            {hasCells ? (
              <ul className="warnlist">
                {warnings.slice(0, 200).map((w, i) => <li key={i} className={w.hard ? 'hard' : ''}><span className="d">{w.date?.slice(5) ?? ''}</span>{shownLabs.length > 1 && <span className="d">{data.labs.find(l => l.id === w.labId)?.name}</span>}{w.msg}</li>)}
                {!warnings.length && <li className="muted">None. Every slot is filled and no rule is broken.</li>}
              </ul>
            ) : <p className="note">Generate a schedule to see warnings.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
