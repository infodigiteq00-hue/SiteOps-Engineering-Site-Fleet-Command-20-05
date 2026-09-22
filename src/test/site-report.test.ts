import { describe, expect, it } from "vitest";
import type { LedgerEntry, Machine, Site } from "@/domain/types";
import { buildAssignedMachineryTableRows, buildSiteReport } from "@/lib/site-report";
import { simpleReportRowCells } from "@/lib/site-report-export";
import {
  classifySiteHistoryEntry,
  movementEventKindFromDirection,
  type MachineryMovementDirection,
} from "@/lib/site-allocation-history";

const site: Site = {
  id: "site-1",
  name: "DAHEJ",
  code: "DAH-001",
  location: "Dahej",
  manager: "Manager",
  status: "active",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  companyId: "co-1",
};

function makeMachine(id: string, code: string, name = `pipe ${id} unit`): Machine {
  return {
    id,
    code,
    name,
    category: "Grinding Machine",
    unitType: "metre",
    stockQuantity: 1,
    status: "assigned",
    assignedSiteId: site.id,
    lostFromSiteId: null,
    companyId: site.companyId,
  };
}

function makeOutEntry(id: string, machineId: string, gatePass: string, qty = 1): LedgerEntry {
  return {
    id,
    companyId: site.companyId,
    eventKind: "machinery_moved_out",
    summary: `${qty} metre Qty test pipe moved OUT from ${site.name} by Tester (Available pool) · Gate pass ${gatePass}.`,
    siteId: site.id,
    machineIds: [machineId],
    requester: "Tester",
    approvedBy: "Tester",
    approverRole: "Admin",
    fromDate: "2026-09-01",
    untilDate: null,
    totalUnits: qty,
    approvedAt: "2026-09-01T12:00:00.000Z",
  };
}

describe("buildAssignedMachineryTableRows", () => {
  it("creates one row per store-to-site OUT movement with gate pass and qty", () => {
    const machines = [makeMachine("m1", "TES-001", "alpha pipe"), makeMachine("m2", "TES-002", "beta pipe")];
    const ledger = [makeOutEntry("l1", "m1", "GP-0109"), makeOutEntry("l2", "m2", "GP-0110")];

    const rows = buildAssignedMachineryTableRows("Grinding Machine", site, ledger, machines, machines);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.outQty).toBe("1 metre");
    expect(rows[0]?.outGatePass).toBe("GP-0109");
    expect(rows[0]?.ledgerEntryId).toBe("l1");
    expect(rows[0]?.machineId).toBe("m1");
    expect(rows[1]?.outQty).toBe("1 metre");
    expect(rows[1]?.outGatePass).toBe("GP-0110");
    expect(rows[1]?.ledgerEntryId).toBe("l2");
    expect(rows[1]?.machineId).toBe("m2");
    expect(rows[0]?.inQty).toBe("");
    expect(rows[0]?.inGatePass).toBe("");
  });
});

function makeMovementEntry(opts: {
  id: string;
  direction: MachineryMovementDirection;
  machineId: string;
  machineryLabel: string;
  gatePass: string;
  qty: number;
  date: string;
  unitType?: string;
}): LedgerEntry {
  const unitType = opts.unitType ?? "metre";
  const verb = opts.direction === "in" ? "moved OUT from" : "received IN at";
  return {
    id: opts.id,
    companyId: site.companyId,
    eventKind: movementEventKindFromDirection(opts.direction),
    summary: `${opts.qty} ${unitType} Qty ${opts.machineryLabel} ${verb} ${site.name} by Tester (Available pool) · Gate pass ${opts.gatePass}.`,
    siteId: site.id,
    machineIds: [opts.machineId],
    requester: "Tester",
    approvedBy: "Tester",
    approverRole: "Admin",
    fromDate: opts.date,
    untilDate: null,
    totalUnits: opts.qty,
    approvedAt: `${opts.date}T12:00:00.000Z`,
  };
}

