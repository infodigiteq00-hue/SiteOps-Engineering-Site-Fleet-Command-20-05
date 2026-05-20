import type { Machine, Site } from "@/domain/types";

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
  machineIds: string[];
  units: SiteClosureUnit[];
  count: number;
};

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
    { label: string; category: string; machineIds: string[]; units: SiteClosureUnit[] }
  >();
  const sorted = [...atSite].sort((a, b) => a.code.localeCompare(b.code));

  for (const machine of sorted) {
    const key = `${machine.name}::${machine.category}`;
    const entry = grouped.get(key) ?? {
      label: machine.name,
      category: machine.category,
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
  /** What happens to the remaining units (when availableCount < total) */
  otherAction: SiteClosureAction;
  relocateSiteId: string;
  remarks: string;
};

export function initialSimpleClosureState(groups: SiteClosureGroup[]): Record<string, SimpleClosureGroupState> {
  const state: Record<string, SimpleClosureGroupState> = {};
  for (const group of groups) {
    state[group.key] = {
      availableCount: group.count,
      otherAction: "lost_damaged",
      relocateSiteId: "",
      remarks: "",
    };
  }
  return state;
}

export function simpleClosureStateValid(state: SimpleClosureGroupState, total: number): boolean {
  if (state.availableCount < 0 || state.availableCount > total) return false;
  const rest = total - state.availableCount;
  if (rest === 0) return true;
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
  if (rest > 0) {
    lines.push({
      qty: rest,
      action: state.otherAction,
      relocateSiteId: state.otherAction === "relocate" ? state.relocateSiteId : "",
      remarks: state.otherAction === "lost_damaged" ? state.remarks : "",
    });
  }
  return lines;
}

export function summarizeSimpleClosure(state: SimpleClosureGroupState, total: number): string {
  const rest = total - state.availableCount;
  if (rest === 0) return `All ${total} back in pool`;
  if (state.availableCount === 0) {
    return `${total} → ${CLOSURE_ACTION_SIMPLE[state.otherAction].toLowerCase()}`;
  }
  const other = CLOSURE_ACTION_SIMPLE[state.otherAction].toLowerCase();
  return `${state.availableCount} in pool, ${rest} ${other}`;
}
