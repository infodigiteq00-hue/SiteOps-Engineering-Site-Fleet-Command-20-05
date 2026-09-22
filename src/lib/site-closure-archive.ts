import type { LedgerEntry, Machine } from "@/domain/types";
import type { SiteClosureAction } from "@/lib/site-closure";
import { CLOSURE_ACTION_SIMPLE } from "@/lib/site-closure";
import { formatQtyWithUnit } from "@/lib/machinery-unit-types";
import { CLOSURE_SUMMARY_LABELS, parseClosureActionFromSummary } from "@/lib/site-closure-summary";

export type SiteClosureArchiveRow = {
  machineId: string;
  code: string;
  name: string;
  category: string;
  unitType: string;
  closureAction: SiteClosureAction;
  closureLabel: string;
};

/** Machinery processed when a site was finished — rebuilt from closure ledger rows. */
export function buildSiteClosureArchive(
  siteId: string,
  ledger: LedgerEntry[],
  machines: Machine[],
): SiteClosureArchiveRow[] {
  const machineById = new Map(machines.map((m) => [m.id, m]));
  const rows: SiteClosureArchiveRow[] = [];
  const seen = new Set<string>();

  const closureEntries = ledger.filter(
    (e) => e.siteId === siteId && e.eventKind === "machinery_site_closure",
  );

  for (const entry of closureEntries) {
    const action = parseClosureActionFromSummary(entry.summary ?? "");
    if (!action) continue;
    const closureLabel = CLOSURE_ACTION_SIMPLE[action];
    for (const id of entry.machineIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const machine = machineById.get(id);
      rows.push({
        machineId: id,
        code: machine?.code ?? "—",
        name: machine?.name ?? id,
        category: machine?.category ?? "—",
        unitType: machine?.unitType ?? "nos",
        closureAction: action,
        closureLabel,
      });
    }
  }

  return rows.sort((a, b) => a.code.localeCompare(b.code));
}

export function groupClosureArchiveByCategory(
  rows: SiteClosureArchiveRow[],
): { category: string; rows: SiteClosureArchiveRow[] }[] {
  const map = new Map<string, SiteClosureArchiveRow[]>();
  for (const row of rows) {
    const list = map.get(row.category) ?? [];
    list.push(row);
    map.set(row.category, list);
  }
  return Array.from(map.entries())
    .map(([category, categoryRows]) => ({ category, rows: categoryRows }))
    .sort((a, b) => b.rows.length - a.rows.length);
}

function joinSummaryParts(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** One-line category summary aligned with the site-level closure report. */
export function summarizeClosureArchiveCategory(rows: SiteClosureArchiveRow[]): string {
  const total = rows.length;
  if (total === 0) return "—";

  const unitType = rows[0]?.unitType ?? "nos";
  const totalQty = formatQtyWithUnit(total, unitType) || `${total} unit${total === 1 ? "" : "s"}`;

  const counts = new Map<SiteClosureAction, number>();
  for (const row of rows) {
    counts.set(row.closureAction, (counts.get(row.closureAction) ?? 0) + 1);
  }

  const order: SiteClosureAction[] = ["available", "maintenance", "relocate", "lost_damaged"];
  const parts = order
    .filter((action) => (counts.get(action) ?? 0) > 0)
    .map((action) => {
      const n = counts.get(action)!;
      const qty = formatQtyWithUnit(n, unitType) || String(n);
      const label = CLOSURE_SUMMARY_LABELS[action].toLowerCase();
      return `${qty} ${label}`;
    });

  if (parts.length === 1 && counts.get("available") === total) {
    return `All ${totalQty} returned to the company pool.`;
  }

  return `At closure, ${totalQty} on site — ${joinSummaryParts(parts)}.`;
}
