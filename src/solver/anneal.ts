// Phase C: simulated annealing over hard-constraint-preserving moves. Full rescore per move
// (the problem is tiny: ≤ ~15 techs × 31 days), which keeps the scorer the single source of truth.

import { S, isWorking, holdsAnyWeekdayRole, type Assignment, type Problem } from '../domain/problem'
import { scoreOf } from '../domain/score'
import type { Rng } from './rng'

type Undo = () => void

function lateCount(P: Problem, A: Assignment, d: number): number {
  let n = 0
  for (let t = 0; t < P.nT; t++) if (A.shift[t][d] === S.L) n++
  return n
}

function free(P: Problem, t: number, d: number): boolean {
  return !P.locked[t][d] && P.fixedShift[t][d] < 0
}

/** Move a tech's working day to another lab day in the same week. */
function moveOffDay(P: Problem, A: Assignment, rng: Rng): Undo | null {
  const t = rng.int(P.nT)
  const w = rng.int(P.weeks.length)
  const ld = P.labDaysInWeek[w]
  if (ld.length < 2) return null
  const on = ld.filter(d => isWorking(A.shift[t][d]) && free(P, t, d) && !holdsAnyWeekdayRole(P, A, d, t))
  const off = ld.filter(d => A.shift[t][d] === S.OFF && free(P, t, d))
  if (!on.length || !off.length) return null
  const d1 = rng.pick(on), d2 = rng.pick(off)
  const old1 = A.shift[t][d1]
  const newShift = old1 === S.L && lateCount(P, A, d2) < P.lateSlots[d2] && P.canLate[t] ? S.L : S.D
  A.shift[t][d1] = S.OFF; A.shift[t][d2] = newShift
  return () => { A.shift[t][d1] = old1; A.shift[t][d2] = S.OFF }
}

/** Hand a weekday role slot to another eligible tech working that day. */
function moveWeekdayRole(P: Problem, A: Assignment, rng: Rng): Undo | null {
  const weekdayRoles = P.roles.map((_, i) => i).filter(i => !P.roleIsWeekend[i])
  if (!weekdayRoles.length) return null
  const ri = rng.pick(weekdayRoles), per = P.roles[ri].perDay
  const d = rng.int(P.nD)
  if (!P.isLabDay[d]) return null
  const s = rng.int(per), k = d * per + s
  const t1 = A.role[ri][k]
  if (t1 >= 0 && P.locked[t1][d]) return null
  const cands: number[] = []
  for (let t = 0; t < P.nT; t++) {
    if (t === t1 || !P.eligible[ri][t] || !isWorking(A.shift[t][d]) || P.locked[t][d]) continue
    if (holdsAnyWeekdayRole(P, A, d, t)) continue
    cands.push(t)
  }
  if (!cands.length) return null
  A.role[ri][k] = rng.pick(cands)
  return () => { A.role[ri][k] = t1 }
}

/** Swap the holders of one weekday role between two days. */
function swapWeekdayRoleDates(P: Problem, A: Assignment, rng: Rng): Undo | null {
  const weekdayRoles = P.roles.map((_, i) => i).filter(i => !P.roleIsWeekend[i])
  if (!weekdayRoles.length) return null
  const ri = rng.pick(weekdayRoles), per = P.roles[ri].perDay
  const d1 = rng.int(P.nD), d2 = rng.int(P.nD)
  if (d1 === d2 || !P.isLabDay[d1] || !P.isLabDay[d2]) return null
  const s = rng.int(per), k1 = d1 * per + s, k2 = d2 * per + s
  const t1 = A.role[ri][k1], t2 = A.role[ri][k2]
  if (t1 < 0 || t2 < 0 || t1 === t2) return null
  if (P.locked[t1][d1] || P.locked[t1][d2] || P.locked[t2][d1] || P.locked[t2][d2]) return null
  if (!isWorking(A.shift[t1][d2]) || !isWorking(A.shift[t2][d1])) return null
  // t1 must not already hold another weekday role on d2 (other than via this slot), same for t2 on d1
  A.role[ri][k1] = -1; A.role[ri][k2] = -1
  const ok = !holdsAnyWeekdayRole(P, A, d2, t1) && !holdsAnyWeekdayRole(P, A, d1, t2)
  if (!ok) { A.role[ri][k1] = t1; A.role[ri][k2] = t2; return null }
  A.role[ri][k1] = t2; A.role[ri][k2] = t1
  return () => { A.role[ri][k1] = t1; A.role[ri][k2] = t2 }
}

