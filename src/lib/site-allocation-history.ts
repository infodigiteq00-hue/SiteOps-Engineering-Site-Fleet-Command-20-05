import type { LedgerEntry, Machine, MachineryStatus } from "@/domain/types";

export type MachineryMovementDirection = "in" | "out";

export type SiteHistoryRowType = "in" | "out";

export function classifySiteHistoryEntry(entry: LedgerEntry): SiteHistoryRowType {
  const summary = entry.summary?.toLowerCase() ?? "";
  if (summary.includes("moved out")) return "out";
  if (summary.includes("received in")) return "in";
  if (entry.eventKind === "machinery_moved_out") return "out";
  return "in";
}

/** Display label for UI (toggle labels are swapped vs internal direction). */
export function movementDirectionDisplayLabel(direction: MachineryMovementDirection): "IN" | "OUT" {
  return direction === "in" ? "OUT" : "IN";
}

/** Ledger event kind from form direction (aligned with swapped toggle labels). */
export function movementEventKindFromDirection(direction: MachineryMovementDirection): string {
  return direction === "in" ? "machinery_moved_out" : "machinery_moved_in";
}

/** Form direction when editing an existing ledger row. */
export function ledgerMovementDirection(entry: LedgerEntry): MachineryMovementDirection {
  return entry.eventKind === "machinery_moved_out" ? "in" : "out";
}

export function isMovementEntry(entry: LedgerEntry): boolean {
  return entry.eventKind === "machinery_moved_in" || entry.eventKind === "machinery_moved_out";
}

export function parseGatePassFromSummary(summary?: string): string {
  if (!summary) return "—";
  const match = summary.match(/Gate pass\s+([^·]+?)(?:\s*·|\s*\.?\s*$)/i);
  return match?.[1]?.trim() || "—";
}

export function parseMachineryFromSummary(summary?: string): string | null {
  if (!summary) return null;
  const match = summary.match(/Qty\s+(.+?)\s+(?:moved OUT|received IN)/i);
  return match?.[1]?.trim() ?? null;
}

export function resolveMachineryDetails(entry: LedgerEntry, machines: Machine[]): string {
  const fromSummary = parseMachineryFromSummary(entry.summary);
  if (fromSummary) return fromSummary;

  const linked = entry.machineIds
    .map((id) => machines.find((m) => m.id === id))
    .filter((m): m is Machine => Boolean(m));

  if (linked.length === 0) {
    return entry.summary?.trim() || "—";
  }

  const labels = [...new Set(linked.map((m) => `${m.code} — ${m.name}`))];
  if (labels.length === 1) return labels[0];
  if (labels.length <= 3) return labels.join(", ");
  return `${labels[0]} (+${labels.length - 1} more)`;
}

export function movementDateIso(entry: LedgerEntry): string {
  return entry.fromDate ?? entry.approvedAt;
}

export function sortSiteHistoryEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort(
    (a, b) => new Date(movementDateIso(b)).getTime() - new Date(movementDateIso(a)).getTime(),
  );
}

export function machineryLineKey(machine: Machine): string {
  return `${machine.name}::${machine.category}`;
}

export function parseSourceStatusFromSummary(summary?: string): MachineryStatus {
  const match = summary?.match(/\((Available|Assigned|Maintenance) pool\)/i);
  if (!match) return "assigned";
  return match[1].toLowerCase() as MachineryStatus;
}

export type MovementEditDraft = {
  ledgerId: string;
  direction: MachineryMovementDirection;
  sourceStatus: MachineryStatus;
  movementDate: string;
  gatePassNumber: string;
  machineIds: string[];
  quantity: number;
  machineryLabel: string;
  lineKey: string;
};

export function parseMovementEditFromLedger(entry: LedgerEntry, machines: Machine[]): MovementEditDraft {
  const direction = ledgerMovementDirection(entry);
  const sourceStatus = parseSourceStatusFromSummary(entry.summary);
  const gatePass = parseGatePassFromSummary(entry.summary);
  const machineIds = [...entry.machineIds];
  const quantity = entry.totalUnits || machineIds.length || 1;
  const machineryLabel = resolveMachineryDetails(entry, machines);
  const firstMachine = machines.find((m) => machineIds.includes(m.id));
  const lineKey = firstMachine ? machineryLineKey(firstMachine) : machineryLabel;

  return {
    ledgerId: entry.id,
    direction,
    sourceStatus,
    movementDate: movementDateIso(entry).slice(0, 10),
    gatePassNumber: gatePass === "—" ? "" : gatePass,
    machineIds,
    quantity,
    machineryLabel,
    lineKey,
  };
}
