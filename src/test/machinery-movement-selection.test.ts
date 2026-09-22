import { describe, expect, it } from "vitest";
import type { Machine } from "@/domain/types";
import {
  buildMachineryLineSelections,
  selectMachineIdsForQuantity,
  stockSumForMachineIds,
} from "@/lib/machinery-movement-selection";

function makeMachine(partial: Partial<Machine> & Pick<Machine, "id" | "code" | "name">): Machine {
  return {
    category: "Grinding Machine",
    unitType: "metre",
    stockQuantity: 1,
    status: "available",
    assignedSiteId: null,
    lostFromSiteId: null,
    companyId: "co-1",
    ...partial,
  };
}

describe("machinery movement selection", () => {
  const machines = [
    makeMachine({ id: "m1", code: "TES-001", name: "test pipe 1", stockQuantity: 1 }),
    makeMachine({ id: "m2", code: "TES-002", name: "test pipe 2", stockQuantity: 1 }),
    makeMachine({ id: "m3", code: "TES-003", name: "test pipe 3", stockQuantity: 1 }),
  ];
  const byId = new Map(machines.map((machine) => [machine.id, machine]));

  it("groups test pipe units into one line with stock sum", () => {
    const lines = buildMachineryLineSelections(machines);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.label).toBe("test pipe");
    expect(lines[0]?.availableCount).toBe(3);
    expect(lines[0]?.machineIds).toEqual(["m1", "m2", "m3"]);
  });

  it("selects the first N records for quantity moves", () => {
    expect(selectMachineIdsForQuantity(["m1", "m2", "m3"], byId, 2)).toEqual(["m1", "m2"]);
    expect(stockSumForMachineIds(["m1", "m2"], byId)).toBe(2);
  });

  it("supports partial selection from a high-stock row", () => {
    const pooled = [makeMachine({ id: "bulk", code: "TES-099", name: "test pipe 99", stockQuantity: 11 })];
    const pooledById = new Map(pooled.map((machine) => [machine.id, machine]));
    expect(selectMachineIdsForQuantity(["bulk"], pooledById, 2)).toEqual(["bulk"]);
    expect(stockSumForMachineIds(["bulk"], pooledById)).toBe(11);
  });
});
