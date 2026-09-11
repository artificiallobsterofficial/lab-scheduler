// Pure scoring: soft penalties + hard-violation count. Used by the annealer (hot loop) and the UI.

import type { Warning } from './types'
import { BUCKET } from './types'
import { S, isWorking, weekdayIdx, type Assignment, type Problem } from './problem'

export const HARD_PENALTY = 1_000_000

export interface Evaluation {
  total: number
  soft: number
  hard: number
  parts: Record<string, number>
  counts: number[][]          // [t][b] this-month bucket counts
  warnings: Warning[]
}

/** Per-tech bucket counts for the month (also used by the fairness table + history commit). */
export function bucketCounts(P: Problem, A: Assignment): number[][] {
  const nB = P.buckets.length
  const counts = P.techs.map(() => new Array<number>(nB).fill(0))
  const bWeekend = P.buckets.indexOf(BUCKET.weekendCall)
  const bHoliday = P.buckets.indexOf(BUCKET.holidayCall)
  const bLate = P.buckets.indexOf(BUCKET.late)
  // weekday roles
  P.roles.forEach((r, ri) => {
    if (P.roleIsWeekend[ri]) return
    const b = P.buckets.indexOf(r.id)
    for (let d = 0; d < P.nD; d++) for (let s = 0; s < r.perDay; s++) {
      const t = A.role[ri][d * r.perDay + s]
      if (t >= 0) counts[t][b]++
    }
  })
  // weekend / holiday blocks
  for (const blk of P.blocks) {
    const d0 = blk.days[0]
    const bucket = blk.kind === 'holiday' ? bHoliday : bWeekend
    P.roles.forEach((r, ri) => {
      if (!P.roleIsWeekend[ri]) return
      for (let s = 0; s < r.perDay; s++) { const t = A.role[ri][d0 * r.perDay + s]; if (t >= 0) counts[t][bucket]++ }
    })
  }
  // derived Friday -> weekend call
  if (P.fridayRole >= 0) {
    const r = P.fridayRole, per = P.roles[r].perDay
    for (let d = 0; d < P.nD; d++) {
      if (!P.isLabDay[d] || P.days[d].weekday !== 'Fri') continue
      for (let s = 0; s < per; s++) { const t = A.role[r][d * per + s]; if (t >= 0) counts[t][bWeekend]++ }
    }
  }
  // late + off-day rotation
  for (let t = 0; t < P.nT; t++) {
    for (let d = 0; d < P.nD; d++) {
      const sh = A.shift[t][d]
      if (sh === S.L) counts[t][bLate]++
      if (sh === S.OFF && P.isLabDay[d]) { const ob = P.offBucket[weekdayIdx(P, d)]; if (ob >= 0) counts[t][ob]++ }
    }
  }
  return counts
}

/** Who carries call burden for a given block (weekend role holders + derived Friday holder). */
function blockCarriers(P: Problem, A: Assignment, b: number, out: Set<number>) {
  out.clear()
  const blk = P.blocks[b], d0 = blk.days[0]
  P.roles.forEach((r, ri) => {
    if (!P.roleIsWeekend[ri]) return
    for (let s = 0; s < r.perDay; s++) { const t = A.role[ri][d0 * r.perDay + s]; if (t >= 0) out.add(t) }
  })
  if (P.fridayRole >= 0 && blk.fridayDay >= 0 && P.days[blk.fridayDay].weekday === 'Fri') {
    const r = P.fridayRole, per = P.roles[r].perDay
    for (let s = 0; s < per; s++) { const t = A.role[r][blk.fridayDay * per + s]; if (t >= 0) out.add(t) }
  }
}

