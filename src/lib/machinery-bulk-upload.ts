import type { Machine, MachineryStatus, Site } from "@/domain/types";
import { normalizeMachineryUnitType, type MachineryUnitType } from "@/lib/machinery-unit-types";
import { seedCategoryCodegen, takeMachineryUnitsFromCursor, type MachineryCodegenCursor } from "@/lib/machinery-unit-codegen";
import { machineryRecordsForQuantity } from "@/lib/machinery-unit-types";

export type BulkParsedRow = {
  category: string;
  status: MachineryStatus;
  projectName: string;
  projectLocation: string;
  unitType: MachineryUnitType;
  code: string;
  name: string;
};

export type BulkSiteResolution = { siteId: string; displayName: string };

export type BulkSiteConfirmItem = {
  key: string;
  csvProjectName: string;
  csvLocation: string;
  existingSite: Site | null;
  /** True when matched by site name but CSV location differs from the site record. */
  locationMismatch?: boolean;
};

export type BulkSiteMatchResult = { kind: "exact"; site: Site } | { kind: "none" };

export type BulkPreviewGroup = {
  category: string;
  status: MachineryStatus;
  assignedSiteId: string | null;
  siteName: string;
  unitType: MachineryUnitType;
  existingUnitCount: number;
  units: Array<{
    code: string;
    name: string;
    projectName: string;
    projectLocation: string;
  }>;
};

export const MACHINERY_BULK_CSV_HEADER = "projectName,location,category,qty,unit_type,status";

/** Standard 6-column bulk template (same for Add machinery and Create new site). */
export const MACHINERY_BULK_SAMPLE_CSV = [
  MACHINERY_BULK_CSV_HEADER,
  'UPL Limited — Panoli,"Panoli, Gujarat",Grinding Machine,2,nos,assigned',
  'L&T Heavy Engineering — Hazira,"Hazira, Gujarat",Lathe Machine,1,nos,available',
  'SRF Limited — Dahej,"Dahej, Gujarat",Compressor Unit,1,nos,maintenance',
  'SRF Limited — Dahej,"Dahej, Gujarat",Welding Machine,3,metre,assigned',
].join("\n");

export type BulkTemplatePreviewRow = {
  projectName: string;
  location: string;
  category: string;
  qty: number;
  unitType: MachineryUnitType;
  status: MachineryStatus;
  siteName: string | null;
};

export function bulkGroupsToTemplatePreviewRows(groups: BulkPreviewGroup[]): BulkTemplatePreviewRow[] {
  return groups.map((group) => ({
    projectName: group.units[0]?.projectName ?? "",
    location: group.units[0]?.projectLocation ?? "",
    category: group.category,
    qty: group.units.length,
    unitType: group.unitType,
    status: group.status,
    siteName: group.siteName !== "—" ? group.siteName : null,
  }));
}

export type BuildBulkSiteQueueOptions = {
  /** When false, existing deployments always go through the site wizard (Create new site). Default true. */
  autoResolveExactMatches?: boolean;
  /** When true, every project+location in the file is queued/resolved, not only assigned rows (Create new site). */
  includeAllDeployments?: boolean;
};

export function normBulkCompareKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function siteAssignmentKey(projectName: string, projectLocation: string) {
  return `${normBulkCompareKey(projectName)}|${normBulkCompareKey(projectLocation)}`;
}

/** Strict deployment identity (name + location) within a company. */
export function siteDeploymentExists(
  sites: Site[],
  name: string,
  location: string,
  companyId: string,
  pendingNormNames?: ReadonlySet<string>,
): boolean {
  const nk = normBulkCompareKey(name);
  const lk = normBulkCompareKey(location);
  if (!name.trim() || !location.trim()) return true;
  if (pendingNormNames?.has(`${nk}|${lk}`)) return true;
  return sites.some(
    (site) =>
      site.companyId === companyId &&
      normBulkCompareKey(site.name) === nk &&
      normBulkCompareKey(site.location) === lk,
  );
}

/**
 * Resolve CSV project/location to an existing site (company-scoped).
 * Only matches when both name and location match — same name at a different location is a separate site.
 */
export function findBulkSiteForMachineryImport(
  sites: Site[],
  projectName: string,
  projectLocation: string,
  companyId: string,
): BulkSiteMatchResult {
  const scoped = sites.filter((site) => site.companyId === companyId);
  const nameKey = normBulkCompareKey(projectName);
  const locKey = normBulkCompareKey(projectLocation);

  const exact = scoped.find(
    (site) => normBulkCompareKey(site.name) === nameKey && normBulkCompareKey(site.location) === locKey,
  );
  if (exact) return { kind: "exact", site: exact };

  return { kind: "none" };
}

/** Existing site when bulk create would duplicate the same name + location deployment. */
export function existingSiteForBulkWizardConflict(
  sites: Site[],
  name: string,
  location: string,
  companyId: string,
): { site: Site; locationMismatch: boolean } | null {
  const match = findBulkSiteForMachineryImport(sites, name.trim(), location.trim(), companyId);
  if (match.kind === "exact") return { site: match.site, locationMismatch: false };
  return null;
}