/** Hand a weekend/holiday block to another eligible tech. */
function moveBlock(P: Problem, A: Assignment, rng: Rng): Undo | null {
  const wr = P.roles.map((_, i) => i).filter(i => P.roleIsWeekend[i])
  if (!wr.length || !P.blocks.length) return null
  const ri = rng.pick(wr), per = P.roles[ri].perDay
  const blk = rng.pick(P.blocks), s = rng.int(per)
  const d0 = blk.days[0]
  const t1 = A.role[ri][d0 * per + s]
  if (t1 >= 0 && blk.days.some(d => P.locked[t1][d])) return null
  const cands: number[] = []
  for (let t = 0; t < P.nT; t++) {
    if (t === t1 || !P.eligible[ri][t]) continue
    if (blk.days.some(d => P.fixedShift[t][d] >= 0 || P.locked[t][d])) continue
    let taken = false
    for (let s2 = 0; s2 < per; s2++) if (A.role[ri][d0 * per + s2] === t) taken = true
    if (taken) continue
    cands.push(t)
  }
  if (!cands.length) return null
  const t2 = rng.pick(cands)
  for (const d of blk.days) A.role[ri][d * per + s] = t2
  return () => { for (const d of blk.days) A.role[ri][d * per + s] = t1 }
}

/** Swap which of two techs takes the late shift on a day. */
function swapLate(P: Problem, A: Assignment, rng: Rng): Undo | null {
  const d = rng.int(P.nD)
  if (!P.isLabDay[d] || P.lateSlots[d] === 0) return null
  const lates: number[] = [], days: number[] = []
  for (let t = 0; t < P.nT; t++) {
    if (P.locked[t][d]) continue
    if (A.shift[t][d] === S.L) lates.push(t)
    else if (A.shift[t][d] === S.D && P.canLate[t]) days.push(t)
  }
  if (!days.length) return null
  const t2 = rng.pick(days)
  if (lates.length && (lateCount(P, A, d) >= P.lateSlots[d] || rng.next() < 0.8)) {
    const t1 = rng.pick(lates)
    A.shift[t1][d] = S.D; A.shift[t2][d] = S.L
    return () => { A.shift[t1][d] = S.L; A.shift[t2][d] = S.D }
  }
  if (lateCount(P, A, d) >= P.lateSlots[d]) return null
  A.shift[t2][d] = S.L
  return () => { A.shift[t2][d] = S.D }
}

const MOVES = [moveOffDay, moveWeekdayRole, swapWeekdayRoleDates, moveBlock, swapLate, moveWeekdayRole, moveBlock]

export interface AnnealOpts { iterations: number; t0: number; t1: number; onProgress?: (iter: number, best: number) => void }

export function anneal(P: Problem, A: Assignment, rng: Rng, opts: AnnealOpts): { best: Assignment; bestScore: number } {
  let cur = scoreOf(P, A)
  let best = cloneA(A), bestScore = cur
  const { iterations, t0, t1 } = opts
  const alpha = Math.pow(t1 / t0, 1 / Math.max(1, iterations))
  let T = t0
  for (let i = 0; i < iterations; i++) {
    const move = rng.pick(MOVES)
    const undo = move(P, A, rng)
    if (undo) {
      const next = scoreOf(P, A)
      const delta = next - cur
      if (delta <= 0 || rng.next() < Math.exp(-delta / T)) {
        cur = next
        if (cur < bestScore) { bestScore = cur; best = cloneA(A) }
      } else undo()
    }
    T *= alpha
    if (opts.onProgress && i % 2000 === 0) opts.onProgress(i, bestScore)
  }
  return { best, bestScore }
}

function cloneA(A: Assignment): Assignment {
  return { shift: A.shift.map(a => new Int8Array(a)), role: A.role.map(a => new Int16Array(a)) }
}
