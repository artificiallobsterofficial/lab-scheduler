import { useMemo } from 'react'
import type { AppData, LabConfig, MonthDoc } from '../domain/types'
import { bucketLabel, fairnessRows } from '../domain/history'

export function FairnessTable({ data, lab, doc }: { data: AppData; lab: LabConfig; doc: MonthDoc }) {
  const { buckets, rows } = useMemo(() => fairnessRows(data, lab.id, doc), [data, lab.id, doc])
  if (!rows.length) return null
  // column min/max on cumulative, normalized by share, for highlighting
  const norm = rows.map(r => r.cumulative.map(v => v / Math.max(0.2, r.tech.daysPerWeek / Math.max(1, lab.daysPerWeek))))
  const colVals = (b: number) => norm.filter((_, i) => rows[i].eligible[b]).map(n => n[b])
  const colMin = buckets.map((_, b) => Math.min(...colVals(b)))
  const colMax = buckets.map((_, b) => Math.max(...colVals(b)))
  return (
    <div className="panel">
      <h3>Fairness · {lab.name} <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>month (cumulative incl. history)</span></h3>
      <table className="fair">
        <thead><tr><th>Tech</th>{buckets.map(b => <th key={b}>{bucketLabel(b, data, lab.id)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.tech.id}>
              <td>{r.tech.name}{r.tech.employment === 'PT' ? <span className="muted"> PT{r.tech.daysPerWeek}</span> : ''}</td>
              {buckets.map((b, bi) => {
                if (!r.eligible[bi]) return <td key={b} className="muted">—</td>
                const spread = colMax[bi] - colMin[bi]
                const cls = spread >= 2 ? (norm[i][bi] === colMax[bi] ? 'hi' : norm[i][bi] === colMin[bi] ? 'lo' : '') : ''
                return <td key={b} className={cls}>{r.month[bi]} <span className="muted">({r.cumulative[bi]})</span></td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">Red = carrying the most in that column, green = the least (after adjusting part-timers for their days/week). Spread under 2 is not flagged.</p>
    </div>
  )
}
