import type { Machine } from "@/domain/types";
import { machineryStockQuantity } from "@/lib/site-closure";
import { machineryGroupLabel, machineryLineKey } from "@/lib/site-allocation-history";

export type MachineryLineSelection = {
  key: string;
  label: string;
  machineIds: string[];
  availableCount: number;
};

export function stockSumForMachineIds(machineIds: string[], machinesById: Map<string, Machine>): number {
  return machineIds.reduce((sum, id) => {
    const machine = machinesById.get(id);
    return sum + (machine ? machineryStockQuantity(machine) : 0);
  }, 0);
}

/** Pick machinery rows (in code order) until the requested quantity is covered. */
export function selectMachineIdsForQuantity(
  orderedMachineIds: string[],
  machinesById: Map<string, Machine>,
  quantity: number,
): string[] {
  if (quantity < 1) return [];

  const ids: string[] = [];
  let remaining = quantity;

  for (const id of orderedMachineIds) {
    if (remaining <= 0) break;
    const machine = machinesById.get(id);
    if (!machine) continue;
    ids.push(id);
    remaining -= machineryStockQuantity(machine);
  }

  return ids;
}

export function buildMachineryLineSelections(eligible: Machine[]): MachineryLineSelection[] {
  const grouped = new Map<string, { label: string; machines: Machine[] }>();
  const sorted = [...eligible].sort((a, b) => a.code.localeCompare(b.code));

  for (const machine of sorted) {
    const key = machineryLineKey(machine);
    const entry = grouped.get(key) ?? { label: machineryGroupLabel(machine), machines: [] };
    entry.machines.push(machine);
    grouped.set(key, entry);
  }

  return Array.from(grouped.entries()).map(([key, entry]) => ({
    key,
    label: entry.label,
    machineIds: entry.machines.map((m) => m.id),
    availableCount: entry.machines.reduce((sum, m) => sum + machineryStockQuantity(m), 0),
  }));
}