function collectDeploymentKeys(rows: BulkParsedRow[], includeAllDeployments: boolean): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const row of rows) {
    if (!includeAllDeployments && row.status !== "assigned") continue;
    const key = siteAssignmentKey(row.projectName, row.projectLocation);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function deploymentLabel(rows: BulkParsedRow[], key: string): { projectName: string; location: string } {
  const row = rows.find((r) => siteAssignmentKey(r.projectName, r.projectLocation) === key);
  return { projectName: row?.projectName ?? "", location: row?.projectLocation ?? "" };
}

/** Auto-resolve exact site rows (optional); queue rows that need a human choice. */
export function buildBulkSiteResolutionsAndQueue(
  rows: BulkParsedRow[],
  sites: Site[],
  companyId: string,
  options: BuildBulkSiteQueueOptions = {},
): { resolutions: Record<string, BulkSiteResolution>; queue: BulkSiteConfirmItem[] } {
  const autoResolveExactMatches = options.autoResolveExactMatches !== false;
  const includeAllDeployments = options.includeAllDeployments === true;

  const resolutions: Record<string, BulkSiteResolution> = {};
  const queue: BulkSiteConfirmItem[] = [];

  for (const key of collectDeploymentKeys(rows, includeAllDeployments)) {
    const { projectName, location } = deploymentLabel(rows, key);
    const match = findBulkSiteForMachineryImport(sites, projectName, location, companyId);

    if (match.kind === "exact" && autoResolveExactMatches) {
      resolutions[key] = { siteId: match.site.id, displayName: match.site.name };
      continue;
    }
    if (match.kind === "exact") {
      queue.push({
        key,
        csvProjectName: projectName,
        csvLocation: location,
        existingSite: match.site,
        locationMismatch: false,
      });
      continue;
    }
    queue.push({
      key,
      csvProjectName: projectName,
      csvLocation: location,
      existingSite: null,
    });
  }

  return { resolutions, queue };
}

function bulkMachineryInventoryKey(
  category: string,
  status: MachineryStatus,
  unitType: MachineryUnitType,
  projectName: string,
  projectLocation: string,
) {
  const sitePart = status === "assigned" ? siteAssignmentKey(projectName, projectLocation) : "";
  return `${normBulkCompareKey(category)}|${status}|${unitType}|${sitePart}`;
}

function machineMatchesBulkInventory(
  machine: Machine,
  companyId: string | null,
  category: string,
  status: MachineryStatus,
  unitType: MachineryUnitType,
  resolvedAssignedSiteId: string | null,
  projectName: string,
  projectLocation: string,
): boolean {
  if (companyId && machine.companyId !== companyId) return false;
  if (normBulkCompareKey(machine.category) !== normBulkCompareKey(category)) return false;
  if (machine.status !== status) return false;
  if (machine.unitType !== unitType) return false;

  if (status === "assigned") {
    if (!resolvedAssignedSiteId) return false;
    return machine.assignedSiteId === resolvedAssignedSiteId;
  }

  const targetKey = bulkMachineryInventoryKey(category, status, unitType, projectName, projectLocation);
  const machineKey = bulkMachineryInventoryKey(
    machine.category,
    machine.status,
    machine.unitType,
    machine.projectName ?? "",
    machine.projectLocation ?? "",
  );
  return machineKey === targetKey;
}

export function countExistingBulkMachinery(
  machines: Machine[],
  companyId: string | null,
  category: string,
  status: MachineryStatus,
  unitType: MachineryUnitType,
  resolvedAssignedSiteId: string | null,
  projectName: string,
  projectLocation: string,
): number {
  return machines.filter((machine) =>
    machineMatchesBulkInventory(
      machine,
      companyId,
      category,
      status,
      unitType,
      resolvedAssignedSiteId,
      projectName,
      projectLocation,
    ),
  ).length;
}

/** CSV qty is the number of new rows to insert (20 metre → 1 row; 20 nos → 20 rows). */
export function bulkUnitsToCreate(csvQty: number, unitType: MachineryUnitType | string): number {
  return machineryRecordsForQuantity(csvQty, unitType);
}

export function bulkValidationUniqueCodes(rows: BulkParsedRow[], machines: Machine[]): string | null {
  const uploadedCodes = rows.map((row) => row.code.toUpperCase());
  if (new Set(uploadedCodes).size !== uploadedCodes.length) {
    return "Each machinery code in the file must be unique (duplicate in upload).";
  }
  const existingCodes = new Set(machines.map((machine) => machine.code.toUpperCase()));
  const duplicateExisting = uploadedCodes.find((code) => existingCodes.has(code));
  if (duplicateExisting) return `Code ${duplicateExisting} already exists in the system.`;
  return null;
}

export function assertBulkImportCodesAreNew(rows: BulkParsedRow[], machines: Machine[]): void {
  const err = bulkValidationUniqueCodes(rows, machines);
  if (err) throw new Error(err);
}

type BulkCsvLineSpec = {
  projectName: string;
  projectLocation: string;
  category: string;
  status: MachineryStatus;
  unitType: MachineryUnitType;
  qty: number;
};

export function parseBulkStatus(value: string): MachineryStatus | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "assigned" || normalized === "maintenance" || normalized === "available") {
    return normalized;
  }
  return null;
}

