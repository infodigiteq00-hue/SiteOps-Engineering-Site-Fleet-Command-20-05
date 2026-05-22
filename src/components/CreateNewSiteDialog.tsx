import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ROLE_LABELS, useCurrentUser } from "@/lib/session";
import { useScopedMachines } from "@/hooks/useCompanyScope";
import {
  appendAuditLedgerEntry,
  useAddMachineryMutation,
  useCompaniesQuery,
  useCreateSiteMutation,
  useMachineryQuery,
  useSitesQuery,
} from "@/hooks/useOperationalData";
import {
  assertBulkImportCodesAreNew,
  buildBulkSiteResolutionsAndQueue,
  bulkGroupParsedRows,
  bulkGroupsToTemplatePreviewRows,
  bulkValidationUniqueCodes,
  existingSiteForBulkWizardConflict,
  MACHINERY_BULK_SAMPLE_CSV,
  parseBulkStructural,
  siteAssignmentKey,
  siteDeploymentExists,
  type BulkParsedRow,
  type BulkPreviewGroup,
  type BulkSiteConfirmItem,
  type BulkSiteResolution,
} from "@/lib/machinery-bulk-upload";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mode = "single" | "bulk";

type BulkWizardUi = {
  mode: "case1-choice" | "case1-edit" | "case2-choice" | "case2-enterNew";
  nameDraft: string;
};

type BulkWizardState = {
  queue: BulkSiteConfirmItem[];
  index: number;
  stagingRows: BulkParsedRow[];
  resolutions: Record<string, BulkSiteResolution>;
  pendingNormNames: Set<string>;
  ui: BulkWizardUi;
};

function wizardUiSeed(item: BulkSiteConfirmItem): BulkWizardUi {
  if (item.existingSite) {
    return { mode: "case2-choice", nameDraft: item.csvProjectName.trim() };
  }
  return { mode: "case1-choice", nameDraft: item.csvProjectName.trim() };
}

const inputCls = "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30";
const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground";

