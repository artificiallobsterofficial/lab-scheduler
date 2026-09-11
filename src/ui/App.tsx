import { useCallback, useState } from 'react'
import type { AppData, MonthDoc } from '../domain/types'
import { loadData, saveData } from '../storage/localStore'
import { todayMonth } from '../domain/calendar'
import { SetupTab } from './SetupTab'
import { MonthTab } from './MonthTab'
import { ExportTab } from './ExportTab'

export type SetData = (fn: (prev: AppData) => AppData) => void
export type Tab = 'month' | 'setup' | 'export'

export function blankMonth(month: string): MonthDoc {
  return { month, status: 'draft', inputs: { pto: {}, unavailable: {}, requests: {} }, cells: {}, seed: Math.floor(Math.random() * 1e9) }
}
export function getMonthDoc(data: AppData, month: string): MonthDoc {
  return data.months[month] ?? blankMonth(month)
}

export function App() {
  const [data, setDataRaw] = useState<AppData>(loadData)
  const [tab, setTab] = useState<Tab>('month')
  const [month, setMonth] = useState<string>(todayMonth())
  const setData: SetData = useCallback(fn => setDataRaw(prev => { const next = fn(prev); saveData(next); return next }), [])

  return (
    <>
      <div className="topbar">
        <h1>Lab Scheduler</h1>
        <div className="tabs">
          {(['month', 'setup', 'export'] as Tab[]).map(t => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'month' ? 'Schedule' : t === 'setup' ? 'Setup' : 'Export & History'}
            </button>
          ))}
        </div>
        <span className="muted" style={{ marginLeft: 'auto' }}>Data stays in this browser. Back it up from Export.</span>
      </div>
      <div className="page">
        {tab === 'month' && <MonthTab data={data} setData={setData} month={month} setMonth={setMonth} />}
        {tab === 'setup' && <SetupTab data={data} setData={setData} />}
        {tab === 'export' && <ExportTab data={data} setData={setData} month={month} />}
      </div>
    </>
  )
}
