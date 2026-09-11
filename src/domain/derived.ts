// Derived (not stored) markers: e.g. Friday backup -> weekend IONM call, shown on the following block's days.
import type { AppData, LabConfig, MonthDoc } from './types'
import { cellKey } from './types'
import { buildProblem } from './problem'

/** Map of cellKey -> derived role code for every date where the derived weekend call applies. */
export function derivedMarkers(data: AppData, lab: LabConfig, month: MonthDoc): Record<string, string> {
  const out: Record<string, string> = {}
  const fr = lab.fridayRoleBecomesWeekendCall
  if (!fr.enabled) return out
  const P = buildProblem(data, lab, month)
  for (const blk of P.blocks) {
    if (blk.fridayDay < 0 || P.days[blk.fridayDay].weekday !== 'Fri') continue
    const friDate = P.days[blk.fridayDay].date
    for (const t of P.techs) {
      const c = month.cells[cellKey(t.id, friDate)]
      if (!c?.roles.includes(fr.roleId)) continue
      for (const d of blk.days) out[cellKey(t.id, P.days[d].date)] = fr.code
    }
  }
  return out
}
