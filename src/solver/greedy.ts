// Phase B: greedy construction, scarcest slots first. Never violates hard constraints.

import { BUCKET } from '../domain/types'
import { S, isWorking, holdsAnyWeekdayRole, holdsRole, weekdayIdx, type Assignment, type Problem } from '../domain/problem'
import { bucketCounts } from '../domain/score'
import type { Rng } from './rng'

/** Reset every unlocked cell to its baseline (fixed PTO/UNAVAIL or OFF, no roles). Locked cells and locked block holders survive. */
export function clearUnlocked(P: Problem, A: Assignment) {
  for (let t = 0; t < P.nT; t++) for (let d = 0; d < P.nD; d++) {
    if (P.locked[t][d]) continue
    A.shift[t][d] = P.fixedShift[t][d] >= 0 ? P.fixedShift[t][d] : S.OFF
  }
  P.roles.forEach((r, ri) => {
    const per = r.perDay
    if (!P.roleIsWeekend[ri]) {
      for (let d = 0; d < P.nD; d++) for (let s = 0; s < per; s++) {
        const t = A.role[ri][d * per + s]
        if (t >= 0 && !P.locked[t][d]) A.role[ri][d * per + s] = -1
      }
      return
    }
    // weekend role: a block keeps its holder only if the holder is locked on some day of the block
    for (const blk of P.blocks) {
      for (let s = 0; s < per; s++) {
        let keep = -1
        for (const d of blk.days) { const t = A.role[ri][d * per + s]; if (t >= 0 && P.locked[t][d]) { keep = t; break } }
        for (const d of blk.days) A.role[ri][d * per + s] = keep
      }
    }
  })
}

function debt(P: Problem, counts: number[][], t: number, b: number): number {
  if (b < 0) return 0
  return (P.history[t][b] + counts[t][b]) / P.share[t]
}