export function evaluate(P: Problem, A: Assignment, collect = false): Evaluation {
  const W = P.weights
  const parts: Record<string, number> = {}
  const warnings: Warning[] = []
  let hard = 0
  const add = (k: string, v: number) => { parts[k] = (parts[k] ?? 0) + v }
  const warn = (kind: string, msg: string, hardFlag: boolean, d?: number, t?: number) => {
    if (collect) warnings.push({ kind, msg, hard: hardFlag, labId: P.lab.id, date: d !== undefined ? P.days[d].date : undefined, techId: t !== undefined ? P.techs[t].id : undefined })
  }

  for (const o of A.overflow ?? []) { hard++; warn('ROLE_OVERBOOKED', `${P.techs[o.t].name} also holds ${P.roles[o.r].label}, but it has only ${P.roles[o.r].perDay} slot(s)`, true, o.d, o.t) }

  // --- per-day: coverage, late slots, weekday roles
  for (let d = 0; d < P.nD; d++) {
    let working = 0, late = 0
    for (let t = 0; t < P.nT; t++) {
      const sh = A.shift[t][d]
      if (isWorking(sh)) {
        working++
        if (sh === S.L) late++
        if (!P.isLabDay[d]) { hard++; warn('WORK_ON_CLOSED_DAY', `${P.techs[t].name} scheduled on a non-lab day`, true, d, t) }
        if (P.fixedShift[t][d] >= 0) { hard++; warn('WORK_ON_PTO', `${P.techs[t].name} scheduled on PTO/unavailable day`, true, d, t) }
        if (sh === S.L && !P.canLate[t]) { hard++; warn('LATE_NOT_ELIGIBLE', `${P.techs[t].name} is not eligible for late shift`, true, d, t) }
        if (sh === S.L && P.avoidLate[t]) add('avoidLateViolated', W.avoidLateViolated)
      } else if (sh === S.OFF && P.isLabDay[d] && P.rotationEligible[t] && P.offBucket[weekdayIdx(P, d)] < 0) {
        add('offDayNotRotation', W.offDayNotRotation ?? 0)
      }
      const req = P.request[t][d]
      if (req === 1 && isWorking(sh)) { add('requestDenied', W.requestDenied); warn('REQUEST_DENIED', `${P.techs[t].name} asked for this day off`, false, d, t) }
      if (req === 2 && sh === S.OFF && P.isLabDay[d]) { add('requestDenied', W.requestDenied); warn('REQUEST_DENIED', `${P.techs[t].name} asked to work this day`, false, d, t) }
    }
    if (P.isLabDay[d]) {
      if (working < P.coverageMin[d]) { add('coverageShort', W.coverageShort * (P.coverageMin[d] - working)); warn('COVERAGE_SHORT', `Only ${working}/${P.coverageMin[d]} techs in lab`, false, d) }
      if (late < P.lateSlots[d]) { add('unfilledLate', W.unfilledLate * (P.lateSlots[d] - late)); warn('UNFILLED_LATE', `${late}/${P.lateSlots[d]} late slots filled`, false, d) }
      if (late > P.lateSlots[d]) { hard++; warn('TOO_MANY_LATE', `${late} late shifts, only ${P.lateSlots[d]} slots`, true, d) }
    }
    // weekday roles on this day
    P.roles.forEach((r, ri) => {
      if (P.roleIsWeekend[ri]) return
      const per = r.perDay
      for (let s = 0; s < per; s++) {
        const t = A.role[ri][d * per + s]
        if (t < 0) {
          if (P.isLabDay[d]) { add('unfilledRole', W.unfilledRole); warn('UNFILLED_ROLE', `No ${r.label}`, false, d) }
          continue
        }
        if (!P.isLabDay[d]) { hard++; warn('ROLE_ON_CLOSED_DAY', `${r.label} assigned on a non-lab day`, true, d, t) }
        if (!isWorking(A.shift[t][d])) { hard++; warn('ROLE_NOT_WORKING', `${P.techs[t].name} holds ${r.label} but is not in lab`, true, d, t) }
        if (!P.eligible[ri][t]) { hard++; warn('ROLE_NOT_ELIGIBLE', `${P.techs[t].name} not eligible for ${r.label}`, true, d, t) }
        // same tech twice (other weekday roles / other slots)
        for (let ri2 = 0; ri2 < P.roles.length; ri2++) {
          if (P.roleIsWeekend[ri2]) continue
          const per2 = P.roles[ri2].perDay
          for (let s2 = 0; s2 < per2; s2++) {
            if (ri2 === ri && s2 === s) continue
            if (ri2 < ri || (ri2 === ri && s2 < s)) continue
            if (A.role[ri2][d * per2 + s2] === t) { hard++; warn('DOUBLE_ROLE', `${P.techs[t].name} holds two on-call roles the same day`, true, d, t) }
          }
        }
        // consecutive lab days holding the same role
        let nd = d + 1
        while (nd < P.nD && !P.isLabDay[nd]) nd++
        if (nd < P.nD && nd === d + 1) {
          for (let s2 = 0; s2 < per; s2++) if (A.role[ri][nd * per + s2] === t) add('consecutivePrimary', W.consecutivePrimary)
        }
      }
    })
  }

  // --- weekend/holiday blocks
  const carriers = new Set<number>(), prevCarriers = new Set<number>()
  let prevWeekendBlock = -1
  for (const blk of P.blocks) {
    const d0 = blk.days[0]
    P.roles.forEach((r, ri) => {
      if (!P.roleIsWeekend[ri]) return
      const per = r.perDay
      const seen = new Set<number>()
      for (let s = 0; s < per; s++) {
        const t = A.role[ri][d0 * per + s]
        if (t < 0) { add('unfilledRole', W.unfilledRole); warn('UNFILLED_ROLE', `No ${r.label} for ${blk.kind} ${P.days[d0].date}`, false, d0); continue }
        if (!P.eligible[ri][t]) { hard++; warn('ROLE_NOT_ELIGIBLE', `${P.techs[t].name} not eligible for ${r.label}`, true, d0, t) }
        if (seen.has(t)) { hard++; warn('DOUBLE_ROLE', `${P.techs[t].name} holds two ${r.label} slots`, true, d0, t) }
        seen.add(t)
        for (const dd of blk.days) {
          if (P.fixedShift[t][dd] >= 0) { hard++; warn('CALL_ON_PTO', `${P.techs[t].name} on call during PTO/unavailable`, true, dd, t) }
          // block holder must be the same tech on every day of the block
          if (A.role[ri][dd * per + s] !== t) { hard++; warn('BLOCK_SPLIT', `${r.label} changes hands mid-block`, true, dd, t) }
        }
      }
    })
    blockCarriers(P, A, blk.idx, carriers)
    // Friday-derived holder who is also weekend-role holder same block: double burden
    if (P.fridayRole >= 0 && blk.fridayDay >= 0) {
      const r = P.fridayRole, per = P.roles[r].perDay
      for (let s = 0; s < per; s++) {
        const t = A.role[r][blk.fridayDay * per + s]
        if (t < 0) continue
        for (let ri = 0; ri < P.roles.length; ri++) {
          if (!P.roleIsWeekend[ri]) continue
          for (let s2 = 0; s2 < P.roles[ri].perDay; s2++) if (A.role[ri][d0 * P.roles[ri].perDay + s2] === t) { add('consecutiveWeekends', W.consecutiveWeekends); warn('DOUBLE_WEEKEND', `${P.techs[t].name} holds both weekend calls`, false, d0, t) }
        }
      }
    }
    if (blk.kind === 'weekend') {
      if (prevWeekendBlock >= 0) {
        for (const t of carriers) if (prevCarriers.has(t)) { add('consecutiveWeekends', W.consecutiveWeekends); warn('CONSECUTIVE_WEEKENDS', `${P.techs[t].name} on call two weekends in a row`, false, d0, t) }
      }
      prevWeekendBlock = blk.idx
      prevCarriers.clear(); for (const t of carriers) prevCarriers.add(t)
    }
  }

  // --- per tech per week: work target, late twice, preferred off
  for (let t = 0; t < P.nT; t++) {
    for (let w = 0; w < P.weeks.length; w++) {
      let worked = 0, late = 0, offLab = 0, workingPreferred = false
      for (const d of P.labDaysInWeek[w]) {
        const sh = A.shift[t][d]
        if (isWorking(sh)) { worked++; if (sh === S.L) late++; if (weekdayIdx(P, d) === P.preferredOff[t]) workingPreferred = true }
        else if (sh === S.OFF) offLab++
      }
      const target = P.workTarget[t][w]
      if (worked > target) { hard++; warn('OVER_SCHEDULED', `${P.techs[t].name} works ${worked} days, max ${target} (week of ${P.days[P.weeks[w][0]].date})`, true, P.weeks[w][0], t) }
      if (worked < target) { add('underScheduled', W.underScheduled * (target - worked)); warn('UNDER_SCHEDULED', `${P.techs[t].name} works ${worked}/${target} days (week of ${P.days[P.weeks[w][0]].date})`, false, P.weeks[w][0], t) }
      if (late > 1) add('lateTwiceInWeek', W.lateTwiceInWeek * (late - 1))
      if (workingPreferred && offLab > 0) add('preferredOffMissed', W.preferredOffMissed)
    }
  }

  // --- fairness: squared deviation of normalized (history + month) per bucket
  const counts = bucketCounts(P, A)
  let fair = 0
  for (let b = 0; b < P.buckets.length; b++) {
    let n = 0, sum = 0
    const vals: number[] = []
    for (let t = 0; t < P.nT; t++) {
      if (!P.bucketEligible[b][t]) continue
      const v = (P.history[t][b] + counts[t][b]) / P.share[t]
      vals.push(v); sum += v; n++
    }
    if (n < 2) continue
    const mean = sum / n
    let ss = 0
    for (const v of vals) ss += (v - mean) * (v - mean)
    fair += ss
  }
  add('fairness', W.fairness * fair)

  let soft = 0
  for (const v of Object.values(parts)) soft += v
  return { total: soft + hard * HARD_PENALTY, soft, hard, parts, counts, warnings }
}

export const scoreOf = (P: Problem, A: Assignment) => evaluate(P, A, false).total
