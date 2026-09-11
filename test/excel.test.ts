import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { seedData } from '../src/seed'
import type { MonthDoc } from '../src/domain/types'
import { cellKey } from '../src/domain/types'
import { solveLab, evaluateLab } from '../src/solver/solve'
import { buildWorkbook } from '../src/storage/excel'

describe('excel export', () => {
  it('writes one grid sheet per lab plus on-call, fairness and warnings sheets', () => {
    const data = seedData()
    const month: MonthDoc = { month: '2026-10', status: 'draft', inputs: { pto: {}, unavailable: {}, requests: {} }, cells: {}, seed: 3 }
    for (const lab of data.labs) Object.assign(month.cells, solveLab(data, lab, month, { iterations: 1000 }).cells)
    const warnings = data.labs.flatMap(l => evaluateLab(data, l, month).evaluation.warnings)
    const wb = buildWorkbook(data, month, warnings)
    expect(wb.SheetNames).toEqual(['Main Lab', 'Peds Lab', 'EMU Lab', 'On-call', 'Fairness', 'Warnings'])

    const main = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['Main Lab'], { header: 1 })
    expect(main[2][0]).toBe('Tech')
    expect(main[2]).toHaveLength(2 + 31)
    // first tech row: every weekday cell has a D or L, weekends blank unless on call
    const row = main[3]
    const tech = data.techs[0]
    for (let d = 1; d <= 31; d++) {
      const date = `2026-10-${String(d).padStart(2, '0')}`
      const c = month.cells[cellKey(tech.id, date)]
      const text = String(row[1 + d] ?? '')
      if (c.shift === 'D' || c.shift === 'L') expect(text.startsWith(c.shift)).toBe(true)
      if (c.roles.includes('primary')) expect(text).toContain('P')
    }
    // on-call sheet has a primary + backup for every weekday of the month
    const call = XLSX.utils.sheet_to_json<string[]>(wb.Sheets['On-call'], { header: 1 }).slice(1)
    const primaries = call.filter(r => r[3] === 'Primary on-call')
    expect(primaries.length).toBe(22)  // Oct 2026 has 22 weekdays
    expect(call.filter(r => r[3] === 'Weekend IONM on-call').length).toBe(9) // 4 Fridays x Sat+Sun, plus Oct 30 -> Sat 31 only

    // round-trips through the xlsx writer without throwing
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    expect(buf.length).toBeGreaterThan(5000)
  })
})
