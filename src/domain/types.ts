// All persisted shapes. One JSON document (AppData) lives in localStorage.

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'
export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Shift codes stored in a cell. D = day shift, L = late shift. */
export type ShiftCode = 'D' | 'L' | 'OFF' | 'PTO' | 'UNAVAIL'

export interface RoleConfig {
  id: string            // 'primary' | 'backup' | 'weekend' | anything
  label: string         // "Primary on-call"
  code: string          // short code shown in grid / Excel, e.g. "P", "B", "WE"
  kind: 'weekday' | 'weekend'   // weekday roles need the tech in-lab that day; weekend roles cover a Sat-Sun block (and holidays)
  perDay: number        // slots per day (weekday) or per block (weekend)
  enabled: boolean
}

/** Penalty weights. All soft. Editable per lab. */
export interface Weights {
  unfilledRole: number
  coverageShort: number
  unfilledLate: number
  fairness: number
  consecutiveWeekends: number
  consecutivePrimary: number
  lateTwiceInWeek: number
  preferredOffMissed: number
  avoidLateViolated: number
  underScheduled: number
  requestDenied: number
  offDayNotRotation: number
}

export const DEFAULT_WEIGHTS: Weights = {
  offDayNotRotation: 20,
  unfilledRole: 1000,
  coverageShort: 200,
  unfilledLate: 100,
  fairness: 30,
  consecutiveWeekends: 150,
  consecutivePrimary: 40,
  lateTwiceInWeek: 25,
  preferredOffMissed: 15,
  avoidLateViolated: 20,
  underScheduled: 50,
  requestDenied: 30,
}

export const WEIGHT_LABELS: Record<keyof Weights, string> = {
  unfilledRole: 'Unfilled on-call slot',
  coverageShort: 'Coverage below minimum (per head)',
  unfilledLate: 'Unfilled late slot',
  fairness: 'Fairness (squared spread, per bucket)',
  consecutiveWeekends: 'Back-to-back weekend call',
  consecutivePrimary: 'Primary on consecutive days',
  lateTwiceInWeek: 'Same tech late 2+ days in a week',
  preferredOffMissed: 'Preferred off-day not honoured',
  avoidLateViolated: 'Avoid-late preference violated',
  underScheduled: 'Under-scheduled vs days/week',
  requestDenied: 'Soft OFF/ON request denied',
  offDayNotRotation: 'Weekly off-day not on a rotation day (Mon/Fri)',
}

export interface LabConfig {
  id: string
  name: string
  daysPerWeek: number                   // FT days per week (5 main, 4 peds/EMU)
  workdays: Weekday[]                   // days the lab is open
  coverageMin: Partial<Record<Weekday, number>>   // min techs in-lab per weekday
  lateSlots: Partial<Record<Weekday, number>>     // late-shift seats per weekday
  shiftLabels: { D: string; L: string }
  roles: RoleConfig[]
  /** Friday's holder of `roleId` automatically becomes weekend call (derived, shown as `label`). */
  fridayRoleBecomesWeekendCall: { enabled: boolean; roleId: string; label: string; code: string }
  /** For 4-day labs: rotate which weekday is off among candidates and track it as a fairness bucket. */
  rotateOffDay: { enabled: boolean; candidates: Weekday[] }
  weights: Weights
}

export interface Tech {
  id: string
  labId: string
  name: string
  initials: string
  employment: 'FT' | 'PT'
  daysPerWeek: number
  eligible: Record<string, boolean>     // role ids + 'late'
  prefs: { preferredOffDay?: Weekday; avoidLate: boolean }
  /** Cumulative fairness counts by bucket, rolled forward when a month is committed. */
  history: Record<string, number>
  historyAsOf?: string                  // last committed month "YYYY-MM"
  active: boolean
}

export interface Cell {
  shift: ShiftCode
  roles: string[]      // role ids held on this date (weekend roles appear on every date of the block)
  locked: boolean      // manual override; solver never touches
}

export type RequestKind = 'OFF' | 'ON'

export interface MonthInputs {
  pto: Record<string, string[]>           // techId -> dates
  unavailable: Record<string, string[]>   // techId -> dates (hard, not PTO)
  requests: Record<string, Record<string, RequestKind>>  // techId -> date -> kind (soft)
}

export interface MonthDoc {
  month: string                 // "YYYY-MM"
  status: 'draft' | 'committed'
  inputs: MonthInputs
  cells: Record<string, Cell>   // key `${techId}|${date}`
  seed: number
}

export interface AppData {
  version: 1
  labs: LabConfig[]
  techs: Tech[]
  holidays: string[]            // "YYYY-MM-DD"
  months: Record<string, MonthDoc>
}

export const cellKey = (techId: string, date: string) => `${techId}|${date}`

/** Fairness bucket ids that are not role ids. */
export const BUCKET = {
  weekendCall: 'weekendCall',   // weekend-role blocks + derived Friday->weekend call
  holidayCall: 'holidayCall',
  late: 'late',
  friOff: 'friOff',
  monOff: 'monOff',
} as const

export interface ScoreBreakdown {
  total: number
  hardViolations: number
  parts: Record<string, number>
}

export interface Warning {
  date?: string
  labId: string
  techId?: string
  kind: string
  msg: string
  hard: boolean
}
