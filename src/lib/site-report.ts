import { format, isValid, parseISO } from "date-fns";
import type { LedgerEntry, Machine, MachineryStatus, Site, SiteClosureSummary } from "@/domain/types";
import {
  classifySiteHistoryEntry,
  inferMachineryCategoryFromLabel,
  isMovementEntry,
  machineryGroupLabel,
  machineryLineKey,
  machineryLineKeyFromLabelAndCategory,
  movementDateIso,
  parseGatePassFromSummary,
  parseMachineryFromSummary,
  parseUnitTypeFromSummary,
  resolveMachineryDetails,
} from "@/lib/site-allocation-history";
import {
  DEFAULT_MACHINERY_UNIT_TYPE,
  formatQtyWithUnit,
  type MachineryUnitType,
} from "@/lib/machinery-unit-types";
import { machineryStockQuantity } from "@/lib/site-closure";

export type SiteMovementLine = {
  dateIso: string;
  dateLabel: string;
  type: "IN" | "OUT";
  quantity: number;
  unitType: MachineryUnitType;
  gatePass: string;
  machinery: string;
  category: string;
  ledgerEntryId: string;
};

export type SiteCategoryReport = {
  lineKey: string;
  category: string;
  machineryLabel: string;
  currentlyOnSite: number;
  unitType: MachineryUnitType;
  movements: SiteMovementLine[];
};

/** One table row for export — IN/OUT columns filled per movement line */
export type SimpleSiteReportRow = {
  machineryName: string;
  /** e.g. "3 nos at site" */
  onSiteToday: string;
  /** IN — from site to store */
  inQty: string;
  inDate: string;
  inGatePass: string;
  /** OUT — from store to site */
  outQty: string;
  outDate: string;
  outGatePass: string;
};

