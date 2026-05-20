import { format, isValid, parseISO } from "date-fns";
import type { LedgerEntry, Machine, Site, SiteClosureSummary } from "@/domain/types";
import {
  classifySiteHistoryEntry,
  isMovementEntry,
  machineryLineKey,
  movementDateIso,
  parseGatePassFromSummary,
  parseMachineryFromSummary,
  resolveMachineryDetails,
} from "@/lib/site-allocation-history";
import {
  DEFAULT_MACHINERY_UNIT_TYPE,
  formatQtyWithUnit,
  type MachineryUnitType,
} from "@/lib/machinery-unit-types";

export type SiteMovementLine = {
  dateIso: string;
  dateLabel: string;
  type: "IN" | "OUT";
  quantity: number;
  unitType: MachineryUnitType;
  gatePass: string;
  machinery: string;
  category: string;
};

export type SiteCategoryReport = {
  lineKey: string;
  category: string;
  machineryLabel: string;
  currentlyOnSite: number;
  movements: SiteMovementLine[];
};

/** One table row for export — IN or OUT columns filled per movement line */
export type SimpleSiteReportRow = {
  machineryName: string;
  onSiteToday: number;
  /** Gate pass + date combined */
  inDetail: string;
  inQty: string;
  outDetail: string;
  outQty: string;
};

export type SiteReport = {
  siteCode: string;
  siteName: string;
  location: string;
  manager: string;
  status: string;
  generatedAt: string;
  generatedAtLabel: string;
  rows: SimpleSiteReportRow[];
  categories: SiteCategoryReport[];
  closureSummary: SiteClosureSummary | null;
};

function formatReportDate(iso: string): string {
  const parsed = parseISO(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (!isValid(parsed)) return iso.slice(0, 10) || "—";
  return format(parsed, "dd-MMM-yyyy");
}

/** Gate pass + date in one cell, e.g. "501 (15-May-2026)" */
export function formatMovementDetail(gatePass: string, dateLabel: string): string {
  const gp = gatePass.trim();
  const hasGp = Boolean(gp && gp !== "—" && gp !== "0");
  if (!dateLabel && !hasGp) return "";
  if (!hasGp) return dateLabel;
  if (!dateLabel) return `GP ${gp}`;
  return `${gp} (${dateLabel})`;
}

function displayMachineryName(category: string, label: string): string {
  if (label && category && !label.toLowerCase().includes(category.toLowerCase())) {
    return `${label} (${category})`;
  }
  return label || category;
}

function machineryLabelForEntry(entry: LedgerEntry, machines: Machine[]): string {
  const fromSummary = parseMachineryFromSummary(entry.summary);
  if (fromSummary) return fromSummary.replace(/\s*\([^)]+\)\s*$/, "").trim();
  return resolveMachineryDetails(entry, machines);
}

function lineKeyForEntry(entry: LedgerEntry, machines: Machine[]): string {
  const linked = entry.machineIds
    .map((id) => machines.find((m) => m.id === id))
    .filter((m): m is Machine => Boolean(m));
  if (linked.length > 0) return machineryLineKey(linked[0]);
  return parseMachineryFromSummary(entry.summary) ?? resolveMachineryDetails(entry, machines);
}

function categoryForEntry(entry: LedgerEntry, machines: Machine[]): string {
  const linked = entry.machineIds
    .map((id) => machines.find((m) => m.id === id))
    .filter((m): m is Machine => Boolean(m));
  if (linked.length > 0) return linked[0].category;
  return "Machinery";
}

function unitTypeForEntry(entry: LedgerEntry, machines: Machine[]): MachineryUnitType {
  const linked = entry.machineIds
    .map((id) => machines.find((m) => m.id === id))
    .filter((m): m is Machine => Boolean(m));
  if (linked.length === 0) return DEFAULT_MACHINERY_UNIT_TYPE;
  const types = new Set(linked.map((m) => m.unitType));
  if (types.size === 1) return linked[0].unitType;
  return linked[0].unitType;
}

