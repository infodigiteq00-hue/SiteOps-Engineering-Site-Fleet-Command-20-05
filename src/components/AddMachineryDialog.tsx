import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import type { Machine, MachineryCategory, MachineryStatus, Site } from "@/domain/types";
import { MACHINERY_CATEGORIES, categoryCodePrefix, toCodeChunk } from "@/domain/types";
import { ROLE_LABELS, useCurrentUser } from "@/lib/session";
import { useScopedSites } from "@/hooks/useCompanyScope";
import {
  appendAuditLedgerEntry,
  operationalKeys,
  useAddMachineryMutation,
  useCreateSiteMutation,
  useMachineryQuery,
  useSitesQuery,
  useCompaniesQuery,
} from "@/hooks/useOperationalData";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  CUSTOM_MACHINERY_UNIT_VALUE,
  DEFAULT_MACHINERY_UNIT_TYPE,
  MACHINERY_UNIT_TYPE_OPTIONS,
  normalizeMachineryUnitType,
  resolveMachineryUnitType,
  type MachineryUnitType,
  type PresetMachineryUnitType,
} from "@/lib/machinery-unit-types";
import {
  seedCategoryCodegen,
  takeMachineryUnitsFromCursor,
  type MachineryCodegenCursor,
} from "@/lib/machinery-unit-codegen";

type Props = {
  buttonText?: string;
};

function resolveMachineryCompanyId(
  user: { role: string; companyId: string | null },
  allSites: Site[],
  assignedSiteId: string | null,
  poolCompanyId: string | null,
): string | null {
  if (assignedSiteId) return allSites.find((s) => s.id === assignedSiteId)?.companyId ?? null;
  if (user.role === "super_admin") return poolCompanyId;
  return user.companyId;
}

type BulkPreviewGroup = {
  category: string;
  status: MachineryStatus;
  assignedSiteId: string | null;
  siteName: string;
  unitType: MachineryUnitType;
  units: Array<{
    code: string;
    name: string;
    projectName: string;
    projectLocation: string;
  }>;
};

type BulkParsedRow = {
  category: string;
  status: MachineryStatus;
  projectName: string;
  projectLocation: string;
  unitType: MachineryUnitType;
  code: string;
  name: string;
};

type ResolvedBulkSite = { siteId: string; displayName: string };

type BulkSiteConfirmItem = {
  key: string;
  csvProjectName: string;
  csvLocation: string;
  existingSite: Site | null;
};

type BulkWizardUi = {
  mode: "case1-choice" | "case1-edit" | "case2-choice" | "case2-enterNew";
  nameDraft: string;
};

type BulkWizardState = {
  queue: BulkSiteConfirmItem[];
  index: number;
  stagingRows: BulkParsedRow[];
  resolutions: Record<string, ResolvedBulkSite>;
  pendingNormNames: Set<string>;
  ui: BulkWizardUi;
};

function normBulkCompareKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function siteAssignmentKey(projectName: string, projectLocation: string) {
  return `${normBulkCompareKey(projectName)}|${normBulkCompareKey(projectLocation)}`;
}

function findBulkSiteMatch(sitesForForm: Site[], projectName: string, projectLocation: string): Site | null {
  const nameKey = normBulkCompareKey(projectName);
  const locKey = normBulkCompareKey(projectLocation);
  return (
    sitesForForm.find((site) => {
      const sn = normBulkCompareKey(site.name);
      const sl = normBulkCompareKey(site.location);
      return (
        sn === nameKey ||
        (sn.includes(nameKey) && sl.includes(locKey)) ||
        (`${sn} ${sl}`.includes(nameKey) && sl.includes(locKey))
      );
    }) ?? null
  );
}

function bulkValidationUniqueCodes(rows: BulkParsedRow[], machines: Machine[]): string | null {
  const uploadedCodes = rows.map((row) => row.code.toUpperCase());
  if (new Set(uploadedCodes).size !== uploadedCodes.length) {
    return "Each machinery code in the file must be unique (duplicate in upload).";
  }
  const existingCodes = new Set(machines.map((machine) => machine.code.toUpperCase()));
  const duplicateExisting = uploadedCodes.find((code) => existingCodes.has(code));
  if (duplicateExisting) return `Code ${duplicateExisting} already exists in the system.`;
  return null;
}

