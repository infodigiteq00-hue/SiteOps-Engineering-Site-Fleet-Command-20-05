import type { Machine, MachineryStatus } from "@/domain/types";
import type { MachineryMovementDirection } from "@/lib/site-allocation-history";
import { suggestMachineryUnits } from "@/lib/machinery-unit-codegen";
import { machineryStockQuantity } from "@/lib/site-closure";
import { mapMachinery } from "@/lib/db-mapper";
import { fetchAllSupabasePages } from "@/lib/supabase-fetch-all";
import { supabase } from "@/lib/supabaseClient";

type MovementPatch = {
  status: MachineryStatus;
  assigned_site_id: string | null;
};

function movementUpdatesForDirection(
  direction: MachineryMovementDirection,
  sourceStatus: MachineryStatus,
  siteId: string,
): MovementPatch {
  if (direction === "out") {
    if (sourceStatus === "maintenance") {
      return { status: "maintenance", assigned_site_id: null };
    }
    return { status: "available", assigned_site_id: null };
  }
  if (sourceStatus === "maintenance") {
    return { status: "maintenance", assigned_site_id: siteId };
  }
  return { status: "assigned", assigned_site_id: siteId };
}

async function insertSplitMachineryRow(
  source: Machine,
  stockQuantity: number,
  patch: MovementPatch,
): Promise<string> {
  const companyRows = await fetchAllSupabasePages((from, to) =>
    supabase
      .from("machinery")
      .select("*")
      .eq("company_id", source.companyId)
      .order("code")
      .range(from, to),
  );
  const companyMachines = companyRows.map((row) => mapMachinery(row));
  const [generated] = suggestMachineryUnits(source.category, companyMachines, 1);
  const code = generated?.code ?? `${source.code}-S`;

  const { data, error } = await supabase
    .from("machinery")
    .insert({
      company_id: source.companyId,
      code,
      name: source.name,
      category: source.category,
      unit_type: source.unitType,
      stock_quantity: stockQuantity,
      status: patch.status,
      assigned_site_id: patch.assigned_site_id,
      project_name: source.projectName ?? null,
      project_location: source.projectLocation ?? null,
      assigned_to: source.assignedTo ?? null,
      approved_by: source.approvedBy ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return String(data.id);
}

/**
 * Apply a movement to concrete machinery rows, splitting stock when only part of a row moves.
 * Returns machine ids to attach to the ledger entry.
 */
export async function applyMachineryMovementStock(
  orderedMachineIds: string[],
  quantity: number,
  direction: MachineryMovementDirection,
  sourceStatus: MachineryStatus,
  siteId: string,
  machinesById: Map<string, Machine>,
): Promise<string[]> {
  const patch = movementUpdatesForDirection(direction, sourceStatus, siteId);
  const ledgerMachineIds: string[] = [];
  let remaining = quantity;

  for (const id of orderedMachineIds) {
    if (remaining <= 0) break;
    const machine = machinesById.get(id);
    if (!machine) continue;

    const stock = machineryStockQuantity(machine);

    if (stock <= remaining) {
      const { error } = await supabase
        .from("machinery")
        .update({
          status: patch.status,
          assigned_site_id: patch.assigned_site_id,
          stock_quantity: stock,
        })
        .eq("id", machine.id);
      if (error) throw error;
      ledgerMachineIds.push(machine.id);
      remaining -= stock;
      continue;
    }

    const moveQty = remaining;
    const { error: reduceErr } = await supabase
      .from("machinery")
      .update({ stock_quantity: stock - moveQty })
      .eq("id", machine.id);
    if (reduceErr) throw reduceErr;

    const newId = await insertSplitMachineryRow(machine, moveQty, patch);
    ledgerMachineIds.push(newId);
    remaining = 0;
  }

  if (remaining > 0) {
    throw new Error("Insufficient stock for this movement");
  }

  return ledgerMachineIds;
}

/** Revert a prior movement before applying an edited movement. */
export async function revertMachineryMovementStock(
  machineIds: string[],
  direction: MachineryMovementDirection,
  sourceStatus: MachineryStatus,
  siteId: string,
  machinesById: Map<string, Machine>,
): Promise<void> {
  const inverseDirection: MachineryMovementDirection = direction === "in" ? "out" : "in";
  const revertSource: MachineryStatus =
    direction === "out"
      ? sourceStatus === "maintenance"
        ? "maintenance"
        : "available"
      : sourceStatus === "maintenance"
        ? "maintenance"
        : "assigned";
  const patch = movementUpdatesForDirection(inverseDirection, revertSource, siteId);

  for (const id of machineIds) {
    const machine = machinesById.get(id);
    if (!machine) continue;
    const { error } = await supabase
      .from("machinery")
      .update({
        status: patch.status,
        assigned_site_id: patch.assigned_site_id,
        stock_quantity: machineryStockQuantity(machine),
      })
      .eq("id", id);
    if (error) throw error;
  }
}
