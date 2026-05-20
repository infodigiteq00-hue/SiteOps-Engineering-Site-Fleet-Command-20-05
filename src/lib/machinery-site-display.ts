import type { LedgerEntry, Machine, Site } from "@/domain/types";

/** Resolve site id shown in machinery list (assignment vs lost/damaged origin). */
export function machineryDisplaySiteId(machine: Machine): string | null {
  if (machine.status === "lost_damaged") {
    return machine.lostFromSiteId;
  }
  return machine.assignedSiteId;
}

/** Build machineId → siteId from site-closure ledger (lost/damaged backfill for older rows). */
export function buildLostFromSiteLedgerIndex(ledger: LedgerEntry[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of ledger) {
    if (entry.eventKind !== "machinery_site_closure") continue;
    const summary = entry.summary?.toLowerCase() ?? "";
    if (!summary.includes("lost/damaged") && !summary.includes("lost / damaged")) continue;
    if (!entry.siteId) continue;
    for (const machineId of entry.machineIds) {
      if (!index.has(machineId)) index.set(machineId, entry.siteId);
    }
  }
  return index;
}

export function machineryDisplaySiteName(
  machine: Machine,
  sites: Site[],
  lostFromLedger?: Map<string, string>,
): string | null {
  let siteId = machineryDisplaySiteId(machine);
  if (!siteId && machine.status === "lost_damaged" && lostFromLedger) {
    siteId = lostFromLedger.get(machine.id) ?? null;
  }
  if (!siteId) return null;
  return sites.find((s) => s.id === siteId)?.name ?? null;
}

export function machinerySiteColumnLabel(filter: Machine["status"] | "all"): string {
  if (filter === "lost_damaged") return "Lost / damaged at";
  return "Assigned site";
}
