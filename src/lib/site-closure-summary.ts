import type { LedgerEntry, Site, SiteClosureSummary } from "@/domain/types";
import type { SiteClosureDisposition } from "@/lib/site-closure";

export function buildClosureSummaryFromDispositions(
  dispositions: SiteClosureDisposition[],
  closedBy: string,
): SiteClosureSummary {
  const summary: SiteClosureSummary = {
    totalUnits: 0,
    available: 0,
    maintenance: 0,
    relocate: 0,
    lost_damaged: 0,
    closedAt: new Date().toISOString(),
    closedBy,
  };

  for (const disposition of dispositions) {
    const qty = disposition.machineIds.length;
    if (qty <= 0) continue;
    summary.totalUnits += qty;
    summary[disposition.action] += qty;
  }

  return summary;
}

export function parseClosureActionFromSummary(summary: string): keyof Pick<
  SiteClosureSummary,
  "available" | "maintenance" | "relocate" | "lost_damaged"
> | null {
  const s = summary.toLowerCase();
  if (s.includes("marked available")) return "available";
  if (s.includes("maintenance")) return "maintenance";
  if (s.includes("relocated")) return "relocate";
  if (s.includes("lost/damaged") || s.includes("lost / damaged")) return "lost_damaged";
  return null;
}

/** Reconstruct closure totals from ledger when DB snapshot is missing (older finished sites). */
export function closureSummaryFromLedger(siteId: string, ledger: LedgerEntry[]): SiteClosureSummary | null {
  const closureEntries = ledger.filter(
    (e) => e.siteId === siteId && e.eventKind === "machinery_site_closure",
  );
  if (closureEntries.length === 0) return null;

  const summary: SiteClosureSummary = {
    totalUnits: 0,
    available: 0,
    maintenance: 0,
    relocate: 0,
    lost_damaged: 0,
    closedAt: "",
    closedBy: undefined,
  };

  for (const entry of closureEntries) {
    const qty = entry.totalUnits || entry.machineIds.length;
    if (qty <= 0) continue;
    const action = parseClosureActionFromSummary(entry.summary ?? "");
    if (!action) continue;
    summary[action] += qty;
    summary.totalUnits += qty;
  }

  const completed = ledger.find(
    (e) => e.siteId === siteId && e.eventKind === "site_marked_completed",
  );
  summary.closedAt = completed?.approvedAt ?? closureEntries[closureEntries.length - 1]?.approvedAt ?? "";
  summary.closedBy = completed?.approvedBy ?? closureEntries[0]?.approvedBy;

  return summary.totalUnits > 0 ? summary : null;
}

export function resolveSiteClosureSummary(site: Site, ledger: LedgerEntry[]): SiteClosureSummary | null {
  if (site.closureSummary && site.closureSummary.totalUnits > 0) {
    return site.closureSummary;
  }
  if (site.status === "completed") {
    return closureSummaryFromLedger(site.id, ledger);
  }
  return null;
}

export function closureReturnedPercent(summary: SiteClosureSummary): number {
  if (summary.totalUnits <= 0) return 0;
  return Math.round((summary.available / summary.totalUnits) * 100);
}

export const CLOSURE_SUMMARY_LABELS: Record<
  keyof Pick<SiteClosureSummary, "available" | "maintenance" | "relocate" | "lost_damaged">,
  string
> = {
  available: "Returned to company pool",
  maintenance: "Sent to maintenance",
  relocate: "Relocated to another site",
  lost_damaged: "Lost or damaged",
};
