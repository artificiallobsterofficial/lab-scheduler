import * as XLSX from 'xlsx'
import type { AppData, MonthDoc, Warning } from '../domain/types'
import { cellKey } from '../domain/types'
import { monthDays, monthLabel } from '../domain/calendar'
import { techsOfLab } from '../domain/problem'
import { derivedMarkers } from '../domain/derived'
import { bucketLabel, fairnessRows } from '../domain/history'

function cellText(shift: string, roleCodes: string[], derived?: string): string {
  const base = shift === 'OFF' ? '' : shift === 'UNAVAIL' ? 'X' : shift
  const extras = [...roleCodes, ...(derived ? [derived] : [])]
  return [base, ...extras].filter(Boolean).join(' ')
}

export function buildWorkbook(data: AppData, month: MonthDoc, warnings: Warning[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const days = monthDays(month.month, data.holidays)
  const title = monthLabel(month.month)

  // one grid sheet per lab
  for (const lab of data.labs) {
    const techs = techsOfLab(data, lab.id)
    const derived = derivedMarkers(data, lab, month)
    const roleCode = new Map(lab.roles.map(r => [r.id, r.code]))
    const header = ['Tech', 'Type', ...days.map(d => `${d.dom} ${d.weekday}${d.isHoliday ? ' (H)' : ''}`)]
    const rows: (string | number)[][] = [[`${lab.name} — ${title}`], [], header]
    for (const t of techs) {
      const row: (string | number)[] = [t.name, `${t.employment} ${t.daysPerWeek}d`]
      for (const d of days) {
        const key = cellKey(t.id, d.date)
        const c = month.cells[key]
        row.push(c ? cellText(c.shift, c.roles.map(r => roleCode.get(r) ?? r), derived[key]) : '')
      }
      rows.push(row)
    }
    rows.push([])
    rows.push(['Legend:', `D = ${lab.shiftLabels.D}`, `L = ${lab.shiftLabels.L}`, 'PTO = paid time off', 'X = unavailable', 'blank = off'])
    for (const r of lab.roles.filter(r => r.enabled)) rows.push(['', `${r.code} = ${r.label}`])
    if (lab.fridayRoleBecomesWeekendCall.enabled) rows.push(['', `${lab.fridayRoleBecomesWeekendCall.code} = ${lab.fridayRoleBecomesWeekendCall.label} (Friday ${roleCode.get(lab.fridayRoleBecomesWeekendCall.roleId)} holder)`])
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 18 }, { wch: 7 }, ...days.map(() => ({ wch: 7 }))]
    XLSX.utils.book_append_sheet(wb, ws, lab.name.slice(0, 31))
  }

  // on-call calendar
  const callRows: string[][] = [['Date', 'Day', 'Lab', 'Role', 'Tech']]
  for (const lab of data.labs) {
    const techs = techsOfLab(data, lab.id)
    const derived = derivedMarkers(data, lab, month)
    for (const d of days) {
      for (const r of lab.roles.filter(r => r.enabled)) {
        for (const t of techs) if (month.cells[cellKey(t.id, d.date)]?.roles.includes(r.id)) callRows.push([d.date, d.weekday, lab.name, r.label, t.name])
      }
      for (const t of techs) if (derived[cellKey(t.id, d.date)]) callRows.push([d.date, d.weekday, lab.name, lab.fridayRoleBecomesWeekendCall.label, t.name])
    }
  }
  const wsCall = XLSX.utils.aoa_to_sheet(callRows)
  wsCall['!cols'] = [{ wch: 12 }, { wch: 5 }, { wch: 12 }, { wch: 24 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, wsCall, 'On-call')

  // fairness
  const fairRows: (string | number)[][] = []
  for (const lab of data.labs) {
    const { buckets, rows } = fairnessRows(data, lab.id, month)
    if (!rows.length) continue
    fairRows.push([lab.name])
    fairRows.push(['Tech', ...buckets.map(b => `${bucketLabel(b, data, lab.id)} (month)`), ...buckets.map(b => `${bucketLabel(b, data, lab.id)} (total)`)])
    for (const r of rows) fairRows.push([r.tech.name, ...r.month, ...r.cumulative])
    fairRows.push([])
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fairRows), 'Fairness')

  // warnings
  const warnRows = [['Date', 'Lab', 'Severity', 'Issue'], ...warnings.map(w => [w.date ?? '', data.labs.find(l => l.id === w.labId)?.name ?? w.labId, w.hard ? 'HARD' : 'soft', w.msg])]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(warnRows), 'Warnings')
  return wb
}

export function downloadWorkbook(data: AppData, month: MonthDoc, warnings: Warning[]) {
  const wb = buildWorkbook(data, month, warnings)
  XLSX.writeFile(wb, `schedule-${month.month}.xlsx`)
}
