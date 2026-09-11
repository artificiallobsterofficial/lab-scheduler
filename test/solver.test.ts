import { describe, it, expect } from 'vitest'
import { seedData } from '../src/seed'
import type { AppData, MonthDoc } from '../src/domain/types'
import { cellKey } from '../src/domain/types'
import { solveLab, evaluateLab } from '../src/solver/solve'
import { commitMonth, fairnessRows } from '../src/domain/history'
import { monthDays } from '../src/domain/calendar'
import { makeRng } from '../src/solver/rng'

function blankMonth(month: string, seed = 7): MonthDoc {
  return { month, status: 'draft', inputs: { pto: {}, unavailable: {}, requests: {} }, cells: {}, seed }
}

function randomPto(data: AppData, month: MonthDoc, seed: number) {
  const rng = makeRng(seed)
  const days = monthDays(month.month, data.holidays)
  for (const t of data.techs) {
    if (rng.next() < 0.5) {
      const start = rng.int(days.length - 3)
      month.inputs.pto[t.id] = [days[start].date, days[start + 1].date, days[start + 2].date]
    }
    if (rng.next() < 0.3) {
      const d = days[rng.int(days.length)]
      month.inputs.requests[t.id] = { [d.date]: rng.next() < 0.5 ? 'OFF' : 'ON' }
    }
  }
}

const ITER = 6000

describe('solver hard constraints', () => {
  for (const seed of [1, 2, 3]) {
    it(`no hard violations for every lab, seed ${seed}`, () => {
      const data = seedData()
      data.holidays = ['2026-10-12']
      const month = blankMonth('2026-10', seed)
      randomPto(data, month, seed)
      for (const lab of data.labs) {
        const res = solveLab(data, lab, month, { iterations: ITER })
        expect(res.evaluation.hard, `${lab.id}: ${res.evaluation.warnings.filter(w => w.hard).map(w => w.msg).join('; ')}`).toBe(0)
        // every weekday role slot filled, every weekend block filled
        const unfilled = res.evaluation.warnings.filter(w => w.kind === 'UNFILLED_ROLE')
        expect(unfilled, unfilled.map(w => `${w.date} ${w.msg}`).join('; ')).toHaveLength(0)
        // PTO cells stay PTO
        for (const [tid, dates] of Object.entries(month.inputs.pto)) {
          const tech = data.techs.find(t => t.id === tid)!
          if (tech.labId !== lab.id) continue
          for (const d of dates) expect(res.cells[cellKey(tid, d)].shift).toBe('PTO')
        }
      }
    })
  }

  it('main lab: FT techs work every lab day they are not on PTO; PT techs hit their target', () => {
    const data = seedData()
    const month = blankMonth('2026-11', 5)
    const main = data.labs[0]
    const res = solveLab(data, main, month, { iterations: ITER })
    const P = res.problem
    P.techs.forEach((t, ti) => {
      for (let w = 0; w < P.weeks.length; w++) {
        const worked = P.labDaysInWeek[w].filter(d => ['D', 'L'].includes(res.cells[cellKey(t.id, P.days[d].date)].shift)).length
        expect(worked, `${t.name} week ${w}`).toBe(P.workTarget[ti][w])
      }
    })
  })

  it('locked cells survive re-solve', () => {
    const data = seedData()
    const month = blankMonth('2026-11', 9)
    const main = data.labs[0]
    const first = solveLab(data, main, month, { iterations: 2000 })
    month.cells = first.cells
    // lock a Friday backup holder and a Monday off (make PT tech off Monday)
    const fri = '2026-11-06'
    const holder = data.techs.find(t => first.cells[cellKey(t.id, fri)]?.roles.includes('backup'))!
    month.cells[cellKey(holder.id, fri)] = { shift: 'D', roles: ['primary'], locked: true }
    const second = solveLab(data, main, month, { iterations: 2000, seed: 99 })
    expect(second.cells[cellKey(holder.id, fri)]).toEqual({ shift: 'D', roles: ['primary'], locked: true })
    expect(second.evaluation.hard).toBe(0)
    // nobody else is primary that Friday
    const primaries = data.techs.filter(t => second.cells[cellKey(t.id, fri)]?.roles.includes('primary'))
    expect(primaries).toHaveLength(1)
  })
})

