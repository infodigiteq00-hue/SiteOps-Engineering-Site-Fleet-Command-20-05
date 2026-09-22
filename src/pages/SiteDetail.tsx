import { useMemo, useState, type SyntheticEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { ArrowLeft, MapPin, User, Calendar, Wrench, Truck, Search, Share2 } from "lucide-react";
import type { LedgerEntry, Machine, MachineryStatus } from "@/domain/types";
import { MACHINERY_EDIT_STATUSES, MACHINERY_STATUS_LABELS } from "@/lib/machinery-status-options";
import { format } from "date-fns";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentUser } from "@/lib/session";
import { canAccessSite, canEditMachineryOnSite, canCreateMachineryRequest } from "@/lib/rbac";
import { useScopedSites, useScopedMachines, useScopedLedger } from "@/hooks/useCompanyScope";
import { useUpdateMachineMutation } from "@/hooks/useOperationalData";
import { ManageMachineryDialog } from "@/components/ManageMachineryDialog";
import { SiteAllocationHistory } from "@/components/SiteAllocationHistory";
import { SiteClosureReport } from "@/components/SiteClosureReport";
import { SiteClosureMachineryArchive } from "@/components/SiteClosureMachineryArchive";
import { buildSiteClosureArchive } from "@/lib/site-closure-archive";
import { SiteReportExportMenu } from "@/components/SiteReportExportMenu";
import { resolveSiteClosureSummary } from "@/lib/site-closure-summary";
import { countEffectiveMachineryUnits, summarizeMachineryDisplayQty } from "@/lib/site-closure";
import { buildAssignedMachineryTableRows, type AssignedMachineryTableRow } from "@/lib/site-report";
import { downloadCategorySharePdf } from "@/lib/category-share-pdf";
import { latestArrivalByMachineId, type LatestArrivalInfo } from "@/lib/site-allocation-history";
import { toast } from "@/hooks/use-toast";

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
  const [machineryQuery, setMachineryQuery] = useState("");
  const [shareCategory, setShareCategory] = useState<string | null>(null);
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
  const closureArchive = useMemo(
    () => (site && site.status === "completed" ? buildSiteClosureArchive(site.id, ledger, machines) : []),
    [site, ledger, machines],
  );
  const arrivalByMachineId = useMemo(
    () => (site ? latestArrivalByMachineId(site.id, ledger) : new Map<string, LatestArrivalInfo>()),
    [site, ledger],
  );
  const gatePassByMachineId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [machineId, info] of arrivalByMachineId) {
      if (info.gatePass) map.set(machineId, info.gatePass);
    }
    return map;
  }, [arrivalByMachineId]);
  const dateByMachineId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [machineId, info] of arrivalByMachineId) {
      if (info.dateIso) map.set(machineId, info.dateIso);
    }
    return map;
  }, [arrivalByMachineId]);

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
  const assignedUnitCount = countEffectiveMachineryUnits(assigned);
  const categoryGroups = Object.entries(
    assigned.reduce<Record<string, typeof assigned>>((acc, machine) => {
      if (!acc[machine.category]) acc[machine.category] = [];
      acc[machine.category].push(machine);
      return acc;
    }, {}),
  ).sort((a, b) => b[1].length - a[1].length);
  const machineryNeedle = machineryQuery.trim().toLowerCase();
  const filteredCategoryGroups = machineryNeedle
    ? categoryGroups
        .map(([category, machinesInCategory]) => {
          if (category.toLowerCase().includes(machineryNeedle)) return [category, machinesInCategory] as const;
          const filtered = machinesInCategory.filter(
            (m) => m.code.toLowerCase().includes(machineryNeedle) || m.name.toLowerCase().includes(machineryNeedle),
          );
          return filtered.length > 0 ? ([category, filtered] as const) : null;
        })
        .filter((group): group is [string, typeof assigned] => group !== null)
    : categoryGroups;
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

  const openShareCategory = (category: string, event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const group = categoryGroups.find(([name]) => name === category);
    const machinesInCategory = group?.[1] ?? [];
    const { qty: unitCount, unitLabel } = summarizeMachineryDisplayQty(machinesInCategory);
    const categoryPercent = assignedUnitCount > 0 ? Math.round((unitCount / assignedUnitCount) * 100) : 0;

    try {
      downloadCategorySharePdf({
        site,
        category,
        machines: machinesInCategory,
        gatePassByMachineId,
        dateByMachineId,
        unitCount,
        categoryPercent,
        assignedCount: assigned.length,
        fleetCount: machines.length,
        deploymentPercent: deployment,
        unitLabel,
      });
      toast({
        title: "PDF downloaded",
        description: `${category} breakdown saved to your downloads folder.`,
      });
    } catch (err) {
      toast({
        title: "PDF download failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }

    setShareCategory(category);
  };

  const shareGroup = shareCategory
    ? categoryGroups.find(([category]) => category === shareCategory) ?? null
    : null;
  const shareMachines = shareGroup?.[1] ?? [];
  const { qty: shareUnitCount, unitLabel: shareUnitLabel } = summarizeMachineryDisplayQty(shareMachines);
  const sharePercent =
    shareCategory && assignedUnitCount > 0
      ? Math.round((shareUnitCount / assignedUnitCount) * 100)
      : 0;

  const handleRowAction = (row: AssignedMachineryTableRow) => {
    if (row.ledgerEntryId) {
      const entry = ledger.find((item) => item.id === row.ledgerEntryId);
      if (entry) {
        openManageMovement(entry);
        return;
      }
    }
    if (row.machineId) openEditDialog(row.machineId);
  };

  const renderCell = (value: string) =>
    value.trim() ? value : <span className="text-muted-foreground">—</span>;

  const renderAssignedMachineryTable = (category: string, machinesInCategory: Machine[]) => {
    const rows = buildAssignedMachineryTableRows(category, site, ledger, machines, machinesInCategory);

    if (rows.length === 0) {
      return (
        <p className="py-6 text-center text-sm text-muted-foreground">No movement records for this category yet.</p>
      );
    }

    return (
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">In qty</th>
              <th className="px-3 py-2 font-medium">Out qty</th>
              <th className="px-3 py-2 font-medium">In gate pass no.</th>
              <th className="px-3 py-2 font-medium">Out gate pass no.</th>
              <th className="px-3 py-2 text-right font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${category}-${row.name}-${row.date}-${index}`} className="border-b border-border last:border-0">
                <td className="px-3 py-2 text-muted-foreground">{renderCell(row.date)}</td>
                <td className="px-3 py-2 font-medium">{row.name}</td>
                <td className="px-3 py-2">{renderCell(row.inQty)}</td>
                <td className="px-3 py-2">{renderCell(row.outQty)}</td>
                <td className="px-3 py-2">
                  {row.inGatePass.trim() ? (
                    <span className="font-mono text-xs font-medium text-foreground">{row.inGatePass}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.outGatePass.trim() ? (
                    <span className="font-mono text-xs font-medium text-foreground">{row.outGatePass}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  {allowMachineryEdit && (row.machineId || row.ledgerEntryId) ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => handleRowAction(row)}>
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
    );
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
        {!isFinished ? (
          <div className="mt-5">
            <div className="flex justify-between text-xs text-primary-foreground/70">
              <span>Percentage Deployment ({assigned.length} of {machines.length} units)</span>
              <span className="tabular-nums">{deployment}%</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-primary-foreground/10">
              <div className="h-full bg-gradient-accent" style={{ width: `${deployment}%` }} />
            </div>
          </div>
        ) : closureSummary ? (
          <div className="mt-5 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-4 py-3 text-sm">
            <span className="font-medium">Site finished</span>
            <span className="text-primary-foreground/80">
              {" "}
              · {closureSummary.totalUnits} unit{closureSummary.totalUnits === 1 ? "" : "s"} processed at closure
            </span>
          </div>
        ) : null}
      </div>

      {isFinished && closureSummary && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="mb-4 font-display text-lg font-semibold">Site closure report</h2>
          <SiteClosureReport summary={closureSummary} siteName={site.name} />
        </div>
      )}

      {isFinished && !closureSummary && (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Closure totals were not saved on the site record. Machinery outcomes and movements below are still available
          for audit.
        </div>
      )}

      {isFinished && closureArchive.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">
              Machinery at closure
              <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {closureArchive.length}
              </span>
            </h2>
            <p className="text-xs text-muted-foreground">Read-only snapshot for future audit</p>
          </div>
          <SiteClosureMachineryArchive siteId={site.id} ledger={ledger} machines={machines} />
        </div>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="shrink-0 font-display text-lg font-semibold">
            {isFinished ? "Site history" : "Assigned Machinery"}
            {!isFinished && (
              <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {assignedUnitCount}
              </span>
            )}
          </h2>
          {!isFinished && (
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={machineryQuery}
                onChange={(e) => setMachineryQuery(e.target.value)}
                placeholder="Search category, code, name…"
                aria-label="Search assigned machinery"
                className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              />
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
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
        {isFinished ? null : assigned.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <Wrench className="mx-auto mb-2 h-6 w-6 opacity-40" />
            No machinery assigned yet.
          </div>
        ) : filteredCategoryGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No machinery matches your search.
          </div>
        ) : (
          <Accordion type="single" collapsible className="space-y-3">
            {filteredCategoryGroups.map(([category, machinesInCategory]) => {
              const { qty: groupUnitCount, unitLabel: groupUnitLabel } =
                summarizeMachineryDisplayQty(machinesInCategory);
              const categoryPercent =
                assignedUnitCount > 0 ? Math.round((groupUnitCount / assignedUnitCount) * 100) : 0;

              return (
              <AccordionItem
                key={category}
                value={category}
                className="overflow-hidden rounded-xl border border-border bg-card px-0 shadow-card"
              >
                <AccordionTrigger className="px-4 py-4 hover:no-underline">
                  <div className="flex w-full items-center justify-between gap-4 pr-3 text-left">
                    <div>
                      <div className="font-display text-4xl font-bold leading-none tabular-nums">{groupUnitCount}</div>
                      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {groupUnitLabel}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-lg font-semibold">{category}</div>
                      <div className="text-xs text-muted-foreground">Click to expand movement details</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                        {categoryPercent}%
                      </span>
                      <button
                        type="button"
                        aria-label={`Share ${category} breakdown`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground"
                        onClick={(event) => openShareCategory(category, event)}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="border-t border-border px-4 pt-3">
                  {renderAssignedMachineryTable(category, machinesInCategory)}
                </AccordionContent>
              </AccordionItem>
            );
            })}
          </Accordion>
        )}
      </div>

      <Drawer
        open={Boolean(shareCategory)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setShareCategory(null);
        }}
      >
        <DrawerContent className="max-h-[92vh] gap-0 bg-background p-0">
          <div className="overflow-y-auto px-4 pb-6 pt-2">
            <DrawerHeader className="sr-only">
              <DrawerTitle>{shareCategory ?? "Category breakdown"}</DrawerTitle>
              <DrawerDescription>Site title and assigned machinery breakdown for this category.</DrawerDescription>
            </DrawerHeader>

            <div className="rounded-xl border border-border bg-gradient-hero p-6 text-primary-foreground shadow-elevated">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="font-mono text-xs uppercase tracking-wider text-accent">{site.code}</div>
                  <h2 className="mt-1 font-display text-3xl font-bold">{site.name}</h2>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-primary-foreground/80">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {site.location}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" />
                      {site.manager}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(site.startDate), "MMM yyyy")} – {format(new Date(site.endDate), "MMM yyyy")}
                    </span>
                  </div>
                </div>
                <StatusBadge status={site.status} />
              </div>
              {!isFinished ? (
                <div className="mt-5">
                  <div className="flex justify-between text-xs text-primary-foreground/70">
                    <span>
                      Percentage Deployment ({assigned.length} of {machines.length} units)
                    </span>
                    <span className="tabular-nums">{deployment}%</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-primary-foreground/10">
                    <div className="h-full bg-gradient-accent" style={{ width: `${deployment}%` }} />
                  </div>
                </div>
              ) : null}
            </div>

            {shareCategory && (
              <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-card">
                <div className="flex items-center justify-between gap-4 px-4 py-4">
                  <div>
                    <div className="font-display text-4xl font-bold leading-none tabular-nums">{shareUnitCount}</div>
                    <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {shareUnitLabel}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg font-semibold">{shareCategory}</div>
                    <div className="text-xs text-muted-foreground">Assigned units in this category</div>
                  </div>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                    {sharePercent}%
                  </span>
                </div>
                <div className="border-t border-border px-4 py-3">
                  {shareCategory ? (
                    renderAssignedMachineryTable(shareCategory, shareMachines)
                  ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">No machinery in this category.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

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

      <SiteAllocationHistory
        siteId={site.id}
        ledger={ledger}
        machines={machines}
        allowEdit={allowMachineryEdit && !isFinished}
        onEditEntry={openManageMovement}
        includeClosureEvents={isFinished}
      />

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