export function CreateNewSiteDialog() {
  const user = useCurrentUser();
  const scopedMachines = useScopedMachines();
  const { data: machines = [] } = useMachineryQuery();
  const { data: sites = [] } = useSitesQuery();
  const { data: companies = [] } = useCompaniesQuery();
  const createSiteMutation = useCreateSiteMutation();
  const addMachineryMutation = useAddMachineryMutation();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  const [organisationId, setOrganisationId] = useState("");
  const [form, setForm] = useState({ name: "", location: "", machineIds: [] as string[] });
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewGroup[] | null>(null);
  const [bulkResolutions, setBulkResolutions] = useState<Record<string, BulkSiteResolution>>({});
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState(0);
  const [bulkWizard, setBulkWizard] = useState<BulkWizardState | null>(null);
  const bulkWizardRef = useRef<BulkWizardState | null>(null);
  const [isBulkDragActive, setIsBulkDragActive] = useState(false);
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user.role === "super_admin" && companies.length && (!organisationId || !companies.some((c) => c.id === organisationId))) {
      setOrganisationId(companies[0].id);
    }
  }, [user.role, companies, organisationId]);

  useEffect(() => {
    bulkWizardRef.current = bulkWizard;
  }, [bulkWizard]);

  const availableMachines = useMemo(
    () => scopedMachines.filter((machine) => machine.status === "available"),
    [scopedMachines],
  );

  const resolvedCompanyId = user.role === "super_admin" ? organisationId || companies[0]?.id || "" : user.companyId ?? "";

  useEffect(() => {
    if (!bulkWizard || !resolvedCompanyId) return;
    const item = bulkWizard.queue[bulkWizard.index];
    if (!item || item.existingSite) return;
    const resolved = existingSiteForBulkWizardConflict(
      sites,
      item.csvProjectName,
      item.csvLocation,
      resolvedCompanyId,
    );
    if (!resolved) return;
    setBulkWizard((prev) => {
      if (!prev || prev.index !== bulkWizard.index) return prev;
      const current = prev.queue[prev.index];
      if (!current || current.key !== item.key || current.existingSite) return prev;
      const queue = prev.queue.map((entry, idx) =>
        idx === prev.index
          ? { ...entry, existingSite: resolved.site, locationMismatch: resolved.locationMismatch }
          : entry,
      );
      return {
        ...prev,
        queue,
        ui: wizardUiSeed({ ...current, existingSite: resolved.site }),
      };
    });
  }, [bulkWizard?.index, bulkWizard?.queue, resolvedCompanyId, sites]);

  const resetForm = () => {
    setMode("single");
    setForm({ name: "", location: "", machineIds: [] });
    setBulkCsv("");
    setBulkFileName("");
    setBulkPreview(null);
    setBulkResolutions({});
    setBulkWizard(null);
    setBulkImporting(false);
    setBulkImportProgress(0);
    setIsBulkDragActive(false);
  };

  const toggleMachine = (id: string) => {
    setForm((current) => ({
      ...current,
      machineIds: current.machineIds.includes(id)
        ? current.machineIds.filter((machineId) => machineId !== id)
        : [...current.machineIds, id],
    }));
  };

  const finishBulkWizardStep = useCallback(
    (wiz: BulkWizardState, resolution: BulkSiteResolution, pendingNormNames: Set<string>): BulkWizardState | null => {
      const stepKey = wiz.queue[wiz.index].key;
      const resolutions = { ...wiz.resolutions, [stepKey]: resolution };
      const nextIndex = wiz.index + 1;
      if (nextIndex >= wiz.queue.length) {
        try {
          const groups = bulkGroupParsedRows(wiz.stagingRows, resolutions, machines, resolvedCompanyId || null);
          setBulkResolutions(resolutions);
          setBulkPreview(groups);
          const total = groups.reduce((sum, g) => sum + g.units.length, 0);
          toast({
            title: "Preview ready",
            description: `Site setup finished. Review ${total} new machinery unit(s) to add — existing sites and fleet are unchanged.`,
          });
        } catch (err) {
          toast({
            title: "Could not prepare preview",
            description: err instanceof Error ? err.message : "Something went wrong mapping sites.",
            variant: "destructive",
          });
        }
        return null;
      }
      return {
        ...wiz,
        resolutions,
        pendingNormNames,
        index: nextIndex,
        ui: wizardUiSeed(wiz.queue[nextIndex]),
      };
    },
    [machines, resolvedCompanyId],
  );

  const onSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.location.trim()) {
      toast({ title: "Missing fields", description: "Please add site name and location.", variant: "destructive" });
      return;
    }
    if (!resolvedCompanyId) {
      toast({ title: "No company", description: "Pick a company (Super Admin) or ensure your profile has a company.", variant: "destructive" });
      return;
    }
    try {
      await createSiteMutation.mutateAsync({
        name: form.name.trim(),
        location: form.location.trim(),
        machineIds: form.machineIds,
        companyId: resolvedCompanyId,
      });
      toast({
        title: "Site created",
        description:
          form.machineIds.length > 0
            ? "New site is live with allotted machinery."
            : "New site is live. You can allot machinery later from the site page.",
      });
      setOpen(false);
      resetForm();
    } catch (err) {
      toast({
        title: "Could not create site",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const onBulkPreview = (csvInput = bulkCsv) => {
    if (!resolvedCompanyId) {
      toast({ title: "No company", description: "Pick a company before previewing bulk upload.", variant: "destructive" });
      return;
    }
    const structured = parseBulkStructural(csvInput, machines, resolvedCompanyId);
    if (!structured.ok) {
      toast({ title: "Invalid CSV", description: structured.error, variant: "destructive" });
      return;
    }
    if (structured.rows.length === 0) {
      toast({
        title: "No units to import",
        description: "All rows have qty 0 or no net new units. Adjust qty and try again.",
        variant: "destructive",
      });
      return;
    }
    const codeErr = bulkValidationUniqueCodes(structured.rows, machines);
    if (codeErr) {
      toast({ title: "Cannot import", description: codeErr, variant: "destructive" });
      return;
    }

    const companySites = sites.filter((s) => s.companyId === resolvedCompanyId);
    const { resolutions, queue } = buildBulkSiteResolutionsAndQueue(structured.rows, companySites, resolvedCompanyId, {
      autoResolveExactMatches: false,
      includeAllDeployments: true,
    });

    if (queue.length === 0) {
      try {
        const groups = bulkGroupParsedRows(structured.rows, resolutions, machines, resolvedCompanyId);
        setBulkResolutions(resolutions);
        setBulkPreview(groups);
        toast({
          title: "Preview ready",
          description: `Review ${groups.reduce((n, g) => n + g.units.length, 0)} new unit(s). Confirm to create sites and add machinery.`,
        });
      } catch (err) {
        toast({
          title: "Could not prepare preview",
          description: err instanceof Error ? err.message : "Check CSV layout.",
          variant: "destructive",
        });
      }
      return;
    }

    setBulkWizard({
      queue,
      index: 0,
      stagingRows: structured.rows,
      resolutions,
      pendingNormNames: new Set(),
      ui: wizardUiSeed(queue[0]),
    });
    toast({
      title: "Site confirmation",
      description: `${queue.length} deployment${queue.length !== 1 ? "s need" : " needs"} your choice before preview (step 1 of ${queue.length}).`,
    });
  };

  const onBulkConfirm = () => {
    if (!bulkPreview?.length || !resolvedCompanyId || bulkImporting) return;

    const groups = bulkPreview;
    const groupCount = groups.length;

    setBulkImporting(true);
    setBulkImportProgress(8);

    void (async () => {
      try {
        const flatRows = groups.flatMap((group) =>
          group.units.map((unit) => ({
            category: group.category,
            status: group.status,
            projectName: unit.projectName,
            projectLocation: unit.projectLocation,
            unitType: group.unitType,
            code: unit.code,
            name: unit.name,
          })),
        );
        assertBulkImportCodesAreNew(flatRows, machines);

        let added = 0;
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i];
          const { siteName: _s, existingUnitCount: _e, ...payload } = group;
          await addMachineryMutation.mutateAsync({
            category: payload.category,
            status: payload.status,
            assignedSiteId: payload.assignedSiteId,
            companyId: resolvedCompanyId,
            unitType: payload.unitType,
            units: payload.units,
            ledgerImportTag: "bulk_csv",
          });
          added += payload.units.length;
          setBulkImportProgress(Math.round(((i + 1) / groupCount) * 100));
        }

        try {
          await appendAuditLedgerEntry({
            companyId: resolvedCompanyId,
            eventKind: "bulk_upload_completed",
            summary: `Bulk sites CSV import finished: machinery added for ${Object.keys(bulkResolutions).length} deployment(s), ${added} new unit(s). Existing fleet unchanged.`,
            siteId: null,
            machineIds: [],
            requester: user.name,
            approvedBy: user.name,
            approverRole: ROLE_LABELS[user.role],
            totalUnits: added,
          });
        } catch (err) {
          console.warn("[ledger] bulk sites summary skipped", err);
        }

        toast({
          title: "Import complete",
          description: `${added} new machinery unit(s) added. Sites were created or matched during preview; existing machinery was not changed.`,
        });
        setOpen(false);
        resetForm();
      } catch (err) {
        toast({
          title: "Import stopped",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      } finally {
        setBulkImporting(false);
        setBulkImportProgress(0);
      }
    })();
  };

  const loadBulkFile = async (file: File) => {
    const text = await file.text();
    setBulkCsv(text);
    setBulkFileName(file.name);
    setBulkPreview(null);
    setBulkWizard(null);
  };

  const onBulkFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await loadBulkFile(file);
  };

  const onBulkDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsBulkDragActive(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) return;
    await loadBulkFile(droppedFile);
  };

  const downloadSampleTemplate = () => {
    const blob = new Blob([MACHINERY_BULK_SAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bulk-upload-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const abortBulkWizard = () => {
    setBulkWizard(null);
    toast({ title: "Upload canceled", description: "Site setup was canceled. Nothing was imported." });
  };

  const bulkWizardStepItem =
    bulkWizard && bulkWizard.index < bulkWizard.queue.length ? bulkWizard.queue[bulkWizard.index] : null;
  const bulkWizardSaving = createSiteMutation.isPending;

  const updateWizardNameDraft = (value: string) => {
    setBulkWizard((prev) => (prev ? { ...prev, ui: { ...prev.ui, nameDraft: value } } : null));
  };

  const onBulkUseExistingSiteFromWizard = () => {
    setBulkWizard((prev) => {
      if (!prev) return null;
      const item = prev.queue[prev.index];
      if (!item.existingSite) return prev;
      return finishBulkWizardStep(
        prev,
        { siteId: item.existingSite.id, displayName: item.existingSite.name },
        prev.pendingNormNames,
      );
    });
  };

  const onBulkWizardCase1EditMode = () => {
    setBulkWizard((prev) =>
      prev ? { ...prev, ui: { mode: "case1-edit", nameDraft: prev.queue[prev.index].csvProjectName.trim() } } : null,
    );
  };

  const onBulkWizardCase2EnterNewNameMode = () => {
    setBulkWizard((prev) =>
      prev ? { ...prev, ui: { mode: "case2-enterNew", nameDraft: prev.queue[prev.index].csvProjectName.trim() } } : null,
    );
  };

  const onBulkWizardBackToChoice = () => {
    setBulkWizard((prev) => (prev ? { ...prev, ui: wizardUiSeed(prev.queue[prev.index]) } : null));
  };

  const onBulkWizardCreateSite = async () => {
    const wiz = bulkWizardRef.current;
    if (!wiz) return;
    const item = wiz.queue[wiz.index];
    const trimmed =
      wiz.ui.mode === "case1-edit" || wiz.ui.mode === "case2-enterNew"
        ? wiz.ui.nameDraft.trim()
        : item.csvProjectName.trim();
    const location = item.csvLocation.trim();

    if (!resolvedCompanyId) {
      toast({ title: "No company", description: "Pick a company before creating a site.", variant: "destructive" });
      return;
    }
    if (siteDeploymentExists(sites, trimmed, location, resolvedCompanyId, wiz.pendingNormNames)) {
      const resolved = existingSiteForBulkWizardConflict(sites, trimmed, location, resolvedCompanyId);
      if (resolved) {
        setBulkWizard((prev) => {
          if (!prev || prev.index !== wiz.index) return prev;
          const queue = prev.queue.map((entry, idx) =>
            idx === prev.index
              ? { ...entry, existingSite: resolved.site, locationMismatch: resolved.locationMismatch }
              : entry,
          );
          return { ...prev, queue, ui: { mode: "case2-choice", nameDraft: trimmed } };
        });
      }
      toast({
        title: "Site already exists",
        description: `"${trimmed}" at "${location}" already exists. Use "Use existing site" or choose a different name.`,
        variant: "destructive",
      });
      return;
    }

    const markerKey = item.key;
    const markerIdx = wiz.index;

    try {
      const siteId = await createSiteMutation.mutateAsync({
        name: trimmed,
        location,
        machineIds: [],
        companyId: resolvedCompanyId,
        createdDuringBulkUpload: true,
      });
      const nextPending = new Set(wiz.pendingNormNames);
      nextPending.add(siteAssignmentKey(trimmed, location));

      setBulkWizard((prev) => {
        if (!prev || prev.index !== markerIdx || prev.queue[prev.index]?.key !== markerKey) return prev;
        return finishBulkWizardStep(prev, { siteId, displayName: trimmed }, nextPending);
      });
    } catch (err) {
      toast({
        title: "Could not create site",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const templatePreviewRows = bulkPreview ? bulkGroupsToTemplatePreviewRows(bulkPreview) : [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && bulkImporting) return;
          setOpen(nextOpen);
          if (!nextOpen) resetForm();
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-card transition-colors hover:bg-blue-500"
        >
          <Plus className="h-3.5 w-3.5" />
          Create new site
        </button>

        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create New Site</DialogTitle>
            <DialogDescription>
              Add site details and allot machinery from available units. Bulk upload uses the same 6-column CSV as Add machinery.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode("single")}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "single"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              Single site
            </button>
            <button
              type="button"
              onClick={() => setMode("bulk")}
              className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                mode === "bulk"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              Bulk upload
            </button>
          </div>

          {user.role === "super_admin" && (
            <div>
              <label className={labelCls}>Company (tenancy)</label>
              <Select value={organisationId} onValueChange={setOrganisationId} disabled={companies.length === 0}>
                <SelectTrigger className={inputCls}>
                  <SelectValue placeholder={companies.length ? "Choose company" : "Loading companies…"} />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "single" ? (
            <form onSubmit={onSingleSubmit} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Site name</label>
                  <input
                    className={inputCls}
                    value={form.name}
                    onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                    placeholder="e.g. Essar Steel - Hazira"
                    maxLength={90}
                  />
                </div>
                <div>
                  <label className={labelCls}>Location</label>
                  <input
                    className={inputCls}
                    value={form.location}
                    onChange={(e) => setForm((current) => ({ ...current, location: e.target.value }))}
                    placeholder="e.g. Hazira, Gujarat"
                    maxLength={90}
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className={`${labelCls} mb-0`}>Allot machinery (available only)</label>
                  <span className="text-xs text-muted-foreground">{form.machineIds.length} selected</span>
                </div>
                <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-border bg-background p-2 sm:grid-cols-2">
                  {availableMachines.map((machine) => {
                    const checked = form.machineIds.includes(machine.id);
                    return (
                      <label
                        key={machine.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors ${
                          checked ? "border-accent bg-accent/10" : "border-transparent hover:bg-secondary"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMachine(machine.id)}
                          className="h-4 w-4 accent-[hsl(var(--accent))]"
                        />
                        <div className="min-w-0">
                          <div className="font-medium">{machine.category}</div>
                          <div className="text-xs text-muted-foreground">
                            {machine.code} · {machine.name}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                  {availableMachines.length === 0 && (
                    <div className="col-span-2 p-4 text-center text-sm text-muted-foreground">No available machinery to allot.</div>
                  )}
                </div>
              </div>

              <DialogFooter className="border-t border-border pt-4 sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createSiteMutation.isPending} className="bg-accent text-accent-foreground hover:opacity-90">
                  {createSiteMutation.isPending ? "Creating…" : "Create site"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-3">
              {bulkPreview ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Review import (+{bulkPreview.reduce((n, g) => n + g.units.length, 0)} new unit
                    {bulkPreview.reduce((n, g) => n + g.units.length, 0) === 1 ? "" : "s"})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Same 6-column template as Add machinery. Confirm to add new units; existing machinery is not changed.
                  </p>
                  {bulkImporting ? (
                    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                      <p className="text-sm font-medium">Uploading machinery…</p>
                      <p className="text-xs text-muted-foreground">
                        Your import is confirmed. The system is adding {bulkPreview.reduce((n, g) => n + g.units.length, 0)} unit
                        {bulkPreview.reduce((n, g) => n + g.units.length, 0) === 1 ? "" : "s"} in the background — please keep this window open.
                      </p>
                      <Progress value={bulkImportProgress} className="h-2" />
                      <p className="text-right text-xs tabular-nums text-muted-foreground">{bulkImportProgress}%</p>
                    </div>
                  ) : null}
                  <div className="max-h-56 overflow-auto rounded-md border border-border">
                    <table className="min-w-[720px] text-xs">
                      <thead className="sticky top-0 border-b border-border bg-secondary/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 font-medium">projectName</th>
                          <th className="px-2 py-1.5 font-medium">location</th>
                          <th className="px-2 py-1.5 font-medium">category</th>
                          <th className="px-2 py-1.5 font-medium">qty</th>
                          <th className="px-2 py-1.5 font-medium">unit_type</th>
                          <th className="px-2 py-1.5 font-medium">status</th>
                          <th className="px-2 py-1.5 font-medium">Site</th>
                        </tr>
                      </thead>
                      <tbody>
                        {templatePreviewRows.map((row) => (
                          <tr
                            key={`${row.projectName}-${row.location}-${row.category}-${row.status}`}
                            className="border-b border-border/80 last:border-0"
                          >
                            <td className="px-2 py-1.5 align-top">{row.projectName}</td>
                            <td className="px-2 py-1.5 align-top">{row.location}</td>
                            <td className="px-2 py-1.5 align-top">{row.category}</td>
                            <td className="px-2 py-1.5 align-top tabular-nums">{row.qty}</td>
                            <td className="px-2 py-1.5 align-top">{row.unitType}</td>
                            <td className="px-2 py-1.5 align-top capitalize">{row.status}</td>
                            <td className="px-2 py-1.5 align-top text-muted-foreground">{row.siteName ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-full text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setBulkCsv(MACHINERY_BULK_SAMPLE_CSV);
                        setBulkFileName("sample-bulk-data.csv");
                        onBulkPreview(MACHINERY_BULK_SAMPLE_CSV);
                      }}
                      className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-sky-400"
                    >
                      Load sample data
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    CSV columns (6): <span className="font-mono">projectName, location, category, qty, unit_type, status</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">qty</span> is the number of <span className="font-semibold text-foreground">new</span> units to
                    add. Codes and names are auto-generated. If a site already exists, you can use it or create a new name.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={downloadSampleTemplate}>
                      Download template
                    </Button>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                      <Upload className="h-3.5 w-3.5" />
                      Upload CSV
                      <input ref={bulkFileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onBulkFileSelected} />
                    </label>
                  </div>
                  <div
                    className={`rounded-md border border-dashed p-4 transition-colors ${
                      isBulkDragActive ? "border-primary bg-primary/5" : "border-border bg-card/40"
                    }`}
                    onDrop={onBulkDrop}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!isBulkDragActive) setIsBulkDragActive(true);
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setIsBulkDragActive(false);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Upload className="h-3.5 w-3.5" />
                        <span>Or drag and drop a CSV here</span>
                      </div>
                      <button
                        type="button"
                        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                        onClick={() => bulkFileInputRef.current?.click()}
                      >
                        Browse files
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {bulkFileName
                      ? `Selected file: ${bulkFileName}`
                      : "No file selected. Upload a .csv or use sample data to preview."}
                  </div>
                </>
              )}

              <DialogFooter>
                {bulkPreview ? (
                  <>
                    <Button type="button" variant="outline" disabled={bulkImporting} onClick={() => setBulkPreview(null)}>
                      Back to file
                    </Button>
                    <Button type="button" variant="outline" disabled={bulkImporting} onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={onBulkConfirm} disabled={bulkImporting}>
                      {bulkImporting ? "Importing…" : "Confirm & import"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="button" onClick={() => onBulkPreview()} disabled={!bulkCsv.trim()}>
                      Preview import
                    </Button>
                  </>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(bulkWizard && bulkWizardStepItem)}
        onOpenChange={(next) => {
          if (!next) abortBulkWizard();
        }}
      >
        <AlertDialogContent className="z-[130] gap-4 sm:max-w-lg">
          {bulkWizard && bulkWizardStepItem ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Bulk upload · Site {bulkWizard.index + 1} of {bulkWizard.queue.length}
                </AlertDialogTitle>

                {!bulkWizardStepItem.existingSite && bulkWizard.ui.mode === "case1-choice" ? (
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-muted-foreground">
                      <p>
                        No site exists yet for &quot;{bulkWizardStepItem.csvProjectName}&quot; at &quot;{bulkWizardStepItem.csvLocation}&quot;.
                      </p>
                      <p>
                        Create a new site named{' '}
                        <span className="font-semibold text-foreground">{bulkWizardStepItem.csvProjectName.trim()}</span>?
                      </p>
                    </div>
                  </AlertDialogDescription>
                ) : null}

                {bulkWizardStepItem.existingSite && bulkWizard.ui.mode === "case2-choice" ? (
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-muted-foreground">
                      <p>A site with this name already exists.</p>
                      <p>
                        Matched: <span className="font-semibold text-foreground">{bulkWizardStepItem.existingSite.name}</span> (
                        {bulkWizardStepItem.existingSite.location}).
                      </p>
                      <p>
                        <span className="font-semibold text-foreground">Use existing site</span> to add new machinery from your CSV, or enter a
                        new name to create a separate site.
                      </p>
                    </div>
                  </AlertDialogDescription>
                ) : null}

                {(bulkWizard.ui.mode === "case1-edit" || bulkWizard.ui.mode === "case2-enterNew") && (
                  <>
                    <AlertDialogDescription>Edit the site name below, then create the site.</AlertDialogDescription>
                    <input
                      className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                      value={bulkWizard.ui.nameDraft}
                      onChange={(event) => updateWizardNameDraft(event.target.value)}
                      disabled={bulkWizardSaving}
                    />
                  </>
                )}
              </AlertDialogHeader>

              <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-2">
                {!bulkWizardStepItem.existingSite && bulkWizard.ui.mode === "case1-choice" ? (
                  <>
                    <Button type="button" variant="ghost" onClick={abortBulkWizard} disabled={bulkWizardSaving}>
                      Cancel upload
                    </Button>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button type="button" variant="outline" onClick={onBulkWizardCase1EditMode} disabled={bulkWizardSaving}>
                        Edit site name
                      </Button>
                      <Button type="button" onClick={() => void onBulkWizardCreateSite()} disabled={bulkWizardSaving}>
                        Create site
                      </Button>
                    </div>
                  </>
                ) : null}

                {(bulkWizard.ui.mode === "case1-edit" || bulkWizard.ui.mode === "case2-enterNew") ? (
                  <>
                    <Button type="button" variant="ghost" onClick={abortBulkWizard} disabled={bulkWizardSaving}>
                      Cancel
                    </Button>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button type="button" variant="outline" onClick={onBulkWizardBackToChoice} disabled={bulkWizardSaving}>
                        Back
                      </Button>
                      <Button type="button" onClick={() => void onBulkWizardCreateSite()} disabled={bulkWizardSaving}>
                        Create site
                      </Button>
                    </div>
                  </>
                ) : null}

                {bulkWizardStepItem.existingSite && bulkWizard.ui.mode === "case2-choice" ? (
                  <>
                    <Button type="button" variant="ghost" onClick={abortBulkWizard} disabled={bulkWizardSaving}>
                      Cancel
                    </Button>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button type="button" variant="outline" onClick={onBulkWizardCase2EnterNewNameMode} disabled={bulkWizardSaving}>
                        Enter new site name
                      </Button>
                      <Button type="button" onClick={onBulkUseExistingSiteFromWizard} disabled={bulkWizardSaving}>
                        Use existing site
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
