// Array-based representation of one lab's month so the solver can score fast.
// buildProblem() turns AppData + MonthDoc into a Problem; Assignment is the mutable solution.

import type { AppData, Cell, LabConfig, MonthDoc, RoleConfig, Tech, Weights } from './types'
import { BUCKET, cellKey } from './types'
import { monthDays, type DayInfo } from './calendar'

export const S = { OFF: 0, D: 1, L: 2, PTO: 3, UNAVAIL: 4 } as const
export type ShiftNum = 0 | 1 | 2 | 3 | 4
export const SHIFT_CODES = ['OFF', 'D', 'L', 'PTO', 'UNAVAIL'] as const
export const isWorking = (s: number) => s === S.D || s === S.L

export interface CallBlock { idx: number; days: number[]; kind: 'weekend' | 'holiday'; fridayDay: number }

export interface Problem {
  lab: LabConfig
  techs: Tech[]
  days: DayInfo[]
  nT: number
  nD: number
  isLabDay: boolean[]
  blocks: CallBlock[]
  blockOfDay: number[]              // -1 when the day is not part of a call block
  roles: RoleConfig[]               // enabled roles; index r
  roleIsWeekend: boolean[]
  fridayRole: number                // index into roles whose Friday holder becomes weekend call, or -1
  eligible: boolean[][]             // [r][t]
  canLate: boolean[]
  fixedShift: Int8Array[]           // [t][d] -> S.PTO / S.UNAVAIL / -1
  locked: boolean[][]               // [t][d]
  weeks: number[][]                 // day idx by week
  labDaysInWeek: number[][]         // lab-day idx by week
  workTarget: number[][]            // [t][w]
  request: Int8Array[]              // [t][d] 0 none, 1 OFF, 2 ON
  lateSlots: number[]               // [d]
  coverageMin: number[]             // [d]
  share: number[]                   // [t] daysPerWeek / lab.daysPerWeek
  buckets: string[]
  bucketEligible: boolean[][]       // [b][t]
  history: number[][]               // [t][b]
  preferredOff: number[]            // [t] weekday index in day list terms: -1 or 0..6 (Mon=0)
  avoidLate: boolean[]
  offBucket: number[]               // [weekdayIdx] -> bucket idx or -1 (rotateOffDay candidates)
  rotationEligible: boolean[]       // [t] tech has exactly one weekly off-day, so rotation applies
  weights: Weights
}

