import { useMemo, useRef } from 'react'
import type { AppData } from '../domain/types'
import { monthLabel } from '../domain/calendar'
import { commitMonth } from '../domain/history'
import { evaluateLab } from '../solver/solve'
import { downloadWorkbook } from '../storage/excel'
import { downloadText, exportJson, importJson, resetData } from '../storage/localStore'
import { getMonthDoc, type SetData } from './App'

export function ExportTab({ data, setData, month }: { data: AppData; setData: SetData; month: string }) {
  const doc = getMonthDoc(data, month)
  const hasCells = Object.keys(doc.cells).length > 0
  const fileRef = useRef<HTMLInputElement>(null)
  const evals = useMemo(() => data.labs.map(lab => evaluateLab(data, lab, doc)), [data, doc])
  const hard = evals.reduce((s, e) => s + e.evaluation.hard, 0)
  const warnings = evals.flatMap(e => e.evaluation.warnings)

  const exportXlsx = () => downloadWorkbook(data, doc, warnings)
  const backup = () => downloadText(`lab-scheduler-backup-${new Date().toISOString().slice(0, 10)}.json`, exportJson(data))
  const restore = async (f: File) => {
    try {
      const parsed = importJson(await f.text())
      if (confirm(`Replace everything in this browser with the backup (${parsed.labs.length} labs, ${parsed.techs.length} techs, ${Object.keys(parsed.months).length} months)?`)) setData(() => parsed)
    } catch (e) { alert((e as Error).message) }
    if (fileRef.current) fileRef.current.value = ''
  }
  const commit = () => {
    if (hard > 0 && !confirm(`${hard} hard rule violation(s) still on the board. Commit anyway?`)) return
    if (!confirm(`Commit ${monthLabel(month)}? Its counts get added to everyone's history and the month becomes read-only.`)) return
    setData(d => commitMonth(d, getMonthDoc(d, month)))
  }
  const reset = () => { if (confirm('Wipe ALL data in this browser and reload the default three-lab template? Back up first.')) setData(() => resetData()) }
  const deleteMonth = (m: string) => { if (confirm(`Delete the draft for ${monthLabel(m)}?`)) setData(d => { const months = { ...d.months }; delete months[m]; return { ...d, months } }) }

  const months = Object.values(data.months).sort((a, b) => b.month.localeCompare(a.month))

  return (
    <div>
      <div className="panel">
        <h2>{monthLabel(month)}</h2>
        <div className="row">
          <button className="primary" onClick={exportXlsx} disabled={!hasCells}>Download Excel (.xlsx)</button>
          <button onClick={commit} disabled={!hasCells || doc.status === 'committed'}>{doc.status === 'committed' ? 'Committed' : 'Commit month to history'}</button>
        </div>
        <p className="note">Excel has one sheet per lab (the grid people are used to), an on-call calendar, the fairness table, and the warning list. Commit once the month is final: it rolls each tech's counts into their history so next month balances against it.</p>
        {hard > 0 && <p className="note" style={{ color: 'var(--bad)' }}>{hard} hard violation(s) in this month. Fix them on the Schedule tab first.</p>}
      </div>

      <div className="panel">
        <h2>Months</h2>
        {!months.length && <p className="note">No months yet.</p>}
        <table className="list">
          <tbody>
            {months.map(m => (
              <tr key={m.month}>
                <td>{monthLabel(m.month)}</td>
                <td><span className={'pill ' + (m.status === 'committed' ? 'committed' : '')}>{m.status}</span></td>
                <td className="note">{Object.keys(m.cells).length} cells</td>
                <td>{m.status === 'draft' && <button className="small danger" onClick={() => deleteMonth(m.month)}>delete draft</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Backup &amp; restore</h2>
        <div className="row">
          <button onClick={backup}>Download JSON backup</button>
          <label>Restore from backup <input ref={fileRef} type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && restore(e.target.files[0])} /></label>
          <button className="danger" onClick={reset}>Reset to template</button>
        </div>
        <p className="note">Everything (labs, techs, history, months) lives only in this browser's storage. Download a backup before clearing browser data or moving to another machine.</p>
      </div>
    </div>
  )
}