export function greedy(P: Problem, A: Assignment, rng: Rng) {
  const bWeekend = P.buckets.indexOf(BUCKET.weekendCall)
  const bHoliday = P.buckets.indexOf(BUCKET.holidayCall)
  const bLate = P.buckets.indexOf(BUCKET.late)
  let counts = bucketCounts(P, A)

  // ---- 1. shifts: meet each tech's weekly work target, choosing OFF days by preference / rotation / coverage
  const workingOn = new Array<number>(P.nD).fill(0)
  for (let t = 0; t < P.nT; t++) for (let d = 0; d < P.nD; d++) if (isWorking(A.shift[t][d])) workingOn[d]++
  const order = rng.shuffle([...Array(P.nT).keys()])
  for (let w = 0; w < P.weeks.length; w++) {
    for (const t of order) {
      const ld = P.labDaysInWeek[w]
      const free = ld.filter(d => !P.locked[t][d] && P.fixedShift[t][d] < 0)
      const lockedWorking = ld.filter(d => P.locked[t][d] && isWorking(A.shift[t][d])).length
      const need = Math.max(0, Math.min(free.length, P.workTarget[t][w] - lockedWorking))
      const k = free.length - need   // how many free days become OFF
      const offScore = free.map(d => {
        let s = rng.next()
        const req = P.request[t][d]
        if (req === 1) s += 100
        if (req === 2) s -= 100
        if (weekdayIdx(P, d) === P.preferredOff[t]) s += 20
        const ob = P.offBucket[weekdayIdx(P, d)]
        if (ob >= 0 && P.rotationEligible[t]) {
          // prefer the candidate off-day where this tech is furthest below the group mean
          let sum = 0, n = 0
          for (let u = 0; u < P.nT; u++) { sum += debt(P, counts, u, ob); n++ }
          const mean = n ? sum / n : 0
          s += 10 * (mean - debt(P, counts, t, ob)) + 15
        }
        s += 3 * (workingOn[d] - P.coverageMin[d])
        return { d, s }
      })
      offScore.sort((a, b) => b.s - a.s)
      const offDays = new Set(offScore.slice(0, k).map(x => x.d))
      for (const d of free) {
        if (offDays.has(d)) { A.shift[t][d] = S.OFF; const ob = P.offBucket[weekdayIdx(P, d)]; if (ob >= 0) counts[t][ob]++ }
        else { A.shift[t][d] = S.D; workingOn[d]++ }
      }
    }
  }

  // ---- 2. weekend / holiday blocks
  const carriedPrev = (b: number, t: number): boolean => {
    if (b <= 0) return false
    const prev = P.blocks[b - 1]
    for (let ri = 0; ri < P.roles.length; ri++) {
      if (!P.roleIsWeekend[ri]) continue
      if (holdsRole(P, A, ri, prev.days[0], t)) return true
    }
    if (P.fridayRole >= 0 && prev.fridayDay >= 0 && holdsRole(P, A, P.fridayRole, prev.fridayDay, t)) return true
    return false
  }
  for (const blk of P.blocks) {
    const bucket = blk.kind === 'holiday' ? bHoliday : bWeekend
    P.roles.forEach((r, ri) => {
      if (!P.roleIsWeekend[ri]) return
      const per = r.perDay
      for (let s = 0; s < per; s++) {
        if (A.role[ri][blk.days[0] * per + s] >= 0) continue
        let best = -1, bestS = Infinity
        for (let t = 0; t < P.nT; t++) {
          if (!P.eligible[ri][t]) continue
          if (blk.days.some(d => P.fixedShift[t][d] >= 0 || P.locked[t][d])) continue
          let taken = false
          for (let s2 = 0; s2 < per; s2++) if (A.role[ri][blk.days[0] * per + s2] === t) taken = true
          if (taken) continue
          let sc = debt(P, counts, t, bucket) + 0.5 * debt(P, counts, t, bucket === bWeekend ? bHoliday : bWeekend) + rng.next() * 0.1
          if (carriedPrev(blk.idx, t)) sc += 3
          if (sc < bestS) { bestS = sc; best = t }
        }
        if (best >= 0) { for (const d of blk.days) A.role[ri][d * per + s] = best; counts[best][bucket]++ }
      }
    })
  }

  // ---- 3. weekday roles: Friday derived-weekend role first, then everything else day by day
  const assignWeekdayRole = (ri: number, d: number) => {
    const r = P.roles[ri], per = r.perDay
    const b = P.buckets.indexOf(r.id)
    const isDerivedFriday = ri === P.fridayRole && P.days[d].weekday === 'Fri'
    const blkAfter = d + 1 < P.nD ? P.blockOfDay[d + 1] : -1
    for (let s = 0; s < per; s++) {
      if (A.role[ri][d * per + s] >= 0) continue
      let best = -1, bestS = Infinity
      for (let t = 0; t < P.nT; t++) {
        if (!P.eligible[ri][t] || !isWorking(A.shift[t][d]) || P.locked[t][d]) continue
        if (holdsAnyWeekdayRole(P, A, d, t)) continue
        let sc = debt(P, counts, t, b) + rng.next() * 0.1
        if (isDerivedFriday) {
          sc += 2 * debt(P, counts, t, bWeekend)
          if (blkAfter >= 0) {
            for (let ri2 = 0; ri2 < P.roles.length; ri2++) if (P.roleIsWeekend[ri2] && holdsRole(P, A, ri2, P.blocks[blkAfter].days[0], t)) sc += 5
            if (carriedPrev(blkAfter, t)) sc += 3
          }
        }
        if (d > 0 && P.isLabDay[d - 1] && holdsRole(P, A, ri, d - 1, t)) sc += 1.5
        if (sc < bestS) { bestS = sc; best = t }
      }
      if (best >= 0) { A.role[ri][d * per + s] = best; if (b >= 0) counts[best][b]++; if (isDerivedFriday) counts[best][bWeekend]++ }
    }
  }
  if (P.fridayRole >= 0) for (let d = 0; d < P.nD; d++) if (P.isLabDay[d] && P.days[d].weekday === 'Fri') assignWeekdayRole(P.fridayRole, d)
  for (let d = 0; d < P.nD; d++) {
    if (!P.isLabDay[d]) continue
    for (let ri = 0; ri < P.roles.length; ri++) if (!P.roleIsWeekend[ri]) assignWeekdayRole(ri, d)
  }

  // ---- 4. late slots
  for (let d = 0; d < P.nD; d++) {
    if (!P.isLabDay[d]) continue
    let have = 0
    for (let t = 0; t < P.nT; t++) if (A.shift[t][d] === S.L) have++
    const w = P.days[d].week
    while (have < P.lateSlots[d]) {
      let best = -1, bestS = Infinity
      for (let t = 0; t < P.nT; t++) {
        if (A.shift[t][d] !== S.D || P.locked[t][d] || !P.canLate[t]) continue
        let sc = debt(P, counts, t, bLate) + rng.next() * 0.1
        if (P.avoidLate[t]) sc += 4
        for (const d2 of P.labDaysInWeek[w]) if (A.shift[t][d2] === S.L) sc += 2
        if (sc < bestS) { bestS = sc; best = t }
      }
      if (best < 0) break
      A.shift[best][d] = S.L; counts[best][bLate]++; have++
    }
  }
}
