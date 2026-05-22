import type { Machine, Site } from "@/domain/types";
import type { MachineryUnitType } from "@/lib/machinery-unit-types";
import { formatQtyWithUnit, normalizeMachineryUnitType } from "@/lib/machinery-unit-types";

export type SiteClosureAction = "available" | "maintenance" | "relocate" | "lost_damaged";

export type SiteClosureUnit = {
  id: string;
  code: string;
  name: string;
};

export type SiteClosureGroup = {
  key: string;
  label: string;
  category: string;
  unitType: MachineryUnitType;
  machineIds: string[];
  units: SiteClosureUnit[];
  count: number;
};

/** Max remainder units shown one-by-one; above this, one action applies to all remaining units. */
export const SITE_CLOSURE_DETAILED_REMAINDER_MAX = 10;

/** Strip trailing unit numbers so "Ladder 1" and "Ladder 2" group together. */
export function machineryNameGroupKey(name: string): string {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*?)(\d+)\s*$/);
  return match ? match[1].trimEnd() : trimmed;
}

export function machineryGroupDisplayLabel(nameGroupKey: string, category: string): string {
  const base = nameGroupKey.trim();
  if (base.length > 0) return base;
  return category;
}

export function usesContinuousQuantity(unitType: MachineryUnitType | string): boolean {
  const unit = normalizeMachineryUnitType(unitType);
  return unit !== "nos" && unit !== "set" && unit !== "pair" && unit !== "box";
}

export function formatSiteClosureGroupQty(count: number, unitType: MachineryUnitType | string): string {
  return formatQtyWithUnit(count, unitType) || String(count);
}

export type SiteClosureDisposition = {
  machineIds: string[];
  label: string;
  action: SiteClosureAction;
  relocateSiteId?: string;
  remarks?: string;
};

export type ClosureUnitState = {
  action: SiteClosureAction;
  relocateSiteId: string;
  remarks: string;
};

export type ClosureQtyLine = ClosureUnitState & { qty: number };

const defaultUnitState = (): ClosureUnitState => ({
  action: "available",
  relocateSiteId: "",
  remarks: "",
});

export function groupSiteMachinery(machines: Machine[], siteId: string): SiteClosureGroup[] {
  const atSite = machines.filter((m) => m.assignedSiteId === siteId);
  const grouped = new Map<
    string,
    {
      label: string;
      category: string;
      unitType: MachineryUnitType;
      machineIds: string[];
      units: SiteClosureUnit[];
    }
  >();
  const sorted = [...atSite].sort((a, b) => a.code.localeCompare(b.code));

  for (const machine of sorted) {
    const nameKey = machineryNameGroupKey(machine.name);
    const unitType = normalizeMachineryUnitType(machine.unitType);
    const key = `${nameKey}::${machine.category}::${unitType}`;
    const entry = grouped.get(key) ?? {
      label: machineryGroupDisplayLabel(nameKey, machine.category),
      category: machine.category,
      unitType,
      machineIds: [],
      units: [],
    };
    entry.machineIds.push(machine.id);
    entry.units.push({ id: machine.id, code: machine.code, name: machine.name });
    grouped.set(key, entry);
  }

  return Array.from(grouped.entries()).map(([key, entry]) => ({
    key,
    label: entry.label,
    category: entry.category,
    unitType: entry.unitType,
    machineIds: entry.machineIds,
    units: entry.units,
    count: entry.machineIds.length,
  }));
}

export function initialClosureUnitState(groups: SiteClosureGroup[]): Record<string, ClosureUnitState> {
  const state: Record<string, ClosureUnitState> = {};
  for (const group of groups) {
    for (const unit of group.units) {
      state[unit.id] = defaultUnitState();
    }
  }
  return state;
}

export function initialClosureQtyLines(groups: SiteClosureGroup[]): Record<string, ClosureQtyLine[]> {
  const lines: Record<string, ClosureQtyLine[]> = {};
  for (const group of groups) {
    lines[group.key] = [{ qty: group.count, ...defaultUnitState() }];
  }
  return lines;
}

export function closureUnitStateValid(state: ClosureUnitState): boolean {
  if (state.action === "relocate") return Boolean(state.relocateSiteId);
  return true;
}

