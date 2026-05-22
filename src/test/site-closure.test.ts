import { describe, it, expect } from "vitest";
import type { Machine } from "@/domain/types";
import {
  groupSiteMachinery,
  machineryNameGroupKey,
  initialSimpleClosureState,
  simpleStateToQtyLines,
  simpleClosureStateValid,
  usesDetailedRemainderClosure,
} from "@/lib/site-closure";
import { buildSiteClosureArchive, summarizeClosureArchiveCategory } from "@/lib/site-closure-archive";
import type { LedgerEntry } from "@/domain/types";

function machine(partial: Partial<Machine> & Pick<Machine, "id" | "name" | "code">): Machine {
  return {
    category: "Compressor Unit",
    unitType: "nos",
    status: "assigned",
    assignedSiteId: "site-1",
    lostFromSiteId: null,
    companyId: "co-1",
    ...partial,
  };
}

describe("machineryNameGroupKey", () => {
  it("strips trailing unit numbers", () => {
    expect(machineryNameGroupKey("ALLU. LADDER 6 MTR 'I' TYPE 1")).toBe("ALLU. LADDER 6 MTR 'I' TYPE");
    expect(machineryNameGroupKey("ALLU. LADDER 6 MTR 'I' TYPE 2")).toBe("ALLU. LADDER 6 MTR 'I' TYPE");
  });

  it("keeps names without a trailing number", () => {
    expect(machineryNameGroupKey("ROPE 50M")).toBe("ROPE 50M");
  });
});

describe("groupSiteMachinery", () => {
  it("groups numbered units of the same type", () => {
    const machines = [
      machine({ id: "m1", code: "LAD-001", name: "ALLU. LADDER 6 MTR 'I' TYPE 1" }),
      machine({ id: "m2", code: "LAD-002", name: "ALLU. LADDER 6 MTR 'I' TYPE 2" }),
      machine({ id: "m3", code: "CB-001", name: "CHAIN BLOCK 3 TON 1" }),
    ];
    const groups = groupSiteMachinery(machines, "site-1");
    expect(groups).toHaveLength(2);
    const ladder = groups.find((g) => g.label.includes("LADDER"));
    expect(ladder?.count).toBe(2);
    expect(ladder?.machineIds).toEqual(["m1", "m2"]);
  });

  it("keeps metre units in the same group", () => {
    const machines = [
      machine({ id: "r1", code: "RP-001", name: "ROPE 12MM 1", unitType: "metre" }),
      machine({ id: "r2", code: "RP-002", name: "ROPE 12MM 2", unitType: "metre" }),
    ];
    const groups = groupSiteMachinery(machines, "site-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.unitType).toBe("metre");
  });
});

describe("simple closure remainder", () => {
  it("splits partial pool return with per-unit remainder lines", () => {
    const machines = [
      machine({ id: "m1", code: "A-001", name: "PULLEY 1" }),
      machine({ id: "m2", code: "A-002", name: "PULLEY 2" }),
      machine({ id: "m3", code: "A-003", name: "PULLEY 3" }),
      machine({ id: "m4", code: "A-004", name: "PULLEY 4" }),
    ];
    const groups = groupSiteMachinery(machines, "site-1");
    const group = groups[0]!;
    const state = initialSimpleClosureState(groups)[group.key]!;
    state.availableCount = 2;
    state.remainderByUnitId["m3"] = { action: "maintenance", relocateSiteId: "", remarks: "" };
    state.remainderByUnitId["m4"] = { action: "lost_damaged", relocateSiteId: "", remarks: "missing" };

    expect(usesDetailedRemainderClosure(2)).toBe(true);
    expect(simpleClosureStateValid(state, 4, group)).toBe(true);

    const lines = simpleStateToQtyLines(group, state);
    const available = lines.find((l) => l.action === "available");
    expect(available?.qty).toBe(2);
    expect(lines.filter((l) => l.action !== "available")).toHaveLength(2);
  });
});

describe("buildSiteClosureArchive", () => {
  it("rebuilds machinery outcomes from closure ledger", () => {
    const machines = [
      machine({ id: "m1", code: "A-001", name: "PULLEY 1" }),
      machine({ id: "m2", code: "A-002", name: "PULLEY 2" }),
    ];
    const ledger: LedgerEntry[] = [
      {
        id: "l1",
        companyId: "co-1",
        eventKind: "machinery_site_closure",
        summary: "1 unit (PULLEY) marked available after closure of Site A by Admin.",
        siteId: "site-1",
        machineIds: ["m1"],
        requester: "Admin",
        approvedBy: "Admin",
        approvedAt: "2026-05-22T10:00:00Z",
        fromDate: "2026-05-22",
        toDate: "2026-05-22",
        totalUnits: 1,
      },
      {
        id: "l2",
        companyId: "co-1",
        eventKind: "machinery_site_closure",
        summary: "1 unit (PULLEY) marked lost/damaged during site completion of Site A by Admin.",
        siteId: "site-1",
        machineIds: ["m2"],
        requester: "Admin",
        approvedBy: "Admin",
        approvedAt: "2026-05-22T10:00:00Z",
        fromDate: "2026-05-22",
        toDate: "2026-05-22",
        totalUnits: 1,
      },
    ];
    const archive = buildSiteClosureArchive("site-1", ledger, machines);
    expect(archive).toHaveLength(2);
    expect(archive.find((r) => r.machineId === "m1")?.closureAction).toBe("available");
    expect(archive.find((r) => r.machineId === "m2")?.closureAction).toBe("lost_damaged");
  });
});

describe("summarizeClosureArchiveCategory", () => {
  it("describes mixed outcomes in one sentence", () => {
    const sentence = summarizeClosureArchiveCategory([
      {
        machineId: "1",
        code: "BAS-001",
        name: "BASE PLATE 1",
        category: "BASE PLATE",
        unitType: "nos",
        closureAction: "available",
        closureLabel: "Back in company pool",
      },
      {
        machineId: "2",
        code: "BAS-002",
        name: "BASE PLATE 2",
        category: "BASE PLATE",
        unitType: "nos",
        closureAction: "available",
        closureLabel: "Back in company pool",
      },
      {
        machineId: "3",
        code: "BAS-003",
        name: "BASE PLATE 3",
        category: "BASE PLATE",
        unitType: "nos",
        closureAction: "maintenance",
        closureLabel: "Needs repair (maintenance)",
      },
      {
        machineId: "4",
        code: "BAS-004",
        name: "BASE PLATE 4",
        category: "BASE PLATE",
        unitType: "nos",
        closureAction: "lost_damaged",
        closureLabel: "Lost or damaged",
      },
    ]);
    expect(sentence).toContain("4 nos");
    expect(sentence).toContain("returned to company pool");
    expect(sentence).toContain("maintenance");
    expect(sentence).toContain("lost or damaged");
  });

  it("uses a short line when everything returned to pool", () => {
    const sentence = summarizeClosureArchiveCategory([
      {
        machineId: "1",
        code: "CR-001",
        name: "EOT Crane 1",
        category: "EOT Crane",
        unitType: "metre",
        closureAction: "available",
        closureLabel: "Back in company pool",
      },
    ]);
    expect(sentence).toBe("All 1 metre returned to the company pool.");
  });
});
