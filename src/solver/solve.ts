// Entry point: solve one lab for one month. Pure (no DOM), usable from the worker and from tests.

import type { AppData, Cell, LabConfig, MonthDoc } from '../domain/types'
import { assignmentFromCells, buildProblem, cellsFromAssignment, type Problem } from '../domain/problem'
import { evaluate, type Evaluation } from '../domain/score'
import { clearUnlocked, greedy } from './greedy'
import { anneal } from './anneal'
import { makeRng } from './rng'

export interface SolveOpts { iterations?: number; seed?: number; onProgress?: (iter: number, best: number) => void }

export interface SolveResult { labId: string; cells: Record<string, Cell>; evaluation: Evaluation; problem: Problem }

export function solveLab(data: AppData, lab: LabConfig, month: MonthDoc, opts: SolveOpts = {}): SolveResult {
  const P = buildProblem(data, lab, month)
  const rng = makeRng(opts.seed ?? month.seed ?? 1)
  const A = assignmentFromCells(P, month)
  clearUnlocked(P, A)
  greedy(P, A, rng)
  const iterations = opts.iterations ?? 40000
  const { best } = anneal(P, A, rng, { iterations, t0: 120, t1: 0.5, onProgress: opts.onProgress })
  const evaluation = evaluate(P, best, true)
  return { labId: lab.id, cells: cellsFromAssignment(P, best, month.cells), evaluation, problem: P }
}

/** Re-score the month as it stands (after manual edits) without solving. */
export function evaluateLab(data: AppData, lab: LabConfig, month: MonthDoc): { evaluation: Evaluation; problem: Problem } {
  const P = buildProblem(data, lab, month)
  const A = assignmentFromCells(P, month)
  return { evaluation: evaluate(P, A, true), problem: P }
}
