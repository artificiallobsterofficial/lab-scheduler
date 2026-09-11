import type { AppData } from '../domain/types'
import { DEFAULT_WEIGHTS } from '../domain/types'
import { seedData } from '../seed'

const KEY = 'lab-scheduler:data'

/** Fill in any settings added after the data was saved. */
export function migrate(data: AppData): AppData {
  return {
    ...data,
    holidays: data.holidays ?? [],
    months: data.months ?? {},
    labs: data.labs.map(l => ({ ...l, weights: { ...DEFAULT_WEIGHTS, ...l.weights } })),
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppData
      if (parsed && parsed.version === 1 && Array.isArray(parsed.labs)) return migrate(parsed)
    }
  } catch { /* fall through to seed */ }
  return seedData()
}

export function saveData(data: AppData) {
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch (e) { console.error('save failed', e) }
}

export function resetData(): AppData {
  const d = seedData()
  saveData(d)
  return d
}

export function exportJson(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function importJson(text: string): AppData {
  const parsed = JSON.parse(text) as AppData
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.labs) || !Array.isArray(parsed.techs)) throw new Error('Not a lab-scheduler backup file')
  return migrate(parsed)
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