describe("buildSiteReport movement placement", () => {
  it("puts store-to-site (UI OUT) data only in OUT cells", () => {
    const machine = makeMachine("hose-1", "HOS-001");
    machine.name = "Hose pipe 5 inch dia";
    machine.category = "Hose pipe 5 inch dia";
    machine.stockQuantity = 50;

    const ledger = [
      makeMovementEntry({
        id: "out-1",
        direction: "in",
        machineId: machine.id,
        machineryLabel: "Hose pipe 5 inch dia",
        gatePass: "GP-OUT-50",
        qty: 50,
        date: "2026-09-10",
      }),
    ];

    expect(classifySiteHistoryEntry(ledger[0]!)).toBe("out");
    const report = buildSiteReport(site, ledger, [machine], null);
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.outGatePass).toBe("GP-OUT-50");
    expect(row.outDate).toBe("10-Sep-2026");
    expect(row.outQty).toBe("50 metre");
    expect(row.inGatePass).toBe("");
    expect(row.inDate).toBe("");
    expect(row.inQty).toBe("");
    expect(row.onSiteToday).toBe("50 metre at site");
  });

  it("puts site-to-store (UI IN) data only in IN cells", () => {
    const machine = makeMachine("hose-1", "HOS-001");
    machine.name = "Hose pipe 5 inch dia";
    machine.category = "Hose pipe 5 inch dia";
    machine.assignedSiteId = null;
    machine.status = "available";

    const ledger = [
      makeMovementEntry({
        id: "in-1",
        direction: "out",
        machineId: machine.id,
        machineryLabel: "Hose pipe 5 inch dia",
        gatePass: "GP-IN-20",
        qty: 20,
        date: "2026-09-12",
      }),
    ];

    expect(classifySiteHistoryEntry(ledger[0]!)).toBe("in");
    const report = buildSiteReport(site, ledger, [machine], null);
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.inGatePass).toBe("GP-IN-20");
    expect(row.inDate).toBe("12-Sep-2026");
    expect(row.inQty).toBe("20 metre");
    expect(row.outGatePass).toBe("");
    expect(row.outDate).toBe("");
    expect(row.outQty).toBe("");
  });

  it("keeps paired IN and OUT values on their own sides", () => {
    const machine = makeMachine("hose-1", "HOS-001");
    machine.name = "Hose pipe 5 inch dia";
    machine.category = "Hose pipe 5 inch dia";
    machine.stockQuantity = 30;

    const ledger = [
      makeMovementEntry({
        id: "out-1",
        direction: "in",
        machineId: machine.id,
        machineryLabel: "Hose pipe 5 inch dia",
        gatePass: "GP-OUT-50",
        qty: 50,
        date: "2026-09-10",
      }),
      makeMovementEntry({
        id: "in-1",
        direction: "out",
        machineId: machine.id,
        machineryLabel: "Hose pipe 5 inch dia",
        gatePass: "GP-IN-20",
        qty: 20,
        date: "2026-09-12",
      }),
    ];

    const report = buildSiteReport(site, ledger, [machine], null);
    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.outGatePass).toBe("GP-OUT-50");
    expect(row.outQty).toBe("50 metre");
    expect(row.outDate).toBe("10-Sep-2026");
    expect(row.inGatePass).toBe("GP-IN-20");
    expect(row.inQty).toBe("20 metre");
    expect(row.inDate).toBe("12-Sep-2026");
  });

  it("renders cells as gate pass, date, qty for both OUT and IN", () => {
    const machine = makeMachine("hose-1", "HOS-001");
    machine.name = "Hose pipe 5 inch dia";
    machine.category = "Hose pipe 5 inch dia";
    machine.stockQuantity = 50;
    const ledger = [
      makeMovementEntry({
        id: "out-1",
        direction: "in",
        machineId: machine.id,
        machineryLabel: "Hose pipe 5 inch dia",
        gatePass: "GP-OUT-50",
        qty: 50,
        date: "2026-09-10",
      }),
      makeMovementEntry({
        id: "in-1",
        direction: "out",
        machineId: machine.id,
        machineryLabel: "Hose pipe 5 inch dia",
        gatePass: "GP-IN-20",
        qty: 20,
        date: "2026-09-12",
      }),
    ];
    const report = buildSiteReport(site, ledger, [machine], null);
    expect(simpleReportRowCells(report.rows[0]!)).toEqual([
      "Hose pipe 5 inch dia",
      "GP-OUT-50",
      "10-Sep-2026",
      "50 metre",
      "GP-IN-20",
      "12-Sep-2026",
      "20 metre",
      "50 metre at site",
    ]);
  });

  it("does not invent movement rows when ledger has no IN/OUT entries", () => {
    const machine = makeMachine("hose-1", "HOS-001");
    machine.name = "Hose pipe 5 inch dia";
    machine.category = "Hose pipe 5 inch dia";
    machine.stockQuantity = 50;
    machine.unitType = "metre";

    const report = buildSiteReport(site, [], [machine], null);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.outQty).toBe("");
    expect(report.rows[0]?.inQty).toBe("");
    expect(report.rows[0]?.outGatePass).toBe("");
    expect(report.rows[0]?.inGatePass).toBe("");
    expect(report.rows[0]?.onSiteToday).toBe("50 metre at site");
  });
});