function parseBulkStructural(
  csvInput: string,
  machines: Machine[],
): { ok: true; rows: BulkParsedRow[] } | { ok: false; error: string } {
  const lines = csvInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith("projectname,"));
  if (lines.length === 0) {
    return { ok: false, error: "No data rows found. Upload a CSV or use sample data." };
  }
  try {
    const reservedCodes = new Set(machines.map((machine) => machine.code.toUpperCase()));
    const categoryCursors = new Map<string, MachineryCodegenCursor>();
    const parsedRows: BulkParsedRow[] = [];

    lines.forEach((line, index) => {
      const cells = parseCsvLine(line);
      if (cells.length !== 6) {
        throw new Error(`Row ${index + 1}: expected 6 columns (projectName, location, category, qty, unit_type, status).`);
      }

      const [projectNameRaw, projectLocationRaw, categoryRaw, qtyRaw, unitTypeRaw, statusRaw] = cells;
      const projectName = projectNameRaw.trim();
      const projectLocation = projectLocationRaw.trim();
      const category = categoryRaw.trim();
      const qty = Number.parseInt(qtyRaw.trim(), 10);
      const unitTypeLabel = unitTypeRaw.trim();
      if (!projectName) throw new Error(`Row ${index + 1}: project name is required.`);
      if (!projectLocation) throw new Error(`Row ${index + 1}: location is required.`);
      if (!category) throw new Error(`Row ${index + 1}: category is required.`);
      if (!Number.isFinite(qty) || qty < 0) {
        throw new Error(`Row ${index + 1}: qty must be a whole number of 0 or more.`);
      }
      if (!unitTypeLabel) throw new Error(`Row ${index + 1}: unit_type is required (e.g. nos, metre).`);

      const status = parseBulkStatus(statusRaw);
      if (!status) throw new Error(`Row ${index + 1}: invalid status "${statusRaw}".`);

      const unitType = normalizeMachineryUnitType(unitTypeLabel);
      const categoryKey = category.toLowerCase();
      let cursor = categoryCursors.get(categoryKey);
      if (!cursor) {
        cursor = seedCategoryCodegen(category, machines, reservedCodes);
        categoryCursors.set(categoryKey, cursor);
      }

      if (qty === 0) return;

      const generated = takeMachineryUnitsFromCursor(cursor, qty, reservedCodes);
      generated.forEach((unit) => {
        parsedRows.push({
          category,
          status,
          projectName,
          projectLocation,
          unitType,
          code: unit.code,
          name: unit.name,
        });
      });
    });

    return { ok: true, rows: parsedRows };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Check CSV and try again.",
    };
  }
}

function bulkSiteConfirmQueue(rows: BulkParsedRow[], sitesForForm: Site[]): BulkSiteConfirmItem[] {
  const seen = new Set<string>();
  const queue: BulkSiteConfirmItem[] = [];

  rows.forEach((row) => {
    if (row.status !== "assigned") return;
    const key = siteAssignmentKey(row.projectName, row.projectLocation);
    if (seen.has(key)) return;
    seen.add(key);
    queue.push({
      key,
      csvProjectName: row.projectName,
      csvLocation: row.projectLocation,
      existingSite: findBulkSiteMatch(sitesForForm, row.projectName, row.projectLocation),
    });
  });

  return queue;
}

function bulkGroupParsedRows(
  rows: BulkParsedRow[],
  resolutions: Record<string, ResolvedBulkSite>,
): BulkPreviewGroup[] {
  const grouped = new Map<string, BulkPreviewGroup>();

  rows.forEach((row) => {
    let assignedSiteId: string | null = null;
    let siteName = "—";
    if (row.status === "assigned") {
      const rk = siteAssignmentKey(row.projectName, row.projectLocation);
      const res = resolutions[rk];
      if (!res) {
        throw new Error(`Missing site resolution for "${row.projectName}" at "${row.projectLocation}".`);
      }
      assignedSiteId = res.siteId;
      siteName = res.displayName;
    }

    const groupKey = `${row.category}__${row.status}__${assignedSiteId ?? "none"}__${row.unitType}`;
    const existing = grouped.get(groupKey);
    const unit = {
      code: row.code,
      name: row.name,
      projectName: row.projectName,
      projectLocation: row.projectLocation,
    };
    if (existing) existing.units.push(unit);
    else {
      grouped.set(groupKey, {
        category: row.category,
        status: row.status,
        assignedSiteId,
        siteName,
        unitType: row.unitType,
        units: [unit],
      });
    }
  });

  return Array.from(grouped.values());
}

function wizardUiSeed(item: BulkSiteConfirmItem): BulkWizardUi {
  if (item.existingSite) {
    return { mode: "case2-choice", nameDraft: item.csvProjectName.trim() };
  }
  return { mode: "case1-choice", nameDraft: item.csvProjectName.trim() };
}

function siteNameTakenForCompany(
  name: string,
  companyId: string,
  allSites: Site[],
  normalizedPending: ReadonlySet<string>,
): boolean {
  const nk = normBulkCompareKey(name);
  if (!name.trim()) return true;
  if (normalizedPending.has(nk)) return true;
  return allSites.some((site) => site.companyId === companyId && normBulkCompareKey(site.name) === nk);
}

