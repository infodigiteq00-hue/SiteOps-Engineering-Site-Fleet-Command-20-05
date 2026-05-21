import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, MapPin, User, Calendar, Wrench, Truck } from "lucide-react";
import type { LedgerEntry, MachineryStatus } from "@/domain/types";
import { MACHINERY_EDIT_STATUSES, MACHINERY_STATUS_LABELS } from "@/lib/machinery-status-options";
import { format } from "date-fns";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentUser } from "@/lib/session";
import { canAccessSite, canEditMachineryOnSite, canCreateMachineryRequest } from "@/lib/rbac";
import { useScopedSites, useScopedMachines, useScopedLedger } from "@/hooks/useCompanyScope";
import { useUpdateMachineMutation } from "@/hooks/useOperationalData";
import { ManageMachineryDialog } from "@/components/ManageMachineryDialog";
import { SiteAllocationHistory } from "@/components/SiteAllocationHistory";
import { SiteClosureReport } from "@/components/SiteClosureReport";
import { SiteReportExportMenu } from "@/components/SiteReportExportMenu";
import { resolveSiteClosureSummary } from "@/lib/site-closure-summary";

const SiteDetail = () => {
  const { id } = useParams();
  const user = useCurrentUser();
  const sites = useScopedSites();
  const machines = useScopedMachines();
  const ledger = useScopedLedger();
  const updateMutation = useUpdateMachineMutation();
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<MachineryStatus>("assigned");
  const [targetSiteId, setTargetSiteId] = useState<string>("");
  const [manageMovementOpen, setManageMovementOpen] = useState(false);
  const [manageMovementEditEntry, setManageMovementEditEntry] = useState<LedgerEntry | null>(null);
  const site = sites.find((s) => s.id === id);
  const allowMachineryEdit = canEditMachineryOnSite(user.role);
  const showRequestMachinery = canCreateMachineryRequest(user.role);

  const editingMachine = useMemo(
    () => (editingMachineId ? machines.find((machine) => machine.id === editingMachineId) ?? null : null),
    [editingMachineId, machines],
  );
  const closureSummary = useMemo(
    () => (site ? resolveSiteClosureSummary(site, ledger) : null),
    [site, ledger],
  );

  if (!site) return <div className="text-muted-foreground">Site not found.</div>;

  if (!canAccessSite(user.role, site.id, user.assignedSiteIds, site.companyId, user.companyId)) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
        This site is outside your organisation. Contact your Firm Admin if you should have access.
      </div>
    );
  }

  const isFinished = site.status === "completed";
  const assigned = machines.filter((m) => m.assignedSiteId === site.id);
  const categoryGroups = Object.entries(
    assigned.reduce<Record<string, typeof assigned>>((acc, machine) => {
      if (!acc[machine.category]) acc[machine.category] = [];
      acc[machine.category].push(machine);
      return acc;
    }, {}),
  ).sort((a, b) => b[1].length - a[1].length);
  const deployment = machines.length ? Math.round((assigned.length / Math.max(machines.length, 1)) * 100) : 0;

  const openEditDialog = (machineId: string) => {
    const machine = machines.find((item) => item.id === machineId);
    if (!machine) return;
    setEditingMachineId(machineId);
    setNextStatus(machine.status);
    setTargetSiteId(machine.assignedSiteId ?? site.id);
  };

  const closeEditDialog = () => {
    setEditingMachineId(null);
  };

  const saveMachineEdit = () => {
    if (!editingMachine) return;
    if (nextStatus === "assigned" && !targetSiteId && !site.id) return;

    const updates: {
      status: MachineryStatus;
      assignedSiteId: string | null;
      lostFromSiteId?: string | null;
    } = {
      status: nextStatus,
      assignedSiteId: nextStatus === "assigned" ? targetSiteId || site.id : null,
    };
    if (nextStatus === "lost_damaged") {
      updates.lostFromSiteId = editingMachine.assignedSiteId ?? site.id;
    }

    updateMutation.mutate({ machineId: editingMachine.id, updates }, { onSuccess: closeEditDialog });
  };

  const removeMachineFromSite = () => {
    if (!editingMachine) return;
    updateMutation.mutate(
      { machineId: editingMachine.id, updates: { status: "available", assignedSiteId: null } },
      { onSuccess: closeEditDialog },
    );
  };

  const openManageMovement = (entry?: LedgerEntry) => {
    setManageMovementEditEntry(entry ?? null);
    setManageMovementOpen(true);
  };

  const handleManageMovementOpenChange = (isOpen: boolean) => {
    setManageMovementOpen(isOpen);
    if (!isOpen) setManageMovementEditEntry(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/sites" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> All sites
        </Link>
        <SiteReportExportMenu site={site} ledger={ledger} machines={machines} />
      </div>

      <div className="rounded-xl border border-border bg-gradient-hero p-6 text-primary-foreground shadow-elevated">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-wider text-accent">{site.code}</div>
            <h1 className="mt-1 font-display text-3xl font-bold">{site.name}</h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-primary-foreground/80">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{site.location}</span>
              <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{site.manager}</span>
              <span className="inline-flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />{format(new Date(site.startDate), "MMM yyyy")} – {format(new Date(site.endDate), "MMM yyyy")}</span>
            </div>
          </div>
          <StatusBadge status={site.status} />
        </div>
        {!isFinished && (
          <div className="mt-5">
            <div className="flex justify-between text-xs text-primary-foreground/70">
              <span>Percentage Deployment ({assigned.length} of {machines.length} units)</span>
              <span className="tabular-nums">{deployment}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-primary-foreground/10">
              <div className="h-full bg-gradient-accent" style={{ width: `${deployment}%` }} />
            </div>
          </div>
        )}
      </div>

      {isFinished && closureSummary && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-4 font-display text-lg font-semibold">Site closure report</h2>
          <SiteClosureReport summary={closureSummary} siteName={site.name} />
        </div>
      )}

      {isFinished && !closureSummary && (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No closure breakdown was saved for this site. Check allocation history below for movement records.
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            {isFinished ? "Closure history" : "Assigned Machinery"}
            {!isFinished && (
              <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {assigned.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {allowMachineryEdit && !isFinished && (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 border-border font-semibold shadow-card"
                onClick={() => openManageMovement()}
              >
                <Truck className="h-4 w-4" />
                Manage Machinery
              </Button>
            )}
            {showRequestMachinery && !isFinished && (
              <Link to={`/requests/new?site=${site.id}`} className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground shadow-card hover:opacity-90">
                Request machinery
              </Link>
            )}
          </div>
        </div>
        {isFinished ? (
          <SiteAllocationHistory
            siteId={site.id}
            ledger={ledger}
            machines={machines}
            allowEdit={allowMachineryEdit}
            onEditEntry={openManageMovement}
          />
        ) : assigned.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <Wrench className="mx-auto mb-2 h-6 w-6 opacity-40" />
            No machinery assigned yet.
          </div>
        ) : (
          <Accordion type="single" collapsible className="space-y-3">
            {categoryGroups.map(([category, machinesInCategory]) => (
              <AccordionItem
                key={category}
                value={category}
                className="overflow-hidden rounded-xl border border-border bg-card px-0 shadow-card"
              >
                <AccordionTrigger className="px-4 py-4 hover:no-underline">
                  <div className="flex w-full items-center justify-between gap-4 pr-3 text-left">
                    <div>
                      <div className="font-display text-4xl font-bold leading-none tabular-nums">{machinesInCategory.length}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Machinery</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-lg font-semibold">{category}</div>
                      <div className="text-xs text-muted-foreground">Click to expand assigned units</div>
                    </div>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {Math.round((machinesInCategory.length / assigned.length) * 100)}%
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="border-t border-border px-4 pt-3">
                  <div className="overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Code</th>
                          <th className="px-3 py-2 font-medium">Name</th>
                          <th className="px-3 py-2 text-right font-medium">Status</th>
                          <th className="px-3 py-2 text-right font-medium">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {machinesInCategory.map((m) => (
                          <tr key={m.id} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{m.code}</td>
                            <td className="px-3 py-2 font-medium">{m.name}</td>
                            <td className="px-3 py-2 text-right">
                              <StatusBadge status={m.status} />
                            </td>
                            <td className="px-3 py-2 text-right">
                              {allowMachineryEdit ? (
                                <Button type="button" variant="outline" size="sm" onClick={() => openEditDialog(m.id)}>
                                  Edit
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>

      <Dialog open={Boolean(editingMachine)} onOpenChange={(isOpen) => !isOpen && closeEditDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit equipment</DialogTitle>
            <DialogDescription>
              Update status, move this unit to another site, or remove it from this site.
            </DialogDescription>
          </DialogHeader>
          {editingMachine && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-secondary/20 p-3 text-sm">
                <div className="font-semibold">{editingMachine.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{editingMachine.code}</div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</div>
                <Select value={nextStatus} onValueChange={(value) => setNextStatus(value as MachineryStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MACHINERY_EDIT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {MACHINERY_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {nextStatus === "assigned" && (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Assigned Site</div>
                  <Select value={targetSiteId} onValueChange={setTargetSiteId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select site" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((targetSite) => (
                        <SelectItem key={targetSite.id} value={targetSite.id}>
                          {targetSite.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="justify-between sm:justify-between">
            <Button type="button" variant="destructive" onClick={removeMachineFromSite}>
              Remove from site
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeEditDialog}>
                Cancel
              </Button>
              <Button type="button" onClick={saveMachineEdit}>
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isFinished && (
        <SiteAllocationHistory
          siteId={site.id}
          ledger={ledger}
          machines={machines}
          allowEdit={allowMachineryEdit}
          onEditEntry={openManageMovement}
        />
      )}

      {allowMachineryEdit && !isFinished && (
        <ManageMachineryDialog
          site={site}
          machines={machines}
          open={manageMovementOpen}
          onOpenChange={handleManageMovementOpenChange}
          editEntry={manageMovementEditEntry}
          showTrigger={false}
        />
      )}
    </div>
  );
};

export default SiteDetail;