describe('fairness', () => {
  it('weekend call and primary spread within +-1 across eligible FT techs in the main lab', () => {
    const data = seedData()
    const month = blankMonth('2026-10', 11)
    const main = data.labs[0]
    const res = solveLab(data, main, month, { iterations: 15000 })
    month.cells = res.cells
    const { buckets, rows } = fairnessRows(data, 'main', month)
    for (const b of ['weekendCall', 'primary', 'backup']) {
      const bi = buckets.indexOf(b)
      const vals = rows.filter(r => r.tech.eligible[b] || (b === 'weekendCall' && r.tech.eligible.weekend)).map(r => r.month[bi])
      expect(Math.max(...vals) - Math.min(...vals), `${b}: ${vals.join(',')}`).toBeLessThanOrEqual(1)
    }
  })

  it('4-day lab: weekly off-days land on Mon/Fri and rotate evenly among full-timers', () => {
    const data = seedData()
    const month = blankMonth('2026-09', 5)
    const peds = data.labs[1]
    const res = solveLab(data, peds, month, { iterations: 15000 })
    month.cells = res.cells
    // in every full week, each FT tech's single off-day is a Monday or Friday
    const P = res.problem
    for (let w = 0; w < P.weeks.length; w++) {
      if (P.labDaysInWeek[w].length < 5) continue
      for (const t of P.techs.filter(t => t.employment === 'FT')) {
        const offs = P.labDaysInWeek[w].filter(d => res.cells[cellKey(t.id, P.days[d].date)].shift === 'OFF').map(d => P.days[d].weekday)
        expect(offs, `${t.name} week ${w}`).toHaveLength(1)
        expect(['Mon', 'Fri']).toContain(offs[0])
      }
    }
    const { buckets, rows } = fairnessRows(data, 'peds', month)
    const mon = buckets.indexOf('off_Mon'), fri = buckets.indexOf('off_Fri')
    for (const r of rows.filter(r => r.tech.employment === 'FT')) {
      expect(Math.abs(r.month[mon] - r.month[fri]), r.tech.name).toBeLessThanOrEqual(1)
    }
  })

  it('history carry-forward: a tech who did extra weekends last month gets fewer this month', () => {
    const data = seedData()
    const main = data.labs[0]
    const heavy = data.techs[0]
    heavy.history = { weekendCall: 4, primary: 0, backup: 0 }   // everyone else 0
    const month = blankMonth('2026-10', 3)
    const res = solveLab(data, main, month, { iterations: 15000 })
    month.cells = res.cells
    const { buckets, rows } = fairnessRows(data, 'main', month)
    const bi = buckets.indexOf('weekendCall')
    const heavyRow = rows.find(r => r.tech.id === heavy.id)!
    const others = rows.filter(r => r.tech.id !== heavy.id && r.tech.eligible.weekend).map(r => r.month[bi])
    expect(heavyRow.month[bi]).toBeLessThan(Math.max(...others))
  })

  it('commitMonth rolls counts into history and marks the month committed', () => {
    const data = seedData()
    const month = blankMonth('2026-10', 3)
    for (const lab of data.labs) Object.assign(month.cells, solveLab(data, lab, month, { iterations: 500 }).cells)
    const after = commitMonth(data, month)
    expect(after.months['2026-10'].status).toBe('committed')
    const totalWeekend = after.techs.filter(t => t.labId === 'main').reduce((s, t) => s + (t.history.weekendCall ?? 0), 0)
    // Oct 2026: 5 weekends (WE) + 5 Fridays (derived IONM) = 10
    expect(totalWeekend).toBe(10)
    expect(commitMonth(after, after.months['2026-10'])).toBe(after) // idempotent
  })
})

describe('manual edit re-scoring', () => {
  it('flags a hard violation when a tech is given a role on a day they are off', () => {
    const data = seedData()
    const month = blankMonth('2026-10', 3)
    const main = data.labs[0]
    month.cells = solveLab(data, main, month, { iterations: 500 }).cells
    const t = data.techs[0]
    month.cells[cellKey(t.id, '2026-10-05')] = { shift: 'OFF', roles: ['primary'], locked: true }
    const { evaluation } = evaluateLab(data, main, month)
    expect(evaluation.hard).toBeGreaterThan(0)
    expect(evaluation.warnings.some(w => w.kind === 'ROLE_NOT_WORKING')).toBe(true)
  })
})