export const AddMachineryDialog = ({ buttonText = "Add machinery" }: Props) => {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const { data: machines = [] } = useMachineryQuery();
  const { data: sites = [], isPending: sitesPending } = useSitesQuery();
  const { data: companies = [] } = useCompaniesQuery();
  const addMachineryMutation = useAddMachineryMutation();
  const createSiteMutation = useCreateSiteMutation();
  const scopedSites = useScopedSites();
  const sitesForForm = user.role === "super_admin" ? sites : scopedSites;

  const [poolCompanyId, setPoolCompanyId] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [unitEntries, setUnitEntries] = useState<Array<{ code: string; name: string }>>([]);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkFileName, setBulkFileName] = useState("");
  /** Parsed bulk rows grouped for addMachinery; shown in preview until user confirms. */
  const [bulkPreview, setBulkPreview] = useState<BulkPreviewGroup[] | null>(null);
  /** Sequential site confirmations before preview opens (assigned rows only). */
  const [bulkWizard, setBulkWizard] = useState<BulkWizardState | null>(null);
  const bulkWizardRef = useRef<BulkWizardState | null>(null);
  const [isBulkDragActive, setIsBulkDragActive] = useState(false);
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState({
    category: "",
    customCategory: "",
    status: "available" as MachineryStatus,
    assignedSiteId: "",
    quantity: 1,
    unitType: DEFAULT_MACHINERY_UNIT_TYPE as PresetMachineryUnitType | typeof CUSTOM_MACHINERY_UNIT_VALUE,
    customUnitType: "",
  });

  /** Sites that can receive newly assigned machinery (Super Admin: match selected company). */
  const sitesForAssignment = useMemo(() => {
    if (user.role === "super_admin" && poolCompanyId) {
      return sites.filter((s) => s.companyId === poolCompanyId);
    }
    return sitesForForm;
  }, [user.role, poolCompanyId, sites, sitesForForm]);

  useEffect(() => {
    if (companies.length && !poolCompanyId) setPoolCompanyId(companies[0].id);
    if (user.role !== "super_admin" && user.companyId) setPoolCompanyId(user.companyId);
  }, [companies, poolCompanyId, user.companyId, user.role]);

  useEffect(() => {
    bulkWizardRef.current = bulkWizard;
  }, [bulkWizard]);

  useEffect(() => {
    if (form.status !== "assigned" || sitesForAssignment.length === 0) return;
    const stillValid = sitesForAssignment.some((s) => s.id === form.assignedSiteId);
    if (!stillValid) {
      setForm((prev) => ({ ...prev, assignedSiteId: sitesForAssignment[0].id }));
    }
  }, [form.status, form.assignedSiteId, sitesForAssignment]);

  const categoryOptions = useMemo(
    () => Array.from(new Set([...MACHINERY_CATEGORIES, ...machines.map((machine) => machine.category)])).sort(),
    [machines],
  );
  const finalCategory = form.category === "__new__" ? form.customCategory.trim() : form.category.trim();
  const safeQuantity = Math.max(1, form.quantity);

  const suggestedUnits = useMemo(() => {
    if (!finalCategory) return [];
    const categoryMachines = machines.filter((machine) => machine.category.toLowerCase() === finalCategory.toLowerCase());

    const codeMatches = categoryMachines
      .map((machine) => machine.code.match(/^([A-Za-z]+)([-_]?)(\d+)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match));
    const maxCodeNumber = codeMatches.reduce(
      (maxValue, match) => Math.max(maxValue, Number.parseInt(match[3], 10)),
      0,
    );
    const lastCodeMatch = codeMatches.find(
      (match) => Number.parseInt(match[3], 10) === maxCodeNumber,
    );
    const knownCategory = (MACHINERY_CATEGORIES as readonly string[]).find((c) => c.toLowerCase() === finalCategory.toLowerCase()) as
      | MachineryCategory
      | undefined;
    const standardPrefix = knownCategory ? categoryCodePrefix[knownCategory] : toCodeChunk(finalCategory);
    const codePrefix = lastCodeMatch?.[1] ?? standardPrefix;
    const codeSeparator = lastCodeMatch?.[2] ?? "-";
    const codeWidth = lastCodeMatch?.[3]?.length ?? 3;

    const nameMatches = categoryMachines
      .map((machine) => machine.name.match(/^(.*?)(\d+)\s*$/))
      .filter((match): match is RegExpMatchArray => Boolean(match));
    const maxNameNumber = nameMatches.reduce(
      (maxValue, match) => Math.max(maxValue, Number.parseInt(match[2], 10)),
      0,
    );
    const lastNameMatch = nameMatches.find(
      (match) => Number.parseInt(match[2], 10) === maxNameNumber,
    );
    const nameBase = lastNameMatch?.[1] ?? `${finalCategory} `;

    return Array.from({ length: safeQuantity }).map((_, index) => {
      const codeNumber = maxCodeNumber + index + 1;
      const nameNumber = maxNameNumber + index + 1;
      return {
        code: `${codePrefix}${codeSeparator}${String(codeNumber).padStart(codeWidth, "0")}`,
        name: `${nameBase}${nameNumber}`,
      };
    });
  }, [finalCategory, machines, safeQuantity]);

  useEffect(() => {
    setUnitEntries(suggestedUnits);
  }, [suggestedUnits]);

  const resetForm = () => {
    setForm({
      category: "",
      customCategory: "",
      status: "available",
      assignedSiteId: "",
      quantity: 1,
      unitType: DEFAULT_MACHINERY_UNIT_TYPE,
      customUnitType: "",
    });
    setUnitEntries([]);
    setBulkCsv("");
    setBulkFileName("");
    setBulkPreview(null);
    setBulkWizard(null);
    setMode("single");
  };

  const onCreate = () => {
    if (!finalCategory) {
      toast({ title: "Missing category", description: "Select or add a machinery category.", variant: "destructive" });
      return;
    }
    if (form.status === "assigned" && !form.assignedSiteId) {
      toast({ title: "Missing site", description: "Select assigned site for assigned machinery.", variant: "destructive" });
      return;
    }
    if (unitEntries.length !== safeQuantity) {
      toast({ title: "Units not ready", description: "Please wait for unit details to generate.", variant: "destructive" });
      return;
    }
    if (unitEntries.some((unit) => !unit.code.trim() || !unit.name.trim())) {
      toast({ title: "Missing details", description: "Each unit must have a machinery code and name.", variant: "destructive" });
      return;
    }
    const normalizedCodes = unitEntries.map((unit) => unit.code.trim().toUpperCase());
    if (new Set(normalizedCodes).size !== normalizedCodes.length) {
      toast({ title: "Duplicate codes", description: "Each machinery code must be unique.", variant: "destructive" });
      return;
    }
    const existingCodes = new Set(machines.map((machine) => machine.code.toUpperCase()));
    const conflictingCode = normalizedCodes.find((code) => existingCodes.has(code));
    if (conflictingCode) {
      toast({
        title: "Code already exists",
        description: `${conflictingCode} is already used. Please edit and retry.`,
        variant: "destructive",
      });
      return;
    }

    const companyId = resolveMachineryCompanyId(
      user,
      sites,
      form.status === "assigned" ? form.assignedSiteId || null : null,
      user.role === "super_admin" ? poolCompanyId : null,
    );
    if (!companyId) {
      toast({
        title: "Company required",
        description: user.role === "super_admin" ? "Select which company owns this equipment." : "Your profile needs a company assignment.",
        variant: "destructive",
      });
      return;
    }
    const resolvedUnitType = resolveMachineryUnitType(form.unitType, form.customUnitType);
    if (!resolvedUnitType) {
      toast({
        title: "Custom unit required",
        description: "Enter a unit type (e.g. tonne, sqm, bundle).",
        variant: "destructive",
      });
      return;
    }
    addMachineryMutation.mutate(
      {
        category: finalCategory,
        status: form.status,
        assignedSiteId: form.status === "assigned" ? form.assignedSiteId : null,
        companyId,
        unitType: resolvedUnitType,
        units: unitEntries,
      },
      {
        onSuccess: () => {
          toast({
            title: "Machinery added",
            description: `${safeQuantity} unit${safeQuantity > 1 ? "s" : ""} created.`,
          });
          setOpen(false);
          resetForm();
        },
        onError: (err) =>
          toast({
            title: "Could not add machinery",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const finishBulkWizardStep = useCallback(
    (wiz: BulkWizardState, resolution: ResolvedBulkSite, pendingNormNames: Set<string>): BulkWizardState | null => {
      const stepKey = wiz.queue[wiz.index].key;
      const resolutions = { ...wiz.resolutions, [stepKey]: resolution };
      const nextIndex = wiz.index + 1;
      if (nextIndex >= wiz.queue.length) {
        try {
          const groups = bulkGroupParsedRows(wiz.stagingRows, resolutions);
          setBulkPreview(groups);
          const total = groups.reduce((sum, g) => sum + g.units.length, 0);
          toast({
            title: "Preview ready",
            description: `Site setup finished (${wiz.queue.length} site${wiz.queue.length !== 1 ? "s" : ""}). Review ${total} unit(s) in ${groups.length} group(s) below, then confirm.`,
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
    [],
  );

  const onBulkPreview = (csvInput = bulkCsv) => {
    const structured = parseBulkStructural(csvInput, machines);
    if (!structured.ok) {
      toast({ title: "Could not parse CSV", description: structured.error, variant: "destructive" });
      return;
    }
    if (structured.rows.length === 0) {
      toast({
        title: "No units to import",
        description: "Every row has qty 0. Set qty to at least 1 on rows where you want machinery created.",
        variant: "destructive",
      });
      return;
    }

    const codeErr = bulkValidationUniqueCodes(structured.rows, machines);
    if (codeErr) {
      toast({ title: "Could not validate import", description: codeErr, variant: "destructive" });
      return;
    }

    const hasAssigned = structured.rows.some((r) => r.status === "assigned");
    const ownerCompanyId = user.role === "super_admin" ? poolCompanyId : user.companyId;
    if (hasAssigned && !ownerCompanyId) {
      toast({
        title: "Company required",
        description:
          user.role === "super_admin"
            ? "Select which company owns the equipment before previewing assigned rows."
            : "Your profile needs a company assignment.",
        variant: "destructive",
      });
      return;
    }

    const queue = bulkSiteConfirmQueue(structured.rows, sitesForForm);

    if (queue.length === 0) {
      try {
        const groups = bulkGroupParsedRows(structured.rows, {});
        const total = groups.reduce((sum, g) => sum + g.units.length, 0);
        setBulkPreview(groups);
        toast({
          title: "Preview ready",
          description: `Review ${total} unit(s) in ${groups.length} group(s) below, then confirm.`,
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
      resolutions: {},
      pendingNormNames: new Set(),
      ui: wizardUiSeed(queue[0]),
    });
    toast({
      title: "Site confirmation",
      description: `${queue.length} site${queue.length !== 1 ? "s need" : " needs"} your choice before preview (step 1 of ${queue.length}).`,
    });
  };

  const onBulkConfirm = () => {
    if (!bulkPreview || bulkPreview.length === 0) return;
    const total = bulkPreview.reduce((sum, g) => sum + g.units.length, 0);
    void (async () => {
      try {
        let ledgerCompanyId: string | null = null;
        for (const group of bulkPreview) {
          const { siteName: _s, ...payload } = group;
          const companyId = resolveMachineryCompanyId(user, sites, payload.assignedSiteId, user.role === "super_admin" ? poolCompanyId : null);
          if (!companyId) throw new Error("Missing company context for bulk row.");
          ledgerCompanyId = companyId;
          await addMachineryMutation.mutateAsync({
            category: payload.category,
            status: payload.status,
            assignedSiteId: payload.assignedSiteId,
            companyId,
            unitType: payload.unitType,
            units: payload.units,
            ledgerImportTag: "bulk_csv",
          });
        }

        if (ledgerCompanyId) {
          try {
            await appendAuditLedgerEntry({
              companyId: ledgerCompanyId,
              eventKind: "bulk_upload_completed",
              summary: `Bulk machinery CSV import finished: ${total} unit(s) across ${bulkPreview.length} row group(s).`,
              siteId: null,
              machineIds: [],
              requester: user.name ?? "System",
              approvedBy: user.name ?? "System",
              approverRole: ROLE_LABELS[user.role],
              totalUnits: total,
            });
          } catch (err) {
            console.warn("[ledger] bulk session summary skipped", err);
          }
        }

        void queryClient.invalidateQueries({ queryKey: operationalKeys.all });
        toast({ title: "Bulk upload complete", description: `${total} machinery unit(s) added to the system.` });
        setOpen(false);
        resetForm();
      } catch (err) {
        toast({
          title: "Bulk upload failed",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      }
    })();
  };

  const loadBulkFile = async (file: File) => {
    const text = await file.text();
    setBulkCsv(text);
    setBulkFileName(file.name);
    setBulkPreview(null);
    setBulkWizard(null);
    setIsBulkDragActive(false);
  };

  const onBulkFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadBulkFile(file);
    event.target.value = "";
  };

  const onBulkDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsBulkDragActive(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) return;
    await loadBulkFile(droppedFile);
  };

  const onBulkDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isBulkDragActive) setIsBulkDragActive(true);
  };

  const onBulkDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsBulkDragActive(false);
  };

  const downloadSampleTemplate = () => {
    const blob = new Blob([SAMPLE_BULK_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "machinery-bulk-upload-template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const abortBulkWizard = () => {
    setBulkWizard(null);
    toast({
      title: "Upload canceled",
      description: "Site setup was canceled. Nothing was imported. You can keep editing your CSV or choose another file.",
    });
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

    const ownerCompanyId = user.role === "super_admin" ? poolCompanyId : user.companyId;
    if (!ownerCompanyId) {
      toast({
        title: "Company required",
        description: "Pick a company (super admin) or fix your profile before creating a site.",
        variant: "destructive",
      });
      return;
    }

    if (siteNameTakenForCompany(trimmed, ownerCompanyId, sites, wiz.pendingNormNames)) {
      toast({
        title: "Site name already in use",
        description:
          `Use a unique site name within this company. "${trimmed}" matches an existing or pending site in this upload.`,
        variant: "destructive",
      });
      return;
    }

    const markerKey = item.key;
    const markerIdx = wiz.index;

    try {
      const siteId = await createSiteMutation.mutateAsync({
        name: trimmed,
        location: item.csvLocation.trim(),
        machineIds: [],
        companyId: ownerCompanyId,
        createdDuringBulkUpload: true,
      });
      const nextPending = new Set(wiz.pendingNormNames);
      nextPending.add(normBulkCompareKey(trimmed));

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

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {buttonText}
      </Button>
      <DialogContent className={mode === "bulk" ? "sm:max-w-6xl" : undefined}>
        <DialogHeader>
          <DialogTitle>Add new machinery</DialogTitle>
          <DialogDescription>
            Create machinery units and optionally assign them to a site. Codes and names are auto-predicted but fully editable.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              mode === "single" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            Single Add
          </button>
          <button
            type="button"
            onClick={() => setMode("bulk")}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              mode === "bulk" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            Bulk Upload
          </button>
        </div>

        {mode === "single" ? (
          <>
            {user.role === "super_admin" && (
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Company (equipment owner)</label>
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  value={poolCompanyId}
                  onChange={(e) => setPoolCompanyId(e.target.value)}
                  disabled={companies.length === 0}
                >
                  <option value="">{companies.length ? "Select company" : "Loading…"}</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Used for equipment ownership (available/maintenance) and to filter which sites appear when status is <strong>Assigned</strong>.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Category</label>
                <select
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  value={form.category}
                  onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
                >
                  <option value="">Select category</option>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                  <option value="__new__">+ Add new category</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Units</label>
                <div className="flex overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring/30">
                  <input
                    type="number"
                    min={1}
                    className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm outline-none"
                    value={form.quantity}
                    onChange={(e) =>
                      setForm((current) => ({ ...current, quantity: Math.max(1, Number(e.target.value) || 1) }))
                    }
                  />
                  <div className="flex shrink-0 items-stretch border-l border-border bg-muted/40">
                    <Select
                      value={form.unitType}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          unitType: value as PresetMachineryUnitType | typeof CUSTOM_MACHINERY_UNIT_VALUE,
                        }))
                      }
                    >
                      <SelectTrigger className="h-auto min-w-[5.25rem] max-w-[7rem] gap-1 rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus:ring-0">
                        <SelectValue>
                          {form.unitType === CUSTOM_MACHINERY_UNIT_VALUE
                            ? form.customUnitType.trim() || "Custom"
                            : form.unitType}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent position="popper" className="z-[120] max-h-72">
                        {MACHINERY_UNIT_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_MACHINERY_UNIT_VALUE}>Custom…</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.unitType === CUSTOM_MACHINERY_UNIT_VALUE && (
                  <input
                    className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    value={form.customUnitType}
                    onChange={(e) => setForm((current) => ({ ...current, customUnitType: e.target.value }))}
                    placeholder="e.g. tonne, sqm, bundle"
                    maxLength={24}
                  />
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Count in{" "}
                  {form.unitType === CUSTOM_MACHINERY_UNIT_VALUE
                    ? form.customUnitType.trim() || "your custom unit"
                    : form.unitType}{" "}
                  — e.g. pieces, metres, kg.
                </p>
              </div>

              {form.category === "__new__" && (
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">New category name</label>
                  <input
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                    value={form.customCategory}
                    onChange={(e) => setForm((current) => ({ ...current, customCategory: e.target.value }))}
                    placeholder="e.g. Plasma Cutter"
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</label>
                <Select
                  value={form.status}
                  onValueChange={(value) => {
                    const next = value as MachineryStatus;
                    setForm((current) => {
                      if (next === "assigned") {
                        const list = sitesForAssignment;
                        const keep = Boolean(current.assignedSiteId && list.some((s) => s.id === current.assignedSiteId));
                        const nextSiteId = keep ? current.assignedSiteId : list[0]?.id ?? "";
                        return { ...current, status: next, assignedSiteId: nextSiteId };
                      }
                      return { ...current, status: next, assignedSiteId: "" };
                    });
                  }}
                >
                  <SelectTrigger className="w-full border-border bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[120] max-h-72">
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="assigned">Assigned</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Assigned site
                </label>
                <Select
                  key={user.role === "super_admin" ? `sa-${poolCompanyId}` : "tenant-assign"}
                  value={
                    form.status === "assigned" && form.assignedSiteId && sitesForAssignment.some((s) => s.id === form.assignedSiteId)
                      ? form.assignedSiteId
                      : undefined
                  }
                  onValueChange={(siteId) => setForm((current) => ({ ...current, assignedSiteId: siteId }))}
                  disabled={
                    form.status !== "assigned" || sitesPending || sitesForAssignment.length === 0
                  }
                >
                  <SelectTrigger className="w-full border-border bg-card">
                    <SelectValue
                      placeholder={
                        form.status !== "assigned"
                          ? "Enable when Status is Assigned"
                          : sitesPending
                            ? "Loading sites…"
                            : sitesForAssignment.length === 0
                              ? "No sites for your company yet"
                              : "Select deployment site"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[120] max-h-72">
                    {sitesForAssignment.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name} ({site.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {unitEntries.length > 0 && (
              <div className="rounded-md border border-border">
                <div className="grid grid-cols-[1fr_1fr] border-b border-border bg-secondary/40 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <div>Machinery code</div>
                  <div>Machinery name</div>
                </div>
                <div className="max-h-56 overflow-y-auto p-2">
                  <div className="space-y-2">
                    {unitEntries.map((unit, index) => (
                      <div key={index} className="grid grid-cols-[1fr_1fr] gap-2">
                        <input
                          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                          value={unit.code}
                          onChange={(e) =>
                            setUnitEntries((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, code: e.target.value } : item
                              )
                            )
                          }
                        />
                        <input
                          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                          value={unit.name}
                          onChange={(e) =>
                            setUnitEntries((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, name: e.target.value } : item
                              )
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {bulkPreview ? (
              <div className="space-y-2">
                {user.role === "super_admin" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Default company (available / maintenance rows)</label>
                    <select
                      className="w-full max-w-md rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                      value={poolCompanyId}
                      onChange={(e) => setPoolCompanyId(e.target.value)}
                    >
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <p className="text-sm font-medium">Review import ({bulkPreview.reduce((n, g) => n + g.units.length, 0)} units)</p>
                <p className="text-xs text-muted-foreground">Nothing is saved until you confirm. Use Back to file to pick another file and preview again.</p>
                <div className="max-h-72 overflow-auto rounded-md border border-border">
                  <table className="min-w-[900px] text-xs">
                    <thead className="sticky top-0 border-b border-border bg-secondary/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 font-medium whitespace-nowrap">Category</th>
                        <th className="px-2 py-1.5 font-medium whitespace-nowrap">Unit</th>
                        <th className="px-2 py-1.5 font-medium whitespace-nowrap">Status</th>
                        <th className="px-2 py-1.5 font-medium whitespace-nowrap">Project</th>
                        <th className="px-2 py-1.5 font-medium whitespace-nowrap">Location</th>
                        <th className="px-2 py-1.5 font-medium whitespace-nowrap">Code</th>
                        <th className="px-2 py-1.5 font-medium whitespace-nowrap">Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.flatMap((group) =>
                        group.units.map((unit) => (
                          <tr key={`${group.category}-${unit.code}`} className="border-b border-border/80 last:border-0">
                            <td className="px-2 py-1.5 align-top whitespace-nowrap">{group.category}</td>
                            <td className="px-2 py-1.5 align-top whitespace-nowrap">{group.unitType}</td>
                            <td className="px-2 py-1.5 align-top capitalize whitespace-nowrap">{group.status}</td>
                            <td className="px-2 py-1.5 align-top">{unit.projectName}</td>
                            <td className="px-2 py-1.5 align-top whitespace-nowrap">{unit.projectLocation}</td>
                            <td className="px-2 py-1.5 font-mono align-top text-left whitespace-nowrap">{unit.code}</td>
                            <td className="px-2 py-1.5 align-top">{unit.name}</td>
                          </tr>
                        )),
                      )}
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
                      setBulkCsv(SAMPLE_BULK_CSV);
                      setBulkFileName("sample-bulk-data.csv");
                      onBulkPreview(SAMPLE_BULK_CSV);
                    }}
                    className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline dark:text-sky-400"
                  >
                    Load Sample Data
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  CSV columns (6): <span className="font-mono">projectName, location, category, qty, unit_type, status</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">qty</span> is how many units to create (0 or more); codes and names are auto-generated (same as Single Add).{" "}
                  <span className="font-mono">unit_type</span>: nos, metre, kg, or any custom label (e.g. tonne).
                </p>
                <p className="text-xs text-muted-foreground">
                  For <span className="font-mono">status=assigned</span>, rows are grouped by site; if a deployment is missing you can create it step-by-step.
                </p>
                <p className="text-xs text-muted-foreground">
                  Allowed statuses: <span className="font-mono">assigned</span>, <span className="font-mono">maintenance</span>, <span className="font-mono">available</span>.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={downloadSampleTemplate}>
                    Download sample template
                  </Button>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                    <Upload className="h-3.5 w-3.5" />
                    Upload CSV file
                    <input
                      ref={bulkFileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={onBulkFileSelected}
                    />
                  </label>
                </div>
                <div
                  className={`rounded-md border border-dashed p-4 transition-colors ${
                    isBulkDragActive ? "border-primary bg-primary/5" : "border-border bg-card/40"
                  }`}
                  onDrop={onBulkDrop}
                  onDragOver={onBulkDragOver}
                  onDragLeave={onBulkDragLeave}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Upload className="h-3.5 w-3.5" />
                      <span>Or drag and drop a CSV into this area</span>
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
                    : "No file selected. Upload a .csv, drag and drop, or use Load Sample Data at the top to try the flow."}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {mode === "bulk" && bulkPreview ? (
            <>
              <Button type="button" variant="outline" onClick={() => setBulkPreview(null)}>
                Back to file
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={onBulkConfirm}>
                Confirm & import
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {mode === "single" ? (
                <Button type="button" onClick={onCreate}>
                  Create machinery
                </Button>
              ) : (
                <Button type="button" onClick={() => onBulkPreview()} disabled={!bulkCsv.trim()}>
                  Preview import
                </Button>
              )}
            </>
          )}
        </DialogFooter>
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
                      No site with this name matches an existing deployment for project &quot;{bulkWizardStepItem.csvProjectName}&quot; at
                      &quot;{bulkWizardStepItem.csvLocation}&quot;.
                    </p>
                    <p>
                      Would you like to create a new site named{' '}
                      <span className="font-semibold text-foreground">{bulkWizardStepItem.csvProjectName.trim()}</span>?
                    </p>
                  </div>
                </AlertDialogDescription>
              ) : null}

              {bulkWizardStepItem.existingSite && bulkWizard.ui.mode === "case2-choice" ? (
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-muted-foreground">
                    <p>A site with this name already exists for this mapping.</p>
                    <p>
                      Matched site:{' '}
                      <span className="font-semibold text-foreground">{bulkWizardStepItem.existingSite.name}</span> (
                      {bulkWizardStepItem.existingSite.location}).
                    </p>
                    <p>
                      Add these machinery rows under that existing site, or enter a different name to create another site (&quot;
                      {bulkWizardStepItem.csvProjectName}&quot; at &quot;{bulkWizardStepItem.csvLocation}&quot;).
                    </p>
                  </div>
                </AlertDialogDescription>
              ) : null}

              {(bulkWizard.ui.mode === "case1-edit" || bulkWizard.ui.mode === "case2-enterNew") && (
                <>
                  <AlertDialogDescription>Edit the site name below, then create the site.</AlertDialogDescription>
                  <label className="sr-only" htmlFor="bulk-site-name-input">
                    Site name
                  </label>
                  <input
                    id="bulk-site-name-input"
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
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto shrink-0 px-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={abortBulkWizard}
                    disabled={bulkWizardSaving}
                  >
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
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto shrink-0 px-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={abortBulkWizard}
                    disabled={bulkWizardSaving}
                  >
                    {!bulkWizardStepItem.existingSite ? "Cancel upload" : "Cancel"}
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
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto shrink-0 px-2 text-muted-foreground hover:bg-transparent hover:text-foreground"
                    onClick={abortBulkWizard}
                    disabled={bulkWizardSaving}
                  >
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
};

const SAMPLE_BULK_CSV = [
  "projectName,location,category,qty,unit_type,status",
  "UPL Limited — Panoli,\"Panoli, Gujarat\",Grinding Machine,2,nos,assigned",
  "L&T Heavy Engineering — Hazira,\"Hazira, Gujarat\",Lathe Machine,1,nos,available",
  "SRF Limited — Dahej,\"Dahej, Gujarat\",Compressor Unit,1,nos,maintenance",
  "SRF Limited — Dahej,\"Dahej, Gujarat\",Welding Machine,3,metre,assigned",
].join("\n");

const parseBulkStatus = (value: string): MachineryStatus | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "assigned" || normalized === "maintenance" || normalized === "available") {
    return normalized;
  }
  return null;
};

const parseCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
};