export function closureQtyLinesValid(lines: ClosureQtyLine[], total: number): boolean {
  if (lines.length === 0 || total === 0) return lines.length === 0;
  const sum = lines.reduce((s, line) => s + line.qty, 0);
  if (sum !== total) return false;
  return lines.every((line) => line.qty >= 1 && closureUnitStateValid(line));
}

export function summarizeClosureActions(
  items: { action: SiteClosureAction; qty: number }[],
): string {
  const counts = new Map<SiteClosureAction, number>();
  for (const { action, qty } of items) {
    counts.set(action, (counts.get(action) ?? 0) + qty);
  }
  const order: SiteClosureAction[] = ["available", "maintenance", "relocate", "lost_damaged"];
  const parts = order
    .filter((action) => (counts.get(action) ?? 0) > 0)
    .map((action) => {
      const n = counts.get(action)!;
      const short =
        action === "available"
          ? "available"
          : action === "maintenance"
            ? "maintenance"
            : action === "relocate"
              ? "relocate"
              : "lost / damaged";
      return `${n} ${short}`;
    });
  return parts.length ? parts.join(", ") : "—";
}

export function buildDispositionsFromUnitState(
  groups: SiteClosureGroup[],
  unitState: Record<string, ClosureUnitState>,
): SiteClosureDisposition[] {
  const dispositions: SiteClosureDisposition[] = [];

  for (const group of groups) {
    const buckets = new Map<
      string,
      { machineIds: string[]; action: SiteClosureAction; relocateSiteId?: string; remarks?: string }
    >();

    for (const unit of group.units) {
      const state = unitState[unit.id] ?? defaultUnitState();
      const bucketKey = `${state.action}::${state.relocateSiteId}::${state.remarks.trim()}`;
      const bucket = buckets.get(bucketKey) ?? {
        machineIds: [],
        action: state.action,
        relocateSiteId: state.action === "relocate" ? state.relocateSiteId : undefined,
        remarks: state.action === "lost_damaged" ? state.remarks.trim() || undefined : undefined,
      };
      bucket.machineIds.push(unit.id);
      buckets.set(bucketKey, bucket);
    }

    for (const bucket of buckets.values()) {
      dispositions.push({
        machineIds: bucket.machineIds,
        label: group.label,
        action: bucket.action,
        relocateSiteId: bucket.relocateSiteId,
        remarks: bucket.remarks,
      });
    }
  }

  return dispositions;
}

export function buildDispositionsFromQtyLines(
  groups: SiteClosureGroup[],
  qtyLines: Record<string, ClosureQtyLine[]>,
): SiteClosureDisposition[] {
  const dispositions: SiteClosureDisposition[] = [];

  for (const group of groups) {
    const lines = qtyLines[group.key] ?? [];
    let offset = 0;
    for (const line of lines) {
      if (line.qty < 1) continue;
      const machineIds = group.machineIds.slice(offset, offset + line.qty);
      offset += line.qty;
      if (machineIds.length === 0) continue;
      dispositions.push({
        machineIds,
        label: group.label,
        action: line.action,
        relocateSiteId: line.action === "relocate" ? line.relocateSiteId : undefined,
        remarks: line.action === "lost_damaged" ? line.remarks.trim() || undefined : undefined,
      });
    }
  }

  return dispositions;
}

export function relocationSiteOptions(sites: Site[], closingSiteId: string): Site[] {
  return sites.filter((s) => s.id !== closingSiteId && s.status === "active");
}

export const CLOSURE_ACTION_LABELS: Record<SiteClosureAction, string> = {
  available: "Mark available",
  maintenance: "Send to maintenance",
  relocate: "Relocate to another site",
  lost_damaged: "Mark lost / damaged",
};

/** Plain-language labels for site-finish UI */
export const CLOSURE_ACTION_SIMPLE: Record<SiteClosureAction, string> = {
  available: "Back in company pool",
  maintenance: "Needs repair (maintenance)",
  relocate: "Moving to another site",
  lost_damaged: "Lost or damaged",
};

export type SimpleClosureGroupState = {
  /** Units returning to the company pool as available */
  availableCount: number;
  /** Per-unit disposition for remainder (when count is small enough to show individually) */
  remainderByUnitId: Record<string, ClosureUnitState>;
  /** Bulk action for all remainder units when the group is large */
  otherAction: SiteClosureAction;
  relocateSiteId: string;
  remarks: string;
};

