// Commit a month: fold its bucket counts into each tech's cumulative history so next month rebalances against it.
import type { AppData, MonthDoc, Tech } from './types'
import { assignmentFromCells, buildProblem } from './problem'
import { bucketCounts } from './score'

export interface FairnessRow { tech: Tech; buckets: string[]; month: number[]; cumulative: number[]; eligible: boolean[] }

export function fairnessRows(data: AppData, labId: string, month: MonthDoc): { buckets: string[]; rows: FairnessRow[] } {
  const lab = data.labs.find(l => l.id === labId)
  if (!lab) return { buckets: [], rows: [] }
  const P = buildProblem(data, lab, month)
  const A = assignmentFromCells(P, month)
  const counts = bucketCounts(P, A)
  const rows = P.techs.map((tech, ti) => ({
    tech, buckets: P.buckets, month: counts[ti],
    cumulative: P.buckets.map((b, bi) => (tech.history[b] ?? 0) + counts[ti][bi]),
    eligible: P.buckets.map((_, bi) => P.bucketEligible[bi][ti]),
  }))
  return { buckets: P.buckets, rows }
}

/** Returns a new AppData with the month committed (history rolled forward). Refuses to double-commit. */
export function commitMonth(data: AppData, month: MonthDoc): AppData {
  if (month.status === 'committed') return data
  const techs = data.techs.map(t => ({ ...t, history: { ...t.history } }))
  const byId = new Map(techs.map(t => [t.id, t]))
  for (const lab of data.labs) {
    const P = buildProblem(data, lab, month)
    const A = assignmentFromCells(P, month)
    const counts = bucketCounts(P, A)
    P.techs.forEach((tech, ti) => {
      const t = byId.get(tech.id)!
      P.buckets.forEach((b, bi) => { t.history[b] = (t.history[b] ?? 0) + counts[ti][bi] })
      t.historyAsOf = month.month
    })
  }
  return { ...data, techs, months: { ...data.months, [month.month]: { ...month, status: 'committed' } } }
}

export function bucketLabel(b: string, data: AppData, labId: string): string {
  const lab = data.labs.find(l => l.id === labId)
  const role = lab?.roles.find(r => r.id === b)
  if (role) return role.label
  const fixed: Record<string, string> = { weekendCall: 'Weekend call', holidayCall: 'Holiday call', late: 'Late shifts' }
  if (fixed[b]) return fixed[b]
  if (b.startsWith('off_')) return `${b.slice(4)} off`
  return b
}
