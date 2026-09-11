// Web Worker: solves every lab for a month off the main thread.
import type { AppData, Cell, MonthDoc } from '../domain/types'
import { solveLab } from './solve'

export interface SolveRequest { type: 'solve'; data: AppData; month: MonthDoc; iterations: number; labIds?: string[] }
export interface ProgressMsg { type: 'progress'; labId: string; iter: number; best: number }
export interface DoneMsg { type: 'done'; cells: Record<string, Cell> }
export type WorkerOut = ProgressMsg | DoneMsg

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const { data, month, iterations, labIds } = e.data
  const cells: Record<string, Cell> = { ...month.cells }
  for (const lab of data.labs) {
    if (labIds && !labIds.includes(lab.id)) continue
    const res = solveLab(data, lab, month, {
      iterations,
      onProgress: (iter, best) => (self as any).postMessage({ type: 'progress', labId: lab.id, iter, best } satisfies ProgressMsg),
    })
    Object.assign(cells, res.cells)
  }
  ;(self as any).postMessage({ type: 'done', cells } satisfies DoneMsg)
}
