import type { Machine, Site } from "@/domain/types";

export type SiteBulkParsedRow = {
  siteName: string;
  location: string;
  machineryCodes: string[];
};

export type SiteBulkImportRow = SiteBulkParsedRow & {
  machineIds: string[];
  /** Requested codes that were not allotted (missing, wrong company, already assigned, or claimed earlier in this file). */
  skippedMachineryCodes: string[];
};

export const SITE_BULK_CSV_HEADER = "site_name,location,machinery_codes";

export const SITE_BULK_SAMPLE_CSV = [
  SITE_BULK_CSV_HEADER,
  'Essar Steel - Hazira,"Hazira, Gujarat",CRA-001;LTH-001',
  'UPL Limited — Panoli,"Panoli, Gujarat",',
].join("\n");

export function normSiteBulkKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function siteBulkRowKey(siteName: string, location: string) {
  return `${normSiteBulkKey(siteName)}|${normSiteBulkKey(location)}`;
}

function parseCsvLine(line: string) {
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

function splitMachineryCodes(raw: string) {
  if (!raw.trim()) return [];
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseSiteBulkCsv(csvInput: string): { ok: true; rows: SiteBulkParsedRow[] } | { ok: false; error: string } {
  const lines = csvInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith("site_name,"));

  if (lines.length === 0) {
    return { ok: false, error: "No data rows found. Upload a CSV or use the sample template." };
  }

  try {
    const rows: SiteBulkParsedRow[] = [];
    lines.forEach((line, index) => {
      const cells = parseCsvLine(line);
      if (cells.length < 2 || cells.length > 3) {
        throw new Error(`Row ${index + 1}: expected 2–3 columns (site_name, location, optional machinery_codes).`);
      }
      const [siteNameRaw, locationRaw, codesRaw = ""] = cells;
      const siteName = siteNameRaw.trim();
      const location = locationRaw.trim();
      if (!siteName) throw new Error(`Row ${index + 1}: site name is required.`);
      if (!location) throw new Error(`Row ${index + 1}: location is required.`);
      rows.push({
        siteName,
        location,
        machineryCodes: splitMachineryCodes(codesRaw),
      });
    });
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not parse CSV." };
  }
}

export function validateSiteBulkImport(
  rows: SiteBulkParsedRow[],
  existingSites: Site[],
  machines: Machine[],
  companyId: string,
): { ok: true; rows: SiteBulkImportRow[] } | { ok: false; error: string } {
  const companySites = existingSites.filter((site) => site.companyId === companyId);
  const existingKeys = new Set(companySites.map((site) => siteBulkRowKey(site.name, site.location)));
  const seenInUpload = new Set<string>();

  /** Mutable pool: each available unit can only be allotted once across the whole upload. */
  const pool = new Map(
    machines
      .filter((machine) => machine.companyId === companyId && machine.status === "available")
      .map((machine) => [machine.code.toUpperCase(), machine]),
  );

  const resolved: SiteBulkImportRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const key = siteBulkRowKey(row.siteName, row.location);
    if (seenInUpload.has(key)) {
      return {
        ok: false,
        error: `Row ${index + 1}: duplicate site "${row.siteName}" at "${row.location}" in this file.`,
      };
    }
    seenInUpload.add(key);

    if (existingKeys.has(key)) {
      return {
        ok: false,
        error: `Row ${index + 1}: site "${row.siteName}" at "${row.location}" already exists. Existing sites are kept; remove or rename this row.`,
      };
    }

    const machineIds: string[] = [];
    const skippedMachineryCodes: string[] = [];
    const seenCodesInRow = new Set<string>();

    for (const code of row.machineryCodes) {
      const upper = code.toUpperCase();
      if (seenCodesInRow.has(upper)) {
        skippedMachineryCodes.push(code);
        continue;
      }
      seenCodesInRow.add(upper);
      const machine = pool.get(upper);
      if (!machine) {
        skippedMachineryCodes.push(code);
        continue;
      }
      machineIds.push(machine.id);
      pool.delete(upper);
    }

    resolved.push({ ...row, machineIds, skippedMachineryCodes });
  }

  return { ok: true, rows: resolved };
}