export function parseBulkCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function parseBulkStructural(
  csvInput: string,
  machines: Machine[],
  companyId: string | null,
): { ok: true; rows: BulkParsedRow[] } | { ok: false; error: string } {
  const lines = csvInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith("projectname,"));
  if (lines.length === 0) {
    return { ok: false, error: "No data rows found. Upload a CSV or use sample data." };
  }
  try {
    const reservedCodes = new Set(machines.map((machine) => machine.code.toUpperCase()));
    const categoryCursors = new Map<string, MachineryCodegenCursor>();
    const parsedRows: BulkParsedRow[] = [];
    const aggregated = new Map<string, BulkCsvLineSpec>();

    lines.forEach((line, index) => {
      const cells = parseBulkCsvLine(line);
      if (cells.length !== 6) {
        throw new Error(`Row ${index + 1}: expected 6 columns (projectName, location, category, qty, unit_type, status).`);
      }

      const [projectNameRaw, projectLocationRaw, categoryRaw, qtyRaw, unitTypeRaw, statusRaw] = cells;
      const projectName = projectNameRaw.trim();
      const projectLocation = projectLocationRaw.trim();
      const category = categoryRaw.trim();
      const qty = Number.parseInt(qtyRaw.trim(), 10);
      const unitTypeLabel = unitTypeRaw.trim();
      if (!projectName) throw new Error(`Row ${index + 1}: project name is required.`);
      if (!projectLocation) throw new Error(`Row ${index + 1}: location is required.`);
      if (!category) throw new Error(`Row ${index + 1}: category is required.`);
      if (!Number.isFinite(qty) || qty < 0) {
        throw new Error(`Row ${index + 1}: qty must be a whole number of 0 or more.`);
      }
      if (!unitTypeLabel) throw new Error(`Row ${index + 1}: unit_type is required (e.g. nos, metre).`);

      const status = parseBulkStatus(statusRaw);
      if (!status) throw new Error(`Row ${index + 1}: invalid status "${statusRaw}".`);

      const unitType = normalizeMachineryUnitType(unitTypeLabel);
      const invKey = bulkMachineryInventoryKey(category, status, unitType, projectName, projectLocation);
      const prev = aggregated.get(invKey);
      if (prev) prev.qty += qty;
      else {
        aggregated.set(invKey, { projectName, projectLocation, category, status, unitType, qty });
      }
    });

    aggregated.forEach((spec) => {
      const unitsToAdd = bulkUnitsToCreate(spec.qty, spec.unitType);
      if (unitsToAdd === 0) return;

      const categoryKey = spec.category.toLowerCase();
      let cursor = categoryCursors.get(categoryKey);
      if (!cursor) {
        cursor = seedCategoryCodegen(spec.category, machines, reservedCodes);
        categoryCursors.set(categoryKey, cursor);
      }

      const generated = takeMachineryUnitsFromCursor(cursor, unitsToAdd, reservedCodes);
      generated.forEach((unit) => {
        parsedRows.push({
          category: spec.category,
          status: spec.status,
          projectName: spec.projectName,
          projectLocation: spec.projectLocation,
          unitType: spec.unitType,
          code: unit.code,
          name: unit.name,
        });
      });
    });

    return { ok: true, rows: parsedRows };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Check CSV and try again.",
    };
  }
}

export function bulkGroupParsedRows(
  rows: BulkParsedRow[],
  resolutions: Record<string, BulkSiteResolution>,
  machines: Machine[],
  companyId: string | null,
): BulkPreviewGroup[] {
  const grouped = new Map<string, BulkPreviewGroup>();

  rows.forEach((row) => {
    let assignedSiteId: string | null = null;
    let resolvedSiteIdForCount: string | null = null;
    let siteName = "—";
    if (row.status === "assigned") {
      const rk = siteAssignmentKey(row.projectName, row.projectLocation);
      const res = resolutions[rk];
      if (!res) {
        throw new Error(`Missing site resolution for "${row.projectName}" at "${row.projectLocation}".`);
      }
      assignedSiteId = res.siteId;
      resolvedSiteIdForCount = res.siteId;
      siteName = res.displayName;
    }

    const groupKey = `${row.category}__${row.status}__${assignedSiteId ?? "none"}__${row.unitType}`;
    const existing = grouped.get(groupKey);
    const unit = {
      code: row.code,
      name: row.name,
      projectName: row.projectName,
      projectLocation: row.projectLocation,
    };
    if (existing) existing.units.push(unit);
    else {
      grouped.set(groupKey, {
        category: row.category,
        status: row.status,
        assignedSiteId,
        siteName,
        unitType: row.unitType,
        existingUnitCount: countExistingBulkMachinery(
          machines,
          companyId,
          row.category,
          row.status,
          row.unitType,
          resolvedSiteIdForCount,
          row.projectName,
          row.projectLocation,
        ),
        units: [unit],
      });
    }
  });

  return Array.from(grouped.values());
}
