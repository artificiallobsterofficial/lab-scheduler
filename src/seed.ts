import type { AppData, LabConfig, Tech, Weekday } from './domain/types'
import { DEFAULT_WEIGHTS } from './domain/types'

const MF: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const each = (days: Weekday[], n: number) => Object.fromEntries(days.map(d => [d, n])) as Partial<Record<Weekday, number>>

export function mainLab(): LabConfig {
  return {
    id: 'main', name: 'Main Lab', daysPerWeek: 5, workdays: MF,
    coverageMin: each(MF, 6), lateSlots: each(MF, 1),
    shiftLabels: { D: 'Day 7:30-4:00', L: 'Late 9:30-6:00' },
    roles: [
      { id: 'primary', label: 'Primary on-call', code: 'P', kind: 'weekday', perDay: 1, enabled: true },
      { id: 'backup', label: 'Backup on-call', code: 'B', kind: 'weekday', perDay: 1, enabled: true },
      { id: 'weekend', label: 'Weekend EEG on-call', code: 'WE', kind: 'weekend', perDay: 1, enabled: true },
    ],
    fridayRoleBecomesWeekendCall: { enabled: true, roleId: 'backup', label: 'Weekend IONM on-call', code: 'IONM' },
    rotateOffDay: { enabled: false, candidates: ['Mon', 'Fri'] },
    weights: { ...DEFAULT_WEIGHTS },
  }
}

export function fourDayLab(id: string, name: string): LabConfig {
  return {
    id, name, daysPerWeek: 4, workdays: MF,
    coverageMin: each(MF, 2), lateSlots: each(MF, 0),
    shiftLabels: { D: 'Day 7:30-4:00', L: 'Late 9:30-6:00' },
    roles: [
      { id: 'primary', label: 'Primary on-call', code: 'P', kind: 'weekday', perDay: 1, enabled: false },
      { id: 'backup', label: 'Backup on-call', code: 'B', kind: 'weekday', perDay: 1, enabled: false },
      { id: 'weekend', label: 'Weekend on-call', code: 'WE', kind: 'weekend', perDay: 1, enabled: false },
    ],
    fridayRoleBecomesWeekendCall: { enabled: false, roleId: 'backup', label: 'Weekend call', code: 'WC' },
    rotateOffDay: { enabled: true, candidates: ['Mon', 'Fri'] },
    weights: { ...DEFAULT_WEIGHTS },
  }
}

let counter = 0
export function newId(prefix: string): string {
  counter++
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('') || '??'
}

export function makeTech(labId: string, name: string, employment: 'FT' | 'PT', daysPerWeek: number, roles: string[] = []): Tech {
  const eligible: Record<string, boolean> = { late: true }
  for (const r of roles) eligible[r] = true
  return {
    id: newId('t'), labId, name, initials: initialsOf(name), employment, daysPerWeek,
    eligible, prefs: { avoidLate: false }, history: {}, active: true,
  }
}

/** Default three-lab department with placeholder names. */
export function seedData(): AppData {
  const labs = [mainLab(), fourDayLab('peds', 'Peds Lab'), fourDayLab('emu', 'EMU Lab')]
  const techs: Tech[] = []
  const callRoles = ['primary', 'backup', 'weekend']
  for (let i = 1; i <= 8; i++) techs.push(makeTech('main', `Main FT ${i}`, 'FT', 5, callRoles))
  for (let i = 1; i <= 2; i++) techs.push(makeTech('main', `Main PT ${i}`, 'PT', 3, []))
  for (let i = 1; i <= 3; i++) techs.push(makeTech('peds', `Peds FT ${i}`, 'FT', 4))
  techs.push(makeTech('peds', 'Peds PT 1', 'PT', 2))
  techs.push(makeTech('emu', 'EMU FT 1', 'FT', 4))
  for (let i = 1; i <= 3; i++) techs.push(makeTech('emu', `EMU PT ${i}`, 'PT', 2))
  return { version: 1, labs, techs, holidays: [], months: {} }
}