/** One row in the site detail assigned-machinery table (movement IN/OUT paired). */
export type AssignedMachineryTableRow = {
  date: string;
  name: string;
  inQty: string;
  outQty: string;
  inGatePass: string;
  outGatePass: string;
  status: MachineryStatus;
  machineId?: string;
  ledgerEntryId?: string;
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

function linkedMachinesForEntry(entry: LedgerEntry, machines: Machine[]): Machine[] {
  return entry.machineIds
    .map((id) => machines.find((m) => m.id === id))
    .filter((m): m is Machine => Boolean(m));
}

function machineryLabelForLineKey(entry: LedgerEntry, machines: Machine[]): string {
  return parseMachineryFromSummary(entry.summary) ?? resolveMachineryDetails(entry, machines);
}

function lineKeyForEntry(entry: LedgerEntry, machines: Machine[]): string {
  const linked = linkedMachinesForEntry(entry, machines);
  if (linked.length > 0) return machineryLineKey(linked[0]);
  const label = machineryLabelForLineKey(entry, machines);
  const category = inferMachineryCategoryFromLabel(label, machines);
  return machineryLineKeyFromLabelAndCategory(label, category);
}

function categoryForEntry(entry: LedgerEntry, machines: Machine[]): string {
  const linked = linkedMachinesForEntry(entry, machines);
  if (linked.length > 0) return linked[0].category;
  return inferMachineryCategoryFromLabel(machineryLabelForLineKey(entry, machines), machines);
}

function unitTypeForEntry(entry: LedgerEntry, machines: Machine[]): MachineryUnitType {
  const linked = linkedMachinesForEntry(entry, machines);
  if (linked.length > 0) return linked[0].unitType;
  return parseUnitTypeFromSummary(entry.summary);
}

/** Net quantity on site: OUT (store→site) adds stock, IN (site→store) removes it. */
function netOnSiteFromMovements(movements: SiteMovementLine[]): number {
  return movements.reduce((sum, m) => (m.type === "OUT" ? sum + m.quantity : sum - m.quantity), 0);
}

function emptyMovementCells(): Pick<
  SimpleSiteReportRow,
  "inQty" | "inDate" | "inGatePass" | "outQty" | "outDate" | "outGatePass"
> {
  return { inQty: "", inDate: "", inGatePass: "", outQty: "", outDate: "", outGatePass: "" };
}

function gatePassCell(gatePass: string): string {
  const gp = gatePass.trim();
  return gp && gp !== "—" ? gp : "";
}

function formatOnSiteToday(count: number, unitType: MachineryUnitType): string {
  if (count <= 0) return "—";
  return `${formatQtyWithUnit(count, unitType)} at site`;
}

function movementInCells(m: SiteMovementLine): Pick<SimpleSiteReportRow, "inQty" | "inDate" | "inGatePass"> {
  return {
    inQty: formatQtyWithUnit(m.quantity, m.unitType),
    inDate: m.dateLabel,
    inGatePass: gatePassCell(m.gatePass),
  };
}

function movementOutCells(m: SiteMovementLine): Pick<SimpleSiteReportRow, "outQty" | "outDate" | "outGatePass"> {
  return {
    outQty: formatQtyWithUnit(m.quantity, m.unitType),
    outDate: m.dateLabel,
    outGatePass: gatePassCell(m.gatePass),
  };
}

export function buildSimpleReportRows(categories: SiteCategoryReport[]): SimpleSiteReportRow[] {
  const rows: SimpleSiteReportRow[] = [];

  for (const cat of categories) {
    const name = displayMachineryName(cat.category, cat.machineryLabel);
    const onSiteToday = formatOnSiteToday(cat.currentlyOnSite, cat.unitType);

    if (cat.movements.length === 0) {
      rows.push({
        machineryName: name,
        onSiteToday,
        ...emptyMovementCells(),
      });
      continue;
    }

    const inMovements = cat.movements.filter((m) => m.type === "IN");
    const outMovements = cat.movements.filter((m) => m.type === "OUT");
    const rowCount = Math.max(inMovements.length, outMovements.length);

    for (let i = 0; i < rowCount; i++) {
      const inM = inMovements[i];
      const outM = outMovements[i];
      rows.push({
        machineryName: name,
        onSiteToday,
        ...(inM ? movementInCells(inM) : { inQty: "", inDate: "", inGatePass: "" }),
        ...(outM ? movementOutCells(outM) : { outQty: "", outDate: "", outGatePass: "" }),
      });
    }
  }

  return rows;
}

function machineryStatusForLine(machinesInLine: Machine[]): MachineryStatus {
  if (machinesInLine.length === 0) return "assigned";
  const statuses = new Set(machinesInLine.map((m) => m.status));
  if (statuses.size === 1) return machinesInLine[0]!.status;
  return "assigned";
}

/** Movement rows for the assigned-machinery accordion table on site detail. */
export function buildAssignedMachineryTableRows(
  category: string,
  site: Site,
  ledger: LedgerEntry[],
  machines: Machine[],
  machinesInCategory?: Machine[],
): AssignedMachineryTableRow[] {
  const assignedInCategory =
    machinesInCategory ?? machines.filter((m) => m.assignedSiteId === site.id && m.category === category);
  const lineKeysInView = new Set(assignedInCategory.map((m) => machineryLineKey(m)));
  const report = buildSiteReport(site, ledger, machines, null);
  const categoryReports = report.categories.filter(
    (c) => c.category === category && (lineKeysInView.size === 0 || lineKeysInView.has(c.lineKey)),
  );
  const rows: AssignedMachineryTableRow[] = [];

  for (const catReport of categoryReports) {
    const machinesInLine = assignedInCategory.filter((m) => machineryLineKey(m) === catReport.lineKey);
    const status = machineryStatusForLine(machinesInLine);
    const machineId = machinesInLine[0]?.id;
    const name = displayMachineryName(catReport.category, catReport.machineryLabel);
    const inMovements = catReport.movements.filter((m) => m.type === "IN");
    const outMovements = catReport.movements.filter((m) => m.type === "OUT");

    if (catReport.movements.length === 0) {
      rows.push({
        date: "",
        name,
        inQty: "",
        outQty: "",
        inGatePass: "",
        outGatePass: "",
        status,
        machineId,
      });
      continue;
    }

    const rowCount = Math.max(inMovements.length, outMovements.length);
    for (let i = 0; i < rowCount; i++) {
      const inM = inMovements[i];
      const outM = outMovements[i];
      rows.push({
        date: outM?.dateLabel || inM?.dateLabel || "",
        name,
        inQty: inM ? formatQtyWithUnit(inM.quantity, inM.unitType) : "",
        outQty: outM ? formatQtyWithUnit(outM.quantity, outM.unitType) : "",
        inGatePass: inM?.gatePass ?? "",
        outGatePass: outM?.gatePass ?? "",
        status,
        machineId,
        ledgerEntryId: outM?.ledgerEntryId ?? inM?.ledgerEntryId,
      });
    }
  }

  const coveredKeys = new Set(categoryReports.map((c) => c.lineKey));
  const uncoveredLines = new Map<string, Machine[]>();
  for (const machine of assignedInCategory) {
    const key = machineryLineKey(machine);
    if (coveredKeys.has(key)) continue;
    const list = uncoveredLines.get(key) ?? [];
    list.push(machine);
    uncoveredLines.set(key, list);
  }

  for (const lineMachines of uncoveredLines.values()) {
    const first = lineMachines[0];
    if (!first) continue;
    rows.push({
      date: "",
      name: first.name,
      inQty: "",
      outQty: "",
      inGatePass: "",
      outGatePass: "",
      status: machineryStatusForLine(lineMachines),
      machineId: first.id,
    });
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
      ledgerEntryId: entry.id,
    };

    const bucket =
      categoryMap.get(lineKey) ??
      ({
        lineKey,
        category,
        machineryLabel,
        currentlyOnSite: 0,
        unitType: unitTypeForEntry(entry, machines),
        movements: [],
      } satisfies SiteCategoryReport);

    bucket.movements.push(line);
    categoryMap.set(lineKey, bucket);
  }

  const onSiteByLine = new Map<
    string,
    { count: number; category: string; label: string; unitType: MachineryUnitType }
  >();
  for (const machine of machines.filter((m) => m.assignedSiteId === site.id)) {
    const key = machineryLineKey(machine);
    const existing = onSiteByLine.get(key);
    const qty = machineryStockQuantity(machine);
    if (existing) {
      existing.count += qty;
    } else {
      onSiteByLine.set(key, {
        count: qty,
        category: machine.category,
        label: machineryGroupLabel(machine),
        unitType: machine.unitType,
      });
    }
  }

  for (const [key, info] of onSiteByLine) {
    const bucket = categoryMap.get(key) ?? {
      lineKey: key,
      category: info.category,
      machineryLabel: info.label,
      currentlyOnSite: 0,
      unitType: info.unitType,
      movements: [],
    };
    bucket.currentlyOnSite = info.count;
    bucket.unitType = info.unitType;
    categoryMap.set(key, bucket);
  }

  for (const bucket of categoryMap.values()) {
    const movementNet = netOnSiteFromMovements(bucket.movements);
    if (movementNet > bucket.currentlyOnSite) {
      bucket.currentlyOnSite = movementNet;
    }
    if (bucket.movements.length > 0 && bucket.unitType === DEFAULT_MACHINERY_UNIT_TYPE) {
      const last = bucket.movements[bucket.movements.length - 1];
      if (last.unitType !== DEFAULT_MACHINERY_UNIT_TYPE) {
        bucket.unitType = last.unitType;
      }
    }
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