function defaultRemainderUnitStates(group: SiteClosureGroup): Record<string, ClosureUnitState> {
  const states: Record<string, ClosureUnitState> = {};
  for (const unit of group.units) {
    states[unit.id] = { ...defaultUnitState(), action: "lost_damaged" };
  }
  return states;
}

export function remainderUnitsForGroup(group: SiteClosureGroup, availableCount: number): SiteClosureUnit[] {
  return group.units.slice(Math.max(0, Math.min(availableCount, group.count)));
}

export function usesDetailedRemainderClosure(restCount: number): boolean {
  return restCount > 0 && restCount <= SITE_CLOSURE_DETAILED_REMAINDER_MAX;
}

export function initialSimpleClosureState(groups: SiteClosureGroup[]): Record<string, SimpleClosureGroupState> {
  const state: Record<string, SimpleClosureGroupState> = {};
  for (const group of groups) {
    state[group.key] = {
      availableCount: group.count,
      remainderByUnitId: defaultRemainderUnitStates(group),
      otherAction: "lost_damaged",
      relocateSiteId: "",
      remarks: "",
    };
  }
  return state;
}

export function simpleClosureStateValid(
  state: SimpleClosureGroupState,
  total: number,
  group?: SiteClosureGroup,
): boolean {
  if (state.availableCount < 0 || state.availableCount > total) return false;
  const rest = total - state.availableCount;
  if (rest === 0) return true;
  if (usesDetailedRemainderClosure(rest) && group) {
    const remainderUnits = remainderUnitsForGroup(group, state.availableCount);
    return remainderUnits.every((unit) =>
      closureUnitStateValid(state.remainderByUnitId[unit.id] ?? defaultUnitState()),
    );
  }
  return closureUnitStateValid({
    action: state.otherAction,
    relocateSiteId: state.relocateSiteId,
    remarks: state.remarks,
  });
}

export function simpleStateToQtyLines(
  group: SiteClosureGroup,
  state: SimpleClosureGroupState,
): ClosureQtyLine[] {
  const lines: ClosureQtyLine[] = [];
  if (state.availableCount > 0) {
    lines.push({
      qty: state.availableCount,
      action: "available",
      relocateSiteId: "",
      remarks: "",
    });
  }
  const rest = group.count - state.availableCount;
  if (rest <= 0) return lines;

  if (usesDetailedRemainderClosure(rest)) {
    const remainderUnits = remainderUnitsForGroup(group, state.availableCount);
    const buckets = new Map<string, ClosureQtyLine>();
    for (const unit of remainderUnits) {
      const unitState = state.remainderByUnitId[unit.id] ?? defaultUnitState();
      const bucketKey = `${unitState.action}::${unitState.relocateSiteId}::${unitState.remarks.trim()}`;
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.qty += 1;
      } else {
        buckets.set(bucketKey, { qty: 1, ...unitState });
      }
    }
    lines.push(...buckets.values());
    return lines;
  }

  lines.push({
    qty: rest,
    action: state.otherAction,
    relocateSiteId: state.otherAction === "relocate" ? state.relocateSiteId : "",
    remarks: state.otherAction === "lost_damaged" ? state.remarks : "",
  });
  return lines;
}

export function summarizeSimpleClosure(
  state: SimpleClosureGroupState,
  total: number,
  unitType?: MachineryUnitType | string,
  group?: SiteClosureGroup,
): string {
  const qty = (n: number) => (unitType ? formatSiteClosureGroupQty(n, unitType) : String(n));
  const rest = total - state.availableCount;
  if (rest === 0) return `All ${qty(total)} back in pool`;
  if (usesDetailedRemainderClosure(rest) && group) {
    const remainderUnits = remainderUnitsForGroup(group, state.availableCount);
    const items = remainderUnits.map(
      (unit) => state.remainderByUnitId[unit.id]?.action ?? "lost_damaged",
    );
    const detail = summarizeClosureActions(
      items.map((action) => ({ action, qty: 1 })),
    );
    if (state.availableCount === 0) return detail;
    return `${qty(state.availableCount)} in pool · remainder: ${detail}`;
  }
  if (state.availableCount === 0) {
    return `${qty(total)} → ${CLOSURE_ACTION_SIMPLE[state.otherAction].toLowerCase()}`;
  }
  const other = CLOSURE_ACTION_SIMPLE[state.otherAction].toLowerCase();
  return `${qty(state.availableCount)} in pool, ${qty(rest)} ${other}`;
}
