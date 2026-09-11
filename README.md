# Lab Scheduler

Fair monthly staffing for a multi-lab neurodiagnostics department (main lab, peds lab, EMU lab).
Local web app: all data lives in the browser's storage, nothing leaves the machine. Exports the
finished month as an Excel workbook.

## What it does

- Holds each lab's rules: open days, days/week (5 vs 4), minimum coverage, late-shift seats,
  on-call roles (primary / backup / weekend), and special rules such as "Friday backup becomes
  the weekend IONM on-call".
- Holds each tech: full/part-time, days per week, which roles they can take, late-shift
  eligibility, preferred day off.
- The scheduler paints PTO, unavailable days, and off/on requests onto the month grid, then
  hits **Generate**. A solver (greedy build + simulated annealing, in a Web Worker) fills the
  month so that weekend call, holiday call, primary/backup call, late shifts, and Monday/Friday
  off-days are spread evenly, **counting each tech's history from previous months**.
- Any cell can be hand-edited. Edited cells lock and survive re-generation. Every edit is
  re-scored live: broken rules show as red-outlined cells and a warning list.
- **Commit month** rolls the month's counts into each tech's history, so next month balances
  against it.
- Export: one Excel sheet per lab, an on-call calendar, the fairness table, and warnings.
  JSON backup/restore moves the whole dataset between machines.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm test           # solver + export tests
npm run build      # static build in dist/ (open dist/index.html via any static server)
```

## Layout

```
src/domain/    types, calendar, problem (array model), score (penalties + hard rules), history
src/solver/    greedy construction, annealing moves, seeded rng, worker entry
src/storage/   localStorage, JSON import/export, Excel writer
src/ui/        React screens: Schedule (grid + editor), Setup, Export & History
src/seed.ts    default three-lab template
test/          vitest
```

## Rules the solver never breaks

PTO/unavailable days stay off; nobody works on a closed day; nobody exceeds their weekly
days; a weekday on-call role goes only to an eligible tech who is in the lab that day; one tech
never holds two on-call roles on the same day; late seats are never oversubscribed; a weekend
call block stays with one person; locked cells are untouched.

## Soft rules (weighted, editable per lab in Setup)

Unfilled call slot, coverage shortfall, unfilled late seat, fairness spread per bucket (squared,
history included), back-to-back weekend call, same tech primary on consecutive days, late twice
in a week, preferred off-day missed, avoid-late violated, under-scheduled, request denied,
weekly off-day not on a rotation day.
