import { describe, it, expect } from "vitest";
import type { Machine, Site } from "@/domain/types";
import {
  buildBulkSiteResolutionsAndQueue,
  existingSiteForBulkWizardConflict,
  findBulkSiteForMachineryImport,
  MACHINERY_BULK_SAMPLE_CSV,
  parseBulkStructural,
  bulkGroupParsedRows,
  siteDeploymentExists,
  siteAssignmentKey,
} from "@/lib/machinery-bulk-upload";

const companyA = "co-a";
const siteUpl: Site = {
  id: "s-upl",
  companyId: companyA,
  name: "UPL Limited — Panoli",
  code: "UPL",
  location: "Panoli, Gujarat",
  manager: "Lead",
  status: "active",
  startDate: "2025-01-01",
  endDate: "2026-01-01",
};

const machines: Machine[] = [
  {
    id: "m1",
    companyId: companyA,
    code: "GRD-001",
    name: "Grinder 1",
    category: "Grinding Machine",
    unitType: "nos",
    status: "assigned",
    assignedSiteId: "s-upl",
    projectName: "UPL Limited — Panoli",
    projectLocation: "Panoli, Gujarat",
    assignedTo: null,
    approvedBy: null,
    lostFromSiteId: null,
    closureNotes: null,
  },
];

describe("findBulkSiteForMachineryImport", () => {
  it("matches exact name and location", () => {
    const result = findBulkSiteForMachineryImport([siteUpl], siteUpl.name, siteUpl.location, companyA);
    expect(result.kind).toBe("exact");
    if (result.kind === "exact") expect(result.site.id).toBe("s-upl");
  });

  it("does not fuzzy-match unrelated site names", () => {
    const other: Site = { ...siteUpl, id: "s-other", name: "UPL Limited — Panoli Phase 2 Extension" };
    const result = findBulkSiteForMachineryImport([siteUpl, other], "UPL", "Panoli, Gujarat", companyA);
    expect(result.kind).toBe("none");
  });

  it("treats same name at a different location as a separate site", () => {
    const result = findBulkSiteForMachineryImport([siteUpl], siteUpl.name, "Dahej, Gujarat", companyA);
    expect(result.kind).toBe("none");
  });

  it("matches one of several same-name sites when location matches", () => {
    const dahej: Site = { ...siteUpl, id: "s-dahej", location: "Dahej, Gujarat" };
    const result = findBulkSiteForMachineryImport([siteUpl, dahej], siteUpl.name, "Dahej, Gujarat", companyA);
    expect(result.kind).toBe("exact");
    if (result.kind === "exact") expect(result.site.id).toBe("s-dahej");
  });
});

describe("existingSiteForBulkWizardConflict", () => {
  it("finds exact deployment when queue was built with stale sites", () => {
    const pidilite: Site = {
      ...siteUpl,
      id: "s-pid",
      name: "PIDILITE - DAHEJ",
      location: "ANKLESHWAR GUJARAT",
    };
    const resolved = existingSiteForBulkWizardConflict(
      [pidilite],
      "PIDILITE - DAHEJ",
      "ANKLESHWAR GUJARAT",
      companyA,
    );
    expect(resolved?.site.id).toBe("s-pid");
    expect(resolved?.locationMismatch).toBe(false);
  });

  it("does not resolve when only the site name matches", () => {
    const resolved = existingSiteForBulkWizardConflict(
      [siteUpl],
      siteUpl.name,
      "Different CSV location",
      companyA,
    );
    expect(resolved).toBeNull();
  });
});

describe("buildBulkSiteResolutionsAndQueue", () => {
  it("auto-resolves exact site without wizard", () => {
    const rows = [
      {
        category: "Grinding Machine",
        status: "assigned" as const,
        projectName: siteUpl.name,
        projectLocation: siteUpl.location,
        unitType: "nos" as const,
        code: "GRD-002",
        name: "Grinder 2",
      },
    ];
    const { resolutions, queue } = buildBulkSiteResolutionsAndQueue(rows, [siteUpl], companyA);
    expect(queue).toHaveLength(0);
    expect(resolutions[siteAssignmentKey(siteUpl.name, siteUpl.location)]?.siteId).toBe("s-upl");
  });
});

describe("bulkGroupParsedRows", () => {
  it("preserves existing on-site count in preview", () => {
    const rows = [
      {
        category: "Grinding Machine",
        status: "assigned" as const,
        projectName: siteUpl.name,
        projectLocation: siteUpl.location,
        unitType: "nos" as const,
        code: "GRD-002",
        name: "Grinder 2",
      },
    ];
    const resolutions = {
      [siteAssignmentKey(siteUpl.name, siteUpl.location)]: { siteId: siteUpl.id, displayName: siteUpl.name },
    };
    const groups = bulkGroupParsedRows(rows, resolutions, machines, companyA);
    expect(groups[0].existingUnitCount).toBe(1);
    expect(groups[0].units).toHaveLength(1);
  });
});

describe("siteDeploymentExists", () => {
  it("detects duplicate deployment", () => {
    expect(siteDeploymentExists([siteUpl], siteUpl.name, siteUpl.location, companyA)).toBe(true);
    expect(siteDeploymentExists([siteUpl], siteUpl.name, "Other City", companyA)).toBe(false);
  });
});

describe("parseBulkStructural", () => {
  it("creates only new rows from qty", () => {
    const csv = [
      "projectName,location,category,qty,unit_type,status",
      '"UPL Limited — Panoli","Panoli, Gujarat",Grinding Machine,2,nos,assigned',
    ].join("\n");
    const result = parseBulkStructural(csv, machines, companyA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(2);
  });

  it("ships the standard sample template with four data rows", () => {
    const result = parseBulkStructural(MACHINERY_BULK_SAMPLE_CSV, machines, companyA);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toHaveLength(7);
  });
});

describe("buildBulkSiteResolutionsAndQueue for create site", () => {
  it("does not auto-resolve when autoResolveExactMatches is false", () => {
    const rows = [
      {
        category: "Grinding Machine",
        status: "assigned" as const,
        projectName: siteUpl.name,
        projectLocation: siteUpl.location,
        unitType: "nos" as const,
        code: "GRD-002",
        name: "Grinder 2",
      },
    ];
    const { resolutions, queue } = buildBulkSiteResolutionsAndQueue(rows, [siteUpl], companyA, {
      autoResolveExactMatches: false,
      includeAllDeployments: true,
    });
    expect(Object.keys(resolutions)).toHaveLength(0);
    expect(queue).toHaveLength(1);
    expect(queue[0].existingSite?.id).toBe("s-upl");
  });
});