export interface Assignment {
  shift: Int8Array[]                // [t][d]
  role: Int16Array[]                // [r][d * perDay + slot] -> tech idx or -1
  /** Manual edits that gave a role to more techs than it has slots (hard violation, reported by evaluate). */
  overflow?: { r: number; d: number; t: number }[]
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function techsOfLab(data: AppData, labId: string): Tech[] {
  return data.techs.filter(t => t.labId === labId && t.active)
}

export function buildProblem(data: AppData, lab: LabConfig, month: MonthDoc): Problem {
  const techs = techsOfLab(data, lab.id)
  const days = monthDays(month.month, data.holidays)
  const nT = techs.length, nD = days.length
  const workdaySet = new Set(lab.workdays)
  const isLabDay = days.map(d => workdaySet.has(d.weekday) && !d.isHoliday)

  // call blocks: consecutive non-lab days form one block; kind = holiday if any weekday holiday inside, else weekend
  const blocks: CallBlock[] = []
  const blockOfDay = new Array<number>(nD).fill(-1)
  for (let d = 0; d < nD; d++) {
    if (isLabDay[d]) continue
    const prev = d > 0 && !isLabDay[d - 1] ? blockOfDay[d - 1] : -1
    if (prev >= 0) { blocks[prev].days.push(d); blockOfDay[d] = prev; continue }
    const b: CallBlock = { idx: blocks.length, days: [d], kind: 'weekend', fridayDay: d > 0 && isLabDay[d - 1] ? d - 1 : -1 }
    blocks.push(b); blockOfDay[d] = b.idx
  }
  for (const b of blocks) {
    if (b.days.some(d => days[d].isHoliday && !days[d].isWeekend)) b.kind = 'holiday'
  }

  const roles = lab.roles.filter(r => r.enabled)
  const roleIsWeekend = roles.map(r => r.kind === 'weekend')
  const fr = lab.fridayRoleBecomesWeekendCall
  const fridayRole = fr.enabled ? roles.findIndex(r => r.id === fr.roleId && r.kind === 'weekday') : -1
  const eligible = roles.map(r => techs.map(t => !!t.eligible[r.id]))
  const canLate = techs.map(t => t.eligible.late !== false)

  const fixedShift = techs.map(() => new Int8Array(nD).fill(-1))
  const locked = techs.map(() => new Array<boolean>(nD).fill(false))
  const request = techs.map(() => new Int8Array(nD))
  const dateIdx = new Map(days.map(d => [d.date, d.idx]))
  techs.forEach((t, ti) => {
    for (const date of month.inputs.pto[t.id] ?? []) { const d = dateIdx.get(date); if (d !== undefined) fixedShift[ti][d] = S.PTO }
    for (const date of month.inputs.unavailable[t.id] ?? []) { const d = dateIdx.get(date); if (d !== undefined) fixedShift[ti][d] = S.UNAVAIL }
    for (const [date, kind] of Object.entries(month.inputs.requests[t.id] ?? {})) {
      const d = dateIdx.get(date); if (d !== undefined) request[ti][d] = kind === 'OFF' ? 1 : 2
    }
    for (let d = 0; d < nD; d++) {
      const c = month.cells[cellKey(t.id, days[d].date)]
      if (c?.locked) locked[ti][d] = true
    }
  })

  const nW = days[nD - 1].week + 1
  const weeks: number[][] = Array.from({ length: nW }, () => [])
  const labDaysInWeek: number[][] = Array.from({ length: nW }, () => [])
  for (const d of days) { weeks[d.week].push(d.idx); if (isLabDay[d.idx]) labDaysInWeek[d.week].push(d.idx) }
  const workTarget = techs.map((t, ti) => labDaysInWeek.map(ld => {
    const off = ld.filter(d => fixedShift[ti][d] >= 0).length
    const base = Math.round(t.daysPerWeek * ld.length / Math.max(1, lab.workdays.length))
    return Math.max(0, Math.min(ld.length - off, base - off))
  }))

  const lateSlots = days.map(d => isLabDay[d.idx] ? (lab.lateSlots[d.weekday] ?? 0) : 0)
  const coverageMin = days.map(d => isLabDay[d.idx] ? (lab.coverageMin[d.weekday] ?? 0) : 0)
  const share = techs.map(t => Math.max(0.2, t.daysPerWeek / Math.max(1, lab.daysPerWeek)))

  // fairness buckets
  const buckets: string[] = []
  const bucketEligible: boolean[][] = []
  roles.forEach((r, ri) => { if (!roleIsWeekend[ri]) { buckets.push(r.id); bucketEligible.push(eligible[ri]) } })
  const anyCallEligible = techs.map((_, ti) => roles.some((_, ri) => (roleIsWeekend[ri] || ri === fridayRole) && eligible[ri][ti]))
  buckets.push(BUCKET.weekendCall); bucketEligible.push(anyCallEligible)
  buckets.push(BUCKET.holidayCall); bucketEligible.push(anyCallEligible)
  buckets.push(BUCKET.late); bucketEligible.push(canLate)
  // off-day rotation only applies to techs with a single weekly off-day (e.g. 4 of 5)
  const rotationEligible = techs.map(t => lab.rotateOffDay.enabled && t.daysPerWeek >= lab.workdays.length - 1 && t.daysPerWeek < lab.workdays.length)
  const offBucket = new Array<number>(7).fill(-1)
  if (lab.rotateOffDay.enabled) {
    for (const wd of lab.rotateOffDay.candidates) {
      offBucket[WD.indexOf(wd)] = buckets.length
      buckets.push(`off_${wd}`); bucketEligible.push(rotationEligible)
    }
  }
  const history = techs.map(t => buckets.map(b => t.history[b] ?? 0))

  return {
    lab, techs, days, nT, nD, isLabDay, blocks, blockOfDay, roles, roleIsWeekend, fridayRole,
    eligible, canLate, fixedShift, locked, weeks, labDaysInWeek, workTarget, request, lateSlots, coverageMin,
    share, buckets, bucketEligible, history,
    preferredOff: techs.map(t => t.prefs.preferredOffDay ? WD.indexOf(t.prefs.preferredOffDay) : -1),
    avoidLate: techs.map(t => !!t.prefs.avoidLate),
    offBucket, rotationEligible,
    weights: lab.weights,
  }
}

export function weekdayIdx(P: Problem, d: number): number { return WD.indexOf(P.days[d].weekday) }

export function emptyAssignment(P: Problem): Assignment {
  return {
    shift: P.techs.map((_, t) => { const a = new Int8Array(P.nD); for (let d = 0; d < P.nD; d++) a[d] = P.fixedShift[t][d] >= 0 ? P.fixedShift[t][d] : S.OFF; return a }),
    role: P.roles.map(r => new Int16Array(P.nD * r.perDay).fill(-1)),
  }
}

export function cloneAssignment(A: Assignment): Assignment {
  return { shift: A.shift.map(a => new Int8Array(a)), role: A.role.map(a => new Int16Array(a)) }
}

/** Read the current cells of the month doc into an Assignment (used for re-scoring after manual edits, and to seed the solver with locked cells). */
export function assignmentFromCells(P: Problem, month: MonthDoc): Assignment {
  const A = emptyAssignment(P)
  P.techs.forEach((t, ti) => {
    for (let d = 0; d < P.nD; d++) {
      const c = month.cells[cellKey(t.id, P.days[d].date)]
      if (!c) continue
      if (P.fixedShift[ti][d] >= 0) A.shift[ti][d] = P.fixedShift[ti][d]
      else A.shift[ti][d] = c.shift === 'D' ? S.D : c.shift === 'L' ? S.L : S.OFF
      for (const rid of c.roles) {
        const r = P.roles.findIndex(x => x.id === rid)
        if (r < 0) continue
        const per = P.roles[r].perDay
        let placed = false
        for (let s = 0; s < per; s++) {
          const k = d * per + s
          if (A.role[r][k] === ti) { placed = true; break }
          if (A.role[r][k] === -1) { A.role[r][k] = ti; placed = true; break }
        }
        if (!placed) (A.overflow ??= []).push({ r, d, t: ti })
      }
    }
  })
  return A
}

export function cellsFromAssignment(P: Problem, A: Assignment, prev: Record<string, Cell>): Record<string, Cell> {
  const out: Record<string, Cell> = {}
  P.techs.forEach((t, ti) => {
    for (let d = 0; d < P.nD; d++) {
      const key = cellKey(t.id, P.days[d].date)
      const roles: string[] = []
      P.roles.forEach((r, ri) => {
        for (let s = 0; s < r.perDay; s++) if (A.role[ri][d * r.perDay + s] === ti) { roles.push(r.id); break }
      })
      out[key] = { shift: SHIFT_CODES[A.shift[ti][d]], roles, locked: prev[key]?.locked ?? false }
    }
  })
  return out
}

/** Slot helpers */
export function holders(P: Problem, A: Assignment, r: number, d: number): number[] {
  const per = P.roles[r].perDay, out: number[] = []
  for (let s = 0; s < per; s++) out.push(A.role[r][d * per + s])
  return out
}
export function holdsRole(P: Problem, A: Assignment, r: number, d: number, t: number): boolean {
  const per = P.roles[r].perDay
  for (let s = 0; s < per; s++) if (A.role[r][d * per + s] === t) return true
  return false
}
/** Does tech t hold ANY weekday role on day d? */
export function holdsAnyWeekdayRole(P: Problem, A: Assignment, d: number, t: number): boolean {
  for (let r = 0; r < P.roles.length; r++) if (!P.roleIsWeekend[r] && holdsRole(P, A, r, d, t)) return true
  return false
}
export function setBlockHolder(P: Problem, A: Assignment, r: number, b: number, slot: number, t: number) {
  const per = P.roles[r].perDay
  for (const d of P.blocks[b].days) A.role[r][d * per + slot] = t
}
