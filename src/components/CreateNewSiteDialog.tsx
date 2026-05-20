import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ROLE_LABELS, useCurrentUser } from "@/lib/session";
import { useScopedMachines, useScopedSites } from "@/hooks/useCompanyScope";
import {
  appendAuditLedgerEntry,
  useCompaniesQuery,
  useCreateSiteMutation,
} from "@/hooks/useOperationalData";
import {
  SITE_BULK_SAMPLE_CSV,
  parseSiteBulkCsv,
  validateSiteBulkImport,
  type SiteBulkImportRow,
} from "@/lib/site-bulk-upload";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Mode = "single" | "bulk";

const inputCls = "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30";
const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground";

export function CreateNewSiteDialog() {
  const user = useCurrentUser();
  const scopedMachines = useScopedMachines();
  const scopedSites = useScopedSites();
  const { data: companies = [] } = useCompaniesQuery();
  const createSiteMutation = useCreateSiteMutation();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("single");
  const [organisationId, setOrganisationId] = useState("");
  const [form, setForm] = useState({ name: "", location: "", machineIds: [] as string[] });
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkPreview, setBulkPreview] = useState<SiteBulkImportRow[] | null>(null);
  const [isBulkDragActive, setIsBulkDragActive] = useState(false);
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user.role === "super_admin" && companies.length && (!organisationId || !companies.some((c) => c.id === organisationId))) {
      setOrganisationId(companies[0].id);
    }
  }, [user.role, companies, organisationId]);

  const availableMachines = useMemo(
    () => scopedMachines.filter((machine) => machine.status === "available"),
    [scopedMachines],
  );

  const resolvedCompanyId = user.role === "super_admin" ? organisationId || companies[0]?.id || "" : user.companyId ?? "";

  const resetForm = () => {
    setMode("single");
    setForm({ name: "", location: "", machineIds: [] });
    setBulkCsv("");
    setBulkFileName("");
    setBulkPreview(null);
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

  const onSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.location.trim()) {
      toast({ title: "Missing fields", description: "Please add site name and location.", variant: "destructive" });
      return;
    }
    if (form.machineIds.length === 0) {
      toast({ title: "No machinery selected", description: "Please allot at least one available machine.", variant: "destructive" });
      return;
    }
    if (!resolvedCompanyId) {
      toast({ title: "No company", description: "Pick a company (Super Admin) or ensure your profile has a company.", variant: "destructive" });
      return;
    }
    try {
      await createSiteMutation.mutateAsync({
        ...form,
        companyId: resolvedCompanyId,
      });
      toast({ title: "Site created", description: "New site is live with allotted machinery." });
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
    const parsed = parseSiteBulkCsv(csvInput);
    if (!parsed.ok) {
      toast({ title: "Invalid CSV", description: parsed.error, variant: "destructive" });
      return;
    }
    const validated = validateSiteBulkImport(parsed.rows, scopedSites, scopedMachines, resolvedCompanyId);
    if (!validated.ok) {
      toast({ title: "Cannot import", description: validated.error, variant: "destructive" });
      return;
    }
    setBulkPreview(validated.rows);
    const skippedTotal = validated.rows.reduce((n, r) => n + r.skippedMachineryCodes.length, 0);
    if (skippedTotal > 0) {
      toast({
        title: "Preview ready",
        description: `${skippedTotal} code(s) in the CSV are not in your available pool (or were already used earlier in this file). Sites will still be created; see the review table for details.`,
      });
    }
  };

  const loadBulkFile = async (file: File) => {
    const text = await file.text();
    setBulkCsv(text);
    setBulkFileName(file.name);
    setBulkPreview(null);
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
    const blob = new Blob([SITE_BULK_SAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sites-bulk-upload-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const onBulkConfirm = async () => {
    if (!bulkPreview?.length || !resolvedCompanyId) return;
    let created = 0;
    try {
      for (const row of bulkPreview) {
        await createSiteMutation.mutateAsync({
          name: row.siteName,
          location: row.location,
          machineIds: row.machineIds,
          companyId: resolvedCompanyId,
          createdDuringBulkUpload: true,
        });
        created += 1;
      }
      try {
        await appendAuditLedgerEntry({
          companyId: resolvedCompanyId,
          eventKind: "bulk_upload_completed",
          summary: `Bulk sites CSV import finished: ${created} new site(s) added. Existing sites were not changed.`,
          siteId: null,
          machineIds: [],
          requester: user.name,
          approvedBy: user.name,
          approverRole: ROLE_LABELS[user.role],
          totalUnits: created,
        });
      } catch (err) {
        console.warn("[ledger] bulk sites summary skipped", err);
      }
      toast({
        title: "Sites imported",
        description:
          bulkPreview.reduce((n, r) => n + r.skippedMachineryCodes.length, 0) > 0
            ? `${created} new site(s) added. Some machinery codes were skipped (demo/sample codes must exist in your fleet as Available). Existing sites were unchanged.`
            : `${created} new site(s) added. Existing sites were kept.`,
      });
      setOpen(false);
      resetForm();
    } catch (err) {
      toast({
        title: "Import stopped",
        description:
          err instanceof Error
            ? `${err.message} (${created} site(s) were created before the error.)`
            : `Try again. (${created} site(s) were created before the error.)`,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
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
            Add site details and allot machinery from available units owned by your organisation. Bulk upload adds new sites
            alongside existing ones.
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
                <p className="text-sm font-medium">Review import ({bulkPreview.length} new site(s))</p>
                <p className="text-xs text-muted-foreground">
                  Existing sites are not removed or changed. Confirm to append these sites to your fleet.
                </p>
                <div className="max-h-56 overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-border bg-secondary/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Site name</th>
                        <th className="px-2 py-1.5 font-medium">Location</th>
                        <th className="px-2 py-1.5 font-medium">Machinery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.map((row) => (
                        <tr key={`${row.siteName}-${row.location}`} className="border-b border-border/80 last:border-0">
                          <td className="px-2 py-1.5 align-top">{row.siteName}</td>
                          <td className="px-2 py-1.5 align-top">{row.location}</td>
                          <td className="px-2 py-1.5 align-top text-[11px]">
                            <div className="font-mono text-muted-foreground">
                              {row.machineryCodes.length ? row.machineryCodes.join(", ") : "—"}
                            </div>
                            <div className="mt-1 text-foreground">
                              {row.machineIds.length > 0
                                ? `${row.machineIds.length} unit(s) will be allotted`
                                : "No machinery allotted"}
                            </div>
                            {row.skippedMachineryCodes.length > 0 && (
                              <div className="mt-1 text-amber-700 dark:text-amber-200/95">
                                Skipped (not in Available pool / duplicate in row): {row.skippedMachineryCodes.join(", ")}
                              </div>
                            )}
                          </td>
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
                      setBulkCsv(SITE_BULK_SAMPLE_CSV);
                      setBulkFileName("sample-sites-bulk.csv");
                      onBulkPreview(SITE_BULK_SAMPLE_CSV);
                    }}
                    className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-sky-400"
                  >
                    Load sample data
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  CSV columns: <span className="font-mono">site_name, location, machinery_codes</span> (codes optional; use{" "}
                  <span className="font-mono">;</span> between codes). Codes must match real units in your org with status{" "}
                  <strong>Available</strong>. Unknown or busy codes are skipped — sites are still created.
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
                  <Button type="button" variant="outline" onClick={() => setBulkPreview(null)}>
                    Back to file
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void onBulkConfirm()} disabled={createSiteMutation.isPending}>
                    {createSiteMutation.isPending ? "Importing…" : "Confirm & import"}
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
  );
}
