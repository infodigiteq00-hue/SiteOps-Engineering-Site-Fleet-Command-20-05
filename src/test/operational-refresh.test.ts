import { describe, expect, it } from "vitest";
import { operationalSlicesForTable } from "@/hooks/useOperationalData";

describe("operationalSlicesForTable", () => {
  it("maps a machinery change to the machinery slice only", () => {
    expect(operationalSlicesForTable("machinery")).toEqual(["machinery"]);
  });

  it("maps ledger and request tables to their own slices", () => {
    expect(operationalSlicesForTable("audit_ledger")).toEqual(["ledger"]);
    expect(operationalSlicesForTable("machinery_requests")).toEqual(["requests"]);
  });

  it("does not treat profile changes as a full operational reload", () => {
    expect(operationalSlicesForTable("profiles")).toEqual([]);
  });
});
