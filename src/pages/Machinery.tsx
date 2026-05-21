import { useMemo, useState } from "react";
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
import { toast } from "@/hooks/use-toast";
import { useDeleteMachineMutation, useUpdateMachineMutation } from "@/hooks/useOperationalData";
import { MACHINERY_EDIT_STATUSES, MACHINERY_STATUS_LABELS } from "@/lib/machinery-status-options";

const Machinery = () => {
  const user = useCurrentUser();
  const machines = useScopedMachines();
  const sites = useScopedSites();
  const ledger = useScopedLedger();
  const lostFromLedger = useMemo(() => buildLostFromSiteLedgerIndex(ledger), [ledger]);
  const updateMutation = useUpdateMachineMutation();
  const deleteMutation = useDeleteMachineMutation();
  const [filter, setFilter] = useState<MachineryStatus | "all">("all");
  const [q, setQ] = useState("");
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
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

  const counts = {
    all: machines.length,
    available: machines.filter((m) => m.status === "available").length,
    assigned: machines.filter((m) => m.status === "assigned").length,
    maintenance: machines.filter((m) => m.status === "maintenance").length,
    lost_damaged: machines.filter((m) => m.status === "lost_damaged").length,
  };
  const editingMachine = editingMachineId ? machines.find((machine) => machine.id === editingMachineId) ?? null : null;

  const openActionDialog = (machineId: string) => {
    const machine = machines.find((item) => item.id === machineId);
    if (!machine) return;
    setEditingMachineId(machine.id);
    setNextStatus(machine.status);
    setNextSiteId(machine.assignedSiteId ?? "");
    setLostFromSiteId(machine.lostFromSiteId ?? machine.assignedSiteId ?? "");
  };

  const closeActionDialog = () => {
    setEditingMachineId(null);
  };

  const saveAction = () => {
    if (!editingMachine) return;
    if (nextStatus === "assigned" && !nextSiteId) {
      toast({ title: "Missing site", description: "Please select a site when status is assigned.", variant: "destructive" });
      return;
    }
    if (nextStatus === "lost_damaged" && !lostFromSiteId && !editingMachine.assignedSiteId) {
      toast({
        title: "Missing site",
        description: "Select which site this unit was lost or damaged at.",
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
      updates.lostFromSiteId = editingMachine.assignedSiteId ?? (lostFromSiteId || null);
    }
    updateMutation.mutate(
      {
        machineId: editingMachine.id,
        updates,
      },
      {
        onSuccess: () => {
          toast({ title: "Machinery updated", description: "Status and assignment updated successfully." });
          closeActionDialog();
        },
        onError: (err) =>
          toast({
            title: "Update failed",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          }),
      },
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
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">{machinerySiteColumnLabel(filter)}</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const siteName = machineryDisplaySiteName(m, sites, lostFromLedger);
              return (
                <tr key={m.id} className="border-b border-border last:border-0 hover:bg-secondary/30">
                  <td className="px-4 py-2.5 font-mono text-xs">{m.code}</td>
                  <td className="px-4 py-2.5 font-medium">{m.category}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{m.name}</td>
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
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No machinery matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(editingMachine)} onOpenChange={(open) => !open && closeActionDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update machinery action</DialogTitle>
            <DialogDescription>Change status or move this machinery to a different site.</DialogDescription>
          </DialogHeader>
          {editingMachine && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-secondary/20 p-3 text-sm">
                <div className="font-semibold">{editingMachine.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{editingMachine.code}</div>
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

              {nextStatus === "lost_damaged" && !editingMachine.assignedSiteId && (
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
            <Button
              type="button"
              variant="destructive"
              onClick={deleteMachinery}
              disabled={deleteMutation.isPending}
            >
              Delete machinery
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeActionDialog}>
                Cancel
              </Button>
              <Button type="button" onClick={saveAction} disabled={updateMutation.isPending}>
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Machinery;
