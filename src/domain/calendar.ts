import type { Weekday } from './types'
import { WEEKDAYS } from './types'

export interface DayInfo {
  idx: number
  date: string        // YYYY-MM-DD
  dom: number         // day of month, 1-based
  weekday: Weekday
  isWeekend: boolean
  isHoliday: boolean
  week: number        // Mon-Sun block index within the month, 0-based
}

export const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n)

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sun
  return WEEKDAYS[(js + 6) % 7]
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

export function monthDays(month: string, holidays: string[]): DayInfo[] {
  const n = daysInMonth(month)
  const hol = new Set(holidays)
  const out: DayInfo[] = []
  let week = 0
  for (let dom = 1; dom <= n; dom++) {
    const date = `${month}-${pad2(dom)}`
    const wd = weekdayOf(date)
    if (dom > 1 && wd === 'Mon') week++
    out.push({
      idx: dom - 1, date, dom, weekday: wd,
      isWeekend: wd === 'Sat' || wd === 'Sun',
      isHoliday: hol.has(date),
      week,
    })
  }
  return out
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`
}
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function todayMonth(): string {
  const t = new Date()
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}`
}