function emptyMovementCells(): Pick<SimpleSiteReportRow, "inDetail" | "inQty" | "outDetail" | "outQty"> {
  return { inDetail: "", inQty: "", outDetail: "", outQty: "" };
}

export function buildSimpleReportRows(categories: SiteCategoryReport[]): SimpleSiteReportRow[] {
  const rows: SimpleSiteReportRow[] = [];

  for (const cat of categories) {
    const name = displayMachineryName(cat.category, cat.machineryLabel);

    if (cat.movements.length === 0) {
      rows.push({
        machineryName: name,
        onSiteToday: cat.currentlyOnSite,
        ...emptyMovementCells(),
      });
      continue;
    }

    for (const m of cat.movements) {
      rows.push({
        machineryName: name,
        onSiteToday: cat.currentlyOnSite,
        inDetail:
          m.type === "IN" ? formatMovementDetail(m.gatePass || "—", m.dateLabel) : "",
        inQty: m.type === "IN" ? formatQtyWithUnit(m.quantity, m.unitType) : "",
        outDetail:
          m.type === "OUT" ? formatMovementDetail(m.gatePass || "—", m.dateLabel) : "",
        outQty: m.type === "OUT" ? formatQtyWithUnit(m.quantity, m.unitType) : "",
      });
    }
  }

  return rows;
}

export function buildSiteReport(
  site: Site,
  ledger: LedgerEntry[],
  machines: Machine[],
  closureSummary: SiteClosureSummary | null = site.closureSummary ?? null,
): SiteReport {
  const movementEntries = ledger
    .filter((e) => e.siteId === site.id && isMovementEntry(e))
    .sort((a, b) => new Date(movementDateIso(a)).getTime() - new Date(movementDateIso(b)).getTime());

  const categoryMap = new Map<string, SiteCategoryReport>();

  for (const entry of movementEntries) {
    const rowType = classifySiteHistoryEntry(entry);
    const type = rowType === "in" ? "IN" : "OUT";
    const qty = entry.totalUnits || entry.machineIds.length || 1;
    const lineKey = lineKeyForEntry(entry, machines);
    const category = categoryForEntry(entry, machines);
    const machineryLabel = machineryLabelForEntry(entry, machines);
    const gatePass = parseGatePassFromSummary(entry.summary);

    const line: SiteMovementLine = {
      dateIso: movementDateIso(entry),
      dateLabel: formatReportDate(movementDateIso(entry)),
      type,
      quantity: qty,
      unitType: unitTypeForEntry(entry, machines),
      gatePass: gatePass === "—" ? "" : gatePass,
      machinery: machineryLabel,
      category,
    };

    const bucket =
      categoryMap.get(lineKey) ??
      ({
        lineKey,
        category,
        machineryLabel,
        currentlyOnSite: 0,
        movements: [],
      } satisfies SiteCategoryReport);

    bucket.movements.push(line);
    categoryMap.set(lineKey, bucket);
  }

  const onSiteByLine = new Map<string, { count: number; category: string; label: string }>();
  for (const machine of machines.filter((m) => m.assignedSiteId === site.id)) {
    const key = machineryLineKey(machine);
    const existing = onSiteByLine.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      onSiteByLine.set(key, { count: 1, category: machine.category, label: machine.name });
    }
  }

  for (const [key, info] of onSiteByLine) {
    const bucket = categoryMap.get(key) ?? {
      lineKey: key,
      category: info.category,
      machineryLabel: info.label,
      currentlyOnSite: 0,
      movements: [],
    };
    bucket.currentlyOnSite = info.count;
    categoryMap.set(key, bucket);
  }

  const categories = Array.from(categoryMap.values()).sort(
    (a, b) => a.category.localeCompare(b.category) || a.machineryLabel.localeCompare(b.machineryLabel),
  );

  const generatedAt = new Date().toISOString();

  return {
    siteCode: site.code,
    siteName: site.name,
    location: site.location,
    manager: site.manager,
    status: site.status,
    generatedAt,
    generatedAtLabel: format(new Date(generatedAt), "dd MMM yyyy"),
    categories,
    rows: buildSimpleReportRows(categories),
    closureSummary,
  };
}
