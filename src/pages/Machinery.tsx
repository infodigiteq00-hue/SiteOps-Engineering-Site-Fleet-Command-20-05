import { useEffect, useMemo, useState } from "react";
import type { MachineryStatus } from "@/domain/types";
import { StatusBadge } from "@/components/StatusBadge";
import { Search } from "lucide-react";
import { AddMachineryDialog } from "@/components/AddMachineryDialog";
import { useCurrentUser } from "@/lib/session";
import { canAddMachinery } from "@/lib/rbac";
import { useScopedMachines, useScopedSites, useScopedLedger } from "@/hooks/useCompanyScope";
import {
  buildLostFromSiteLedgerIndex,
  machineryDisplaySiteName,
  machinerySiteColumnLabel,
} from "@/lib/machinery-site-display";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  useDeleteMachineMutation,
  useDeleteMachinesMutation,
  useUpdateMachineMutation,
  useUpdateMachinesMutation,
} from "@/hooks/useOperationalData";
import { MACHINERY_EDIT_STATUSES, MACHINERY_STATUS_LABELS } from "@/lib/machinery-status-options";
import { formatQtyWithUnit } from "@/lib/machinery-unit-types";
import { machineryStockQuantity } from "@/lib/site-closure";

const Machinery = () => {
  const user = useCurrentUser();
  const machines = useScopedMachines();
  const sites = useScopedSites();
  const ledger = useScopedLedger();
  const lostFromLedger = useMemo(() => buildLostFromSiteLedgerIndex(ledger), [ledger]);
  const updateMutation = useUpdateMachineMutation();
  const bulkUpdateMutation = useUpdateMachinesMutation();
  const deleteMutation = useDeleteMachineMutation();
  const bulkDeleteMutation = useDeleteMachinesMutation();
  const [filter, setFilter] = useState<MachineryStatus | "all">("all");
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [nextStatus, setNextStatus] = useState<MachineryStatus>("available");
  const [nextSiteId, setNextSiteId] = useState("");
  const [lostFromSiteId, setLostFromSiteId] = useState("");

  const filtered = useMemo(() => {
    return machines.filter((m) => {
      if (filter !== "all" && m.status !== filter) return false;
      if (q && !`${m.name} ${m.code} ${m.category}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [machines, filter, q]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, q]);

  const filteredIds = useMemo(() => filtered.map((m) => m.id), [filtered]);
  const selectedCount = selectedIds.size;
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someFilteredSelected = filteredIds.some((id) => selectedIds.has(id));

  const counts = {
    all: machines.length,
    available: machines.filter((m) => m.status === "available").length,
    assigned: machines.filter((m) => m.status === "assigned").length,
    maintenance: machines.filter((m) => m.status === "maintenance").length,
    lost_damaged: machines.filter((m) => m.status === "lost_damaged").length,
  };
  const editingMachine = editingMachineId ? machines.find((machine) => machine.id === editingMachineId) ?? null : null;
  const selectedMachines = useMemo(
    () => machines.filter((machine) => selectedIds.has(machine.id)),
    [machines, selectedIds],
  );
  const editingTargets = bulkEditing ? selectedMachines : editingMachine ? [editingMachine] : [];
  const isBulkEdit = bulkEditing && editingTargets.length > 0;
  const dialogOpen = bulkEditing || Boolean(editingMachine);
  const saving = updateMutation.isPending || bulkUpdateMutation.isPending;

  const toggleRow = (machineId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(machineId);
      else next.delete(machineId);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const id of filteredIds) next.add(id);
      } else {
        for (const id of filteredIds) next.delete(id);
      }
      return next;
    });
  };

  const primeEditForm = (machineIds: string[]) => {
    const first = machines.find((item) => item.id === machineIds[0]);
    if (!first) return false;
    const sameStatus = machineIds.every((id) => machines.find((item) => item.id === id)?.status === first.status);
    const sameSite = machineIds.every(
      (id) => machines.find((item) => item.id === id)?.assignedSiteId === first.assignedSiteId,
    );
    setNextStatus(sameStatus ? first.status : "available");
    setNextSiteId(sameSite ? (first.assignedSiteId ?? "") : "");
    setLostFromSiteId(first.lostFromSiteId ?? first.assignedSiteId ?? "");
    return true;
  };

  const openActionDialog = (machineId: string) => {
    const useSelection = selectedIds.size > 1 && selectedIds.has(machineId);
    const targetIds = useSelection ? [...selectedIds] : [machineId];
    if (!primeEditForm(targetIds)) return;
    setBulkEditing(useSelection);
    setEditingMachineId(useSelection ? null : machineId);
  };

  const openBulkEditDialog = () => {
    const targetIds = [...selectedIds];
    if (targetIds.length === 0) return;
    if (!primeEditForm(targetIds)) return;
    setBulkEditing(true);
    setEditingMachineId(null);
  };

  const closeActionDialog = () => {
    setEditingMachineId(null);
    setBulkEditing(false);
  };

  const saveAction = () => {
    if (editingTargets.length === 0) return;
    if (nextStatus === "assigned" && !nextSiteId) {
      toast({ title: "Missing site", description: "Please select a site when status is assigned.", variant: "destructive" });
      return;
    }
    const needsLostSite = nextStatus === "lost_damaged" && editingTargets.some((machine) => !machine.assignedSiteId);
    if (needsLostSite && !lostFromSiteId) {
      toast({
        title: "Missing site",
        description: "Select which site these units were lost or damaged at.",
        variant: "destructive",
      });
      return;
    }
    const updates: {
      status: MachineryStatus;
      assignedSiteId: string | null;
      lostFromSiteId?: string | null;
    } = {
      status: nextStatus,
      assignedSiteId: nextStatus === "assigned" ? nextSiteId : null,
    };
    if (nextStatus === "lost_damaged") {
      updates.lostFromSiteId = lostFromSiteId || null;
    }

    const onSuccess = (count: number) => {
      toast({
        title: count > 1 ? "Machinery updated" : "Machinery updated",
        description:
          count > 1
            ? `${count} units were updated to ${MACHINERY_STATUS_LABELS[nextStatus]}.`
            : "Status and assignment updated successfully.",
      });
      closeActionDialog();
    };
    const onError = (err: unknown) =>
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });

    if (editingTargets.length === 1) {
      const machine = editingTargets[0]!;
      if (nextStatus === "lost_damaged") {
        updates.lostFromSiteId = machine.assignedSiteId ?? (lostFromSiteId || null);
      }
      updateMutation.mutate({ machineId: machine.id, updates }, { onSuccess: () => onSuccess(1), onError });
      return;
    }

    bulkUpdateMutation.mutate(
      { machineIds: editingTargets.map((machine) => machine.id), updates },
      { onSuccess, onError },
    );
  };

  const deleteMachinery = () => {
    if (!editingMachine) return;
    if (
      !window.confirm(
        `Delete "${editingMachine.name}" (${editingMachine.code})? This permanently removes this machinery record.`,
      )
    )
      return;
    deleteMutation.mutate(editingMachine.id, {
      onSuccess: () => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(editingMachine.id);
          return next;
        });
        toast({ title: "Machinery deleted", description: "This unit has been removed from the catalog." });
        closeActionDialog();
      },
      onError: (err) =>
        toast({
          title: "Delete failed",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        }),
    });
  };

  const bulkDeleteMachinery = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const label = ids.length === 1 ? "1 selected machinery unit" : `${ids.length} selected machinery units`;
    if (!window.confirm(`Delete ${label}? This permanently removes them from the catalog.`)) return;
    bulkDeleteMutation.mutate(ids, {
      onSuccess: (deletedCount) => {
        setSelectedIds(new Set());
        toast({
          title: "Machinery deleted",
          description:
            deletedCount === 1
              ? "1 unit has been removed from the catalog."
              : `${deletedCount} units have been removed from the catalog.`,
        });
      },
      onError: (err) =>
        toast({
          title: "Bulk delete failed",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        }),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "available", "assigned", "maintenance", "lost_damaged"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
              filter === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {k === "lost_damaged" ? "lost / damaged" : k}{" "}
            <span className="ml-1 opacity-70 tabular-nums">{counts[k]}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selectedCount === 0 || saving}
            onClick={openBulkEditDialog}
          >
            {selectedCount > 0 ? `Bulk edit (${selectedCount})` : "Bulk edit"}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={selectedCount === 0 || bulkDeleteMutation.isPending}
            onClick={bulkDeleteMachinery}
          >
            {bulkDeleteMutation.isPending
              ? "Deleting…"
              : selectedCount > 0
                ? `Bulk delete (${selectedCount})`
                : "Bulk delete"}
          </Button>
          {canAddMachinery(user.role) && <AddMachineryDialog />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search machinery..."
              className="w-56 rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-3">
                <Checkbox
                  aria-label="Select all machinery"
                  checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                  disabled={filteredIds.length === 0}
                  onCheckedChange={(value) => toggleSelectAll(value === true)}
                />
              </th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Qnt</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">{machinerySiteColumnLabel(filter)}</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const siteName = machineryDisplaySiteName(m, sites, lostFromLedger);
              const isSelected = selectedIds.has(m.id);
              return (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-secondary/30">
                  <td className="px-4 py-2.5">
                    <Checkbox
                      aria-label={`Select ${m.code}`}
                      checked={isSelected}
                      onCheckedChange={(value) => toggleRow(m.id, value === true)}
                    />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{m.code}</td>
                  <td className="px-4 py-2.5 font-medium">{m.category}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{m.name}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                    {formatQtyWithUnit(machineryStockQuantity(m), m.unitType) || "—"}
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {siteName ?? <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button type="button" variant="outline" size="sm" onClick={() => openActionDialog(m.id)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No machinery matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeActionDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isBulkEdit ? "Update selected machinery" : "Update machinery action"}</DialogTitle>
            <DialogDescription>
              {isBulkEdit
                ? `Change status for ${editingTargets.length} selected units together.`
                : "Change status or move this machinery to a different site."}
            </DialogDescription>
          </DialogHeader>
          {editingTargets.length > 0 && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-secondary/20 p-3 text-sm">
                {isBulkEdit ? (
                  <>
                    <div className="font-semibold">{editingTargets.length} machinery units selected</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {editingTargets
                        .slice(0, 4)
                        .map((machine) => machine.code)
                        .join(", ")}
                      {editingTargets.length > 4 ? ` +${editingTargets.length - 4} more` : ""}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold">{editingTargets[0]!.name}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{editingTargets[0]!.code}</div>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </label>
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as MachineryStatus)}
                >
                  {MACHINERY_EDIT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {MACHINERY_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </div>

              {nextStatus === "lost_damaged" && editingTargets.some((machine) => !machine.assignedSiteId) && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Lost / damaged at site
                  </label>
                  <select
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    value={lostFromSiteId}
                    onChange={(e) => setLostFromSiteId(e.target.value)}
                  >
                    <option value="">Select site</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {nextStatus === "assigned" && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Assigned site
                  </label>
                  <select
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    value={nextSiteId}
                    onChange={(e) => setNextSiteId(e.target.value)}
                  >
                    <option value="">Select site</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="justify-between sm:justify-between">
            {editingMachine && !isBulkEdit ? (
              <Button
                type="button"
                variant="destructive"
                onClick={deleteMachinery}
                disabled={deleteMutation.isPending}
              >
                Delete machinery
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeActionDialog}>
                Cancel
              </Button>
              <Button type="button" onClick={saveAction} disabled={saving}>
                {saving ? "Saving…" : isBulkEdit ? `Save ${editingTargets.length} units` : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Machinery;
