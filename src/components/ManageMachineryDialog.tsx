import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronsUpDown, Truck } from "lucide-react";
import { format } from "date-fns";
import type { LedgerEntry, Machine, MachineryStatus, Site } from "@/domain/types";
import { MACHINERY_CATEGORIES } from "@/domain/types";
import { cn } from "@/lib/utils";
import {
  CUSTOM_MOVEMENT_SOURCE_VALUE,
  NEW_MACHINES_POOL_LABEL,
  NEW_MACHINES_SOURCE_VALUE,
  customStatusSelectValue,
  isReservedSourcePoolLabel,
  isSavedCustomStatusSelect,
  labelFromCustomStatusSelect,
  machineryGroupLabel,
  machineryLineKey,
  movementDirectionDisplayLabel,
  parseMovementEditFromLedger,
  type MachineryMovementDirection,
} from "@/lib/site-allocation-history";
import { seedCategoryCodegen, takeMachineryUnitsFromCursor } from "@/lib/machinery-unit-codegen";
import {
  CUSTOM_MACHINERY_UNIT_VALUE,
  DEFAULT_MACHINERY_UNIT_TYPE,
  MACHINERY_UNIT_TYPE_OPTIONS,
  resolveMachineryUnitType,
  type MachineryUnitType,
  type PresetMachineryUnitType,
} from "@/lib/machinery-unit-types";
import {
  useAddMachineryMutation,
  useMachinerySourceStatusesQuery,
  useRecordMachineryMovementMutation,
  useUpdateMachineryMovementMutation,
} from "@/hooks/useOperationalData";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";

type Props = {
  site: Site;
  machines: Machine[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editEntry?: LedgerEntry | null;
  showTrigger?: boolean;
};

type MachineryLine = {
  key: string;
  label: string;
  machineIds: string[];
  availableCount: number;
};

const SOURCE_OPTIONS: { value: MachineryStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "assigned", label: "Assigned" },
  { value: "maintenance", label: "Maintenance" },
];

function getEligibleMachines(
  direction: MachineryMovementDirection,
  sourceStatus: MachineryStatus,
  siteId: string,
  machines: Machine[],
  includeIds: string[] = [],
): Machine[] {
  let pool: Machine[];
  if (direction === "out") {
    pool = machines.filter((m) => m.assignedSiteId === siteId && m.status === sourceStatus);
  } else if (sourceStatus === "available") {
    pool = machines.filter((m) => m.status === "available" && m.assignedSiteId === null);
  } else if (sourceStatus === "maintenance") {
    pool = machines.filter((m) => m.status === "maintenance" && m.assignedSiteId === null);
  } else {
    pool = machines.filter(
      (m) => m.status === "assigned" && m.assignedSiteId !== null && m.assignedSiteId !== siteId,
    );
  }

  if (includeIds.length === 0) return pool;
  const byId = new Map(pool.map((m) => [m.id, m]));
  for (const machine of machines) {
    if (includeIds.includes(machine.id)) byId.set(machine.id, machine);
  }
  return Array.from(byId.values());
}

function buildMachineryLines(eligible: Machine[]): MachineryLine[] {
  const grouped = new Map<string, { label: string; machineIds: string[] }>();
  const sorted = [...eligible].sort((a, b) => a.code.localeCompare(b.code));

  for (const machine of sorted) {
    const key = machineryLineKey(machine);
    const entry = grouped.get(key) ?? { label: machineryGroupLabel(machine), machineIds: [] };
    entry.machineIds.push(machine.id);
    grouped.set(key, entry);
  }

  return Array.from(grouped.entries()).map(([key, entry]) => ({
    key,
    label: entry.label,
    machineIds: entry.machineIds,
    availableCount: entry.machineIds.length,
  }));
}

function MotionField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function defaultFormState() {
  return {
    direction: "out" as MachineryMovementDirection,
    sourceStatus: "available" as MachineryStatus,
    movementDate: format(new Date(), "yyyy-MM-dd"),
    gatePassNumber: "",
    selectedLineKey: "",
    quantity: 1,
  };
}

export function ManageMachineryDialog({
  site,
  machines,
  open: controlledOpen,
  onOpenChange,
  editEntry = null,
  showTrigger,
}: Props) {
  const recordMutation = useRecordMachineryMovementMutation();
  const updateMutation = useUpdateMachineryMovementMutation();
  const addMachineryMutation = useAddMachineryMutation();
  const { data: savedCustomStatuses = [] } = useMachinerySourceStatusesQuery(site.companyId);
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const shouldShowTrigger = showTrigger ?? !isControlled;

  const isEditing = Boolean(editEntry);
  const editDraft = useMemo(
    () => (editEntry ? parseMovementEditFromLedger(editEntry, machines) : null),
    [editEntry, machines],
  );
  const originalSnapshot = useRef(editDraft);

  const [direction, setDirection] = useState<MachineryMovementDirection>("out");
  const [sourceSelect, setSourceSelect] = useState<string>("available");
  const [sourceStatus, setSourceStatus] = useState<MachineryStatus>("available");
  const [customSourceStatus, setCustomSourceStatus] = useState("");
  const [customMachineryName, setCustomMachineryName] = useState("");
  const [movementDate, setMovementDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [gatePassNumber, setGatePassNumber] = useState("");
  const [selectedLineKey, setSelectedLineKey] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [machineryPickerOpen, setMachineryPickerOpen] = useState(false);
  const [categorySelect, setCategorySelect] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [unitType, setUnitType] = useState<PresetMachineryUnitType | typeof CUSTOM_MACHINERY_UNIT_VALUE>(
    DEFAULT_MACHINERY_UNIT_TYPE,
  );
  const [customUnitType, setCustomUnitType] = useState("");

  const isStoreToSite = direction === "in";
  const isLegacyCustomDraft = sourceSelect === CUSTOM_MOVEMENT_SOURCE_VALUE;
  const isNewMachinesMode = sourceSelect === NEW_MACHINES_SOURCE_VALUE;
  const isSavedCustomStatus = isSavedCustomStatusSelect(sourceSelect);
  const isCustomPool = isLegacyCustomDraft || isSavedCustomStatus;
  const activeCustomLabel = isSavedCustomStatus
    ? labelFromCustomStatusSelect(sourceSelect)
    : customSourceStatus.trim();
  const sourceStatusLabel =
    SOURCE_OPTIONS.find((opt) => opt.value === sourceStatus)?.label ?? sourceStatus;
  const sourceSelectDisplay = isNewMachinesMode
    ? NEW_MACHINES_POOL_LABEL
    : isLegacyCustomDraft
      ? customSourceStatus.trim() || NEW_MACHINES_POOL_LABEL
      : isSavedCustomStatus
        ? activeCustomLabel
        : sourceStatusLabel;

  const categoryOptions = useMemo(() => {
    const fromFleet = machines
      .filter((m) => m.companyId === site.companyId)
      .map((m) => m.category);
    return Array.from(new Set([...MACHINERY_CATEGORIES, ...fromFleet])).sort((a, b) => a.localeCompare(b));
  }, [machines, site.companyId]);

  const finalCategory =
    categorySelect === "__new__" ? customCategory.trim() : categorySelect.trim();
  const resolvedUnitType = resolveMachineryUnitType(unitType, customUnitType);

  const includeMachineIds = isEditing && editDraft ? editDraft.machineIds : [];

  const eligibleMachines = useMemo(
    () =>
      isCustomPool || isNewMachinesMode
        ? []
        : getEligibleMachines(direction, sourceStatus, site.id, machines, includeMachineIds),
    [direction, sourceStatus, site.id, machines, includeMachineIds, isCustomPool, isNewMachinesMode],
  );

  const machineryLines = useMemo(() => buildMachineryLines(eligibleMachines), [eligibleMachines]);

  const selectedLine = useMemo(
    () => machineryLines.find((line) => line.key === selectedLineKey) ?? null,
    [machineryLines, selectedLineKey],
  );

  const maxQuantity = isCustomPool || isNewMachinesMode ? 0 : (selectedLine?.availableCount ?? 0);
  const isPending =
    recordMutation.isPending || updateMutation.isPending || addMachineryMutation.isPending;

  useEffect(() => {
    if (!open) return;
    if (editDraft) {
      originalSnapshot.current = editDraft;
      setDirection(editDraft.direction);
      if (editDraft.isCustomSource) {
        const label = editDraft.customSourceLabel.trim();
        if (label.toLowerCase() === NEW_MACHINES_POOL_LABEL.toLowerCase()) {
          setSourceSelect(NEW_MACHINES_SOURCE_VALUE);
          setCustomSourceStatus("");
          setCustomMachineryName("");
          const cat = editDraft.machineryLabel.trim();
          if (categoryOptions.includes(cat)) {
            setCategorySelect(cat);
            setCustomCategory("");
          } else if (cat) {
            setCategorySelect("__new__");
            setCustomCategory(cat);
          }
        } else {
          const saved = savedCustomStatuses.find((row) => row.label.toLowerCase() === label.toLowerCase());
          if (saved) {
            setSourceSelect(customStatusSelectValue(saved.label));
            setCustomSourceStatus("");
          } else {
            setSourceSelect(CUSTOM_MOVEMENT_SOURCE_VALUE);
            setCustomSourceStatus(label);
          }
          setCustomMachineryName(editDraft.machineryLabel);
        }
      } else {
        setSourceSelect(editDraft.sourceStatus);
        setSourceStatus(editDraft.sourceStatus);
        setCustomSourceStatus("");
        setCustomMachineryName("");
      }
      setMovementDate(editDraft.movementDate);
      setGatePassNumber(editDraft.gatePassNumber);
      setSelectedLineKey(editDraft.lineKey);
      setQuantity(editDraft.quantity);
      return;
    }
    const defaults = defaultFormState();
    setDirection(defaults.direction);
    setSourceSelect("assigned");
    setSourceStatus("assigned");
    setCustomSourceStatus("");
    setCustomMachineryName("");
    setMovementDate(defaults.movementDate);
    setGatePassNumber("");
    setSelectedLineKey("");
    setQuantity(1);
    setCategorySelect("");
    setCustomCategory("");
    setUnitType(DEFAULT_MACHINERY_UNIT_TYPE);
    setCustomUnitType("");
  }, [open, editDraft, savedCustomStatuses, categoryOptions]);

  useEffect(() => {
    if (!open || isEditing || isCustomPool || isNewMachinesMode) return;
    const next = direction === "out" ? "assigned" : "available";
    setSourceSelect(next);
    setSourceStatus(next);
  }, [direction, open, isEditing, isCustomPool, isNewMachinesMode]);

  useEffect(() => {
    if (!open || isEditing) return;
    if (!isStoreToSite && isNewMachinesMode) {
      setSourceSelect("assigned");
      setSourceStatus("assigned");
      setCategorySelect("");
      setCustomCategory("");
    }
  }, [isStoreToSite, isNewMachinesMode, open, isEditing]);

  useEffect(() => {
    if (!open || isEditing) return;
    if (isCustomPool || isNewMachinesMode) {
      setSelectedLineKey("");
      return;
    }
    setSelectedLineKey("");
    setQuantity(1);
  }, [direction, sourceStatus, open, isEditing, isCustomPool, isNewMachinesMode]);

  useEffect(() => {
    if (isCustomPool || isNewMachinesMode || maxQuantity <= 0) return;
    if (quantity > maxQuantity) {
      setQuantity(maxQuantity);
    }
  }, [maxQuantity, quantity, isCustomPool, isNewMachinesMode]);

  const resetAndClose = () => {
    setOpen(false);
    setGatePassNumber("");
    setSelectedLineKey("");
    setCustomSourceStatus("");
    setCustomMachineryName("");
    setQuantity(1);
    setCategorySelect("");
    setCustomCategory("");
    setUnitType(DEFAULT_MACHINERY_UNIT_TYPE);
    setCustomUnitType("");
  };

  const handleSubmit = () => {
    if (isNewMachinesMode) {
      if (isEditing && originalSnapshot.current) {
        const movementPayload = {
          siteId: site.id,
          siteName: site.name,
          companyId: site.companyId,
          direction,
          sourceStatus: "assigned" as MachineryStatus,
          customSourceStatus: NEW_MACHINES_POOL_LABEL,
          movementDate,
          gatePassNumber: gatePassNumber.trim() || undefined,
          machineIds: originalSnapshot.current.machineIds,
          machineryLabel: finalCategory || originalSnapshot.current.machineryLabel,
          quantity,
        };
        updateMutation.mutate(
          {
            ...movementPayload,
            ledgerEntryId: originalSnapshot.current.ledgerId,
            original: {
              direction: originalSnapshot.current.direction,
              sourceStatus: originalSnapshot.current.sourceStatus,
              customSourceStatus: NEW_MACHINES_POOL_LABEL,
              machineIds: originalSnapshot.current.machineIds,
            },
          },
          {
            onSuccess: () => {
              toast({ title: "Movement updated", description: `Record updated for ${site.name}.` });
              resetAndClose();
            },
            onError: (err: Error) => {
              toast({
                title: "Could not update movement",
                description: err.message,
                variant: "destructive",
              });
            },
          },
        );
        return;
      }

      if (!isStoreToSite) {
        toast({
          title: "OUT only",
          description: "New machines can only be recorded when the store sends equipment to the site (OUT).",
          variant: "destructive",
        });
        return;
      }
      if (!finalCategory) {
        toast({ title: "Category required", description: "Select or enter a machinery category.", variant: "destructive" });
        return;
      }
      if (!resolvedUnitType) {
        toast({ title: "Unit type required", description: "Enter a unit type (e.g. nos, metre).", variant: "destructive" });
        return;
      }
      if (quantity < 1) {
        toast({ title: "Invalid quantity", description: "Enter a quantity of 1 or more.", variant: "destructive" });
        return;
      }

      const reservedCodes = new Set(machines.map((m) => m.code.toUpperCase()));
      const cursor = seedCategoryCodegen(finalCategory, machines, reservedCodes);
      const generated = takeMachineryUnitsFromCursor(cursor, quantity, reservedCodes);
      const units = generated.map((unit) => ({
        ...unit,
        projectName: site.name,
        projectLocation: site.location,
      }));

      const displayLabel = movementDirectionDisplayLabel(direction);
      const onSuccess = () => {
        toast({
          title: isEditing ? "Movement updated" : `Movement ${displayLabel} recorded`,
          description: `${quantity} new ${finalCategory} unit(s) added to ${site.name}.`,
        });
        resetAndClose();
      };
      const onError = (err: Error) => {
        toast({
          title: isEditing ? "Could not update" : "Could not record movement",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      };

      void (async () => {
        try {
          const { machineIds } = await addMachineryMutation.mutateAsync({
            category: finalCategory,
            status: "assigned",
            assignedSiteId: site.id,
            companyId: site.companyId,
            unitType: resolvedUnitType,
            units,
          });

          const movementPayload = {
            siteId: site.id,
            siteName: site.name,
            companyId: site.companyId,
            direction,
            sourceStatus: "assigned" as MachineryStatus,
            customSourceStatus: NEW_MACHINES_POOL_LABEL,
            movementDate,
            gatePassNumber: gatePassNumber.trim() || undefined,
            machineIds,
            machineryLabel: finalCategory,
            quantity,
          };

          if (isEditing && originalSnapshot.current) {
            await updateMutation.mutateAsync({
              ...movementPayload,
              ledgerEntryId: originalSnapshot.current.ledgerId,
              original: {
                direction: originalSnapshot.current.direction,
                sourceStatus: originalSnapshot.current.sourceStatus,
                customSourceStatus: originalSnapshot.current.isCustomSource
                  ? originalSnapshot.current.customSourceLabel
                  : undefined,
                machineIds: originalSnapshot.current.machineIds,
              },
            });
          } else {
            await recordMutation.mutateAsync(movementPayload);
          }
          onSuccess();
        } catch (err) {
          onError(err instanceof Error ? err : new Error("Try again."));
        }
      })();
      return;
    }

    if (isCustomPool) {
      const statusLabel = activeCustomLabel;
      const machineryName = customMachineryName.trim();
      if (!statusLabel) {
        toast({ title: "Status required", description: "Enter a name for the new status pool.", variant: "destructive" });
        return;
      }
      if (isReservedSourcePoolLabel(statusLabel)) {
        toast({
          title: "Reserved name",
          description: "That name is already used by a standard status. Choose another label.",
          variant: "destructive",
        });
        return;
      }
      if (!machineryName) {
        toast({ title: "Machinery required", description: "Enter the machinery name to record.", variant: "destructive" });
        return;
      }
      if (quantity < 1) {
        toast({ title: "Invalid quantity", description: "Enter a quantity of 1 or more.", variant: "destructive" });
        return;
      }

      const payload = {
        siteId: site.id,
        siteName: site.name,
        companyId: site.companyId,
        direction,
        sourceStatus: "available" as MachineryStatus,
        customSourceStatus: statusLabel,
        movementDate,
        gatePassNumber: gatePassNumber.trim() || undefined,
        machineIds: [] as string[],
        machineryLabel: machineryName,
        quantity,
      };

      const displayLabel = movementDirectionDisplayLabel(direction);
      const onSuccess = () => {
        toast({
          title: isEditing ? "Movement updated" : `Movement ${displayLabel} recorded`,
          description: `${quantity} unit(s) ${isEditing ? "updated for" : "logged for"} ${site.name}.`,
        });
        resetAndClose();
      };
      const onError = (err: Error) => {
        toast({
          title: isEditing ? "Could not update movement" : "Could not record movement",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        });
      };

      if (isEditing && originalSnapshot.current) {
        const original = originalSnapshot.current;
        updateMutation.mutate(
          {
            ...payload,
            ledgerEntryId: original.ledgerId,
            original: {
              direction: original.direction,
              sourceStatus: original.sourceStatus,
              customSourceStatus: original.isCustomSource ? original.customSourceLabel : undefined,
              machineIds: original.machineIds,
            },
          },
          { onSuccess, onError },
        );
        return;
      }

      recordMutation.mutate(payload, { onSuccess, onError });
      return;
    }

    if (!selectedLine) {
      toast({ title: "Select machinery", description: "Choose a machinery type from the list.", variant: "destructive" });
      return;
    }
    if (quantity < 1 || quantity > selectedLine.availableCount) {
      toast({
        title: "Invalid quantity",
        description: `Enter between 1 and ${selectedLine.availableCount} units.`,
        variant: "destructive",
      });
      return;
    }

    const machineIds = selectedLine.machineIds.slice(0, quantity);
    const payload = {
      siteId: site.id,
      siteName: site.name,
      companyId: site.companyId,
      direction,
      sourceStatus,
      movementDate,
      gatePassNumber: gatePassNumber.trim() || undefined,
      machineIds,
      machineryLabel: selectedLine.label,
      quantity,
    };

    const displayLabel = movementDirectionDisplayLabel(direction);
    const onSuccess = () => {
      toast({
        title: isEditing ? "Movement updated" : `Movement ${displayLabel} recorded`,
        description: `${quantity} unit(s) ${isEditing ? "updated for" : "logged for"} ${site.name}.`,
      });
      resetAndClose();
    };

    const onError = (err: Error) => {
      toast({
        title: isEditing ? "Could not update movement" : "Could not record movement",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    };

    if (isEditing && originalSnapshot.current) {
      const original = originalSnapshot.current;
      updateMutation.mutate(
        {
          ...payload,
          ledgerEntryId: original.ledgerId,
          original: {
            direction: original.direction,
            sourceStatus: original.sourceStatus,
            customSourceStatus: original.isCustomSource ? original.customSourceLabel : undefined,
            machineIds: original.machineIds,
          },
        },
        { onSuccess, onError },
      );
      return;
    }

    recordMutation.mutate(payload, { onSuccess, onError });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {shouldShowTrigger && (
        <DialogTrigger asChild>
          <Button type="button" variant="outline" className="gap-1.5 border-border font-semibold shadow-card">
            <Truck className="h-4 w-4" />
            Manage Machinery
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-display">{isEditing ? "Edit movement" : "Manage Machinery"}</DialogTitle>
          <DialogDescription>
            {isEditing ? (
              <>
                Update this IN/OUT record for{" "}
                <span className="font-medium text-foreground">{site.name}</span>. Stock and the ledger will be
                corrected.
              </>
            ) : (
              <>
                Record machinery movement in or out of{" "}
                <span className="font-medium text-foreground">{site.name}</span>. Movements update site allocation
                and the audit ledger.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain pr-1">
          <MotionField label="Movement direction">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary/40 p-1">
              <button
                type="button"
                onClick={() => setDirection("in")}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 rounded-md px-3 py-2.5 transition-all",
                  direction === "in"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <ArrowUpFromLine className="h-4 w-4 shrink-0" />
                  OUT
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium leading-tight",
                    direction === "in" ? "text-white/85" : "text-muted-foreground",
                  )}
                >
                  (From Store to Site)
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDirection("out")}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 rounded-md px-3 py-2.5 transition-all",
                  direction === "out"
                    ? "bg-amber-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <ArrowDownToLine className="h-4 w-4 shrink-0" />
                  IN
                </span>
                <span
                  className={cn(
                    "text-[10px] font-medium leading-tight",
                    direction === "out" ? "text-white/85" : "text-muted-foreground",
                  )}
                >
                  (From Site to Store)
                </span>
              </button>
            </div>
          </MotionField>

          <MotionField label="Machinery source / status">
            <Select
              value={sourceSelect}
              onValueChange={(v) => {
                if (v === NEW_MACHINES_SOURCE_VALUE) {
                  setSourceSelect(NEW_MACHINES_SOURCE_VALUE);
                  setCustomSourceStatus("");
                  setCustomMachineryName("");
                  setSelectedLineKey("");
                  setCategorySelect("");
                  setCustomCategory("");
                  return;
                }
                if (isSavedCustomStatusSelect(v)) {
                  setSourceSelect(v);
                  setCustomSourceStatus("");
                  setCustomMachineryName("");
                  setSelectedLineKey("");
                  setCategorySelect("");
                  return;
                }
                const next = v as MachineryStatus;
                setSourceSelect(next);
                setSourceStatus(next);
                setCustomSourceStatus("");
                setCustomMachineryName("");
                setCategorySelect("");
              }}
            >
              <SelectTrigger>
                <span className="truncate">{sourceSelectDisplay}</span>
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
                {isStoreToSite ? (
                  <SelectItem value={NEW_MACHINES_SOURCE_VALUE}>{NEW_MACHINES_POOL_LABEL}</SelectItem>
                ) : null}
                {isEditing && isLegacyCustomDraft ? (
                  <SelectItem value={CUSTOM_MOVEMENT_SOURCE_VALUE}>Custom status (legacy)</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {isLegacyCustomDraft && !isNewMachinesMode ? (
              <Input
                placeholder="e.g. On rent, Subcontractor pool"
                value={customSourceStatus}
                onChange={(e) => setCustomSourceStatus(e.target.value)}
                maxLength={80}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              {isNewMachinesMode
                ? "Store is sending new equipment to this site (not from available / assigned / maintenance stock)."
                : isCustomPool
                  ? "Custom pool — saved for your company and reusable in this list."
                  : isStoreToSite
                    ? "Units arriving from the store (company pool or another site)."
                    : "Units returning from this site to the store."}
            </p>
          </MotionField>

          <MotionField label="Movement date">
            <Input type="date" value={movementDate} onChange={(e) => setMovementDate(e.target.value)} />
          </MotionField>

          <MotionField label="Gate pass number">
            <Input
              placeholder="e.g. GP-2026-0142"
              value={gatePassNumber}
              onChange={(e) => setGatePassNumber(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Optional — recommended for gate and yard tracking.</p>
          </MotionField>

          {isNewMachinesMode ? (
            <>
              <MotionField label="Machinery type">
                <Popover open={categoryPickerOpen} onOpenChange={setCategoryPickerOpen} modal={false}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={categoryPickerOpen}
                      className="w-full justify-between font-normal"
                    >
                      {finalCategory || "Search machinery category…"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="z-[100] w-[var(--radix-popover-trigger-width)] overflow-hidden p-0" align="start">
                    <Command className="flex flex-col overflow-hidden">
                      <CommandInput placeholder="Search category…" />
                      <div
                        className="max-h-[min(260px,45vh)] overflow-y-auto overscroll-y-contain touch-pan-y"
                        onWheel={(e) => e.stopPropagation()}
                      >
                        <CommandList className="max-h-none overflow-visible">
                          <CommandEmpty>No category found.</CommandEmpty>
                          <CommandGroup>
                          {categoryOptions.map((category) => (
                            <CommandItem
                              key={category}
                              value={category}
                              onSelect={() => {
                                setCategorySelect(category);
                                setCustomCategory("");
                                setCategoryPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  categorySelect === category ? "opacity-100" : "opacity-0",
                                )}
                              />
                              {category}
                            </CommandItem>
                          ))}
                          <CommandItem
                            value="__add_new_category__"
                            onSelect={() => {
                              setCategorySelect("__new__");
                              setCategoryPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                categorySelect === "__new__" ? "opacity-100" : "opacity-0",
                              )}
                            />
                            + Add new category
                          </CommandItem>
                          </CommandGroup>
                        </CommandList>
                      </div>
                    </Command>
                  </PopoverContent>
                </Popover>
                {categorySelect === "__new__" ? (
                  <Input
                    className="mt-2"
                    placeholder="e.g. Plasma Cutter"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    maxLength={120}
                  />
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Categories match the Machinery overview tab — not individual units from stock pools.
                </p>
              </MotionField>

              <MotionField label="Quantity & unit type">
                <div className="flex overflow-hidden rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-ring/30">
                  <Input
                    type="number"
                    min={1}
                    className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
                    value={quantity}
                    onChange={(e) => {
                      const next = Number.parseInt(e.target.value, 10);
                      if (Number.isFinite(next) && next >= 1) setQuantity(next);
                    }}
                  />
                  <div className="flex shrink-0 items-stretch border-l border-border bg-muted/40">
                    <Select
                      value={unitType}
                      onValueChange={(value) =>
                        setUnitType(value as PresetMachineryUnitType | typeof CUSTOM_MACHINERY_UNIT_VALUE)
                      }
                    >
                      <SelectTrigger className="h-auto min-w-[5.25rem] max-w-[7rem] gap-1 rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus:ring-0">
                        <SelectValue>
                          {unitType === CUSTOM_MACHINERY_UNIT_VALUE
                            ? customUnitType.trim() || "Custom"
                            : unitType}
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
                {unitType === CUSTOM_MACHINERY_UNIT_VALUE ? (
                  <Input
                    className="mt-2"
                    placeholder="e.g. tonne, sqm, bundle"
                    value={customUnitType}
                    onChange={(e) => setCustomUnitType(e.target.value)}
                    maxLength={24}
                  />
                ) : null}
                <p className="text-xs text-muted-foreground">No quantity cap — new purchases from market.</p>
              </MotionField>
            </>
          ) : isCustomPool ? (
            <MotionField label="Machinery name">
              <Input
                placeholder="e.g. ALLU. LADDER 6MTR"
                value={customMachineryName}
                onChange={(e) => setCustomMachineryName(e.target.value)}
                maxLength={200}
              />
            </MotionField>
          ) : (
            <MotionField label="Select machinery">
              <Popover open={machineryPickerOpen} onOpenChange={setMachineryPickerOpen} modal={false}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={machineryPickerOpen}
                    className="w-full justify-between font-normal"
                    disabled={machineryLines.length === 0}
                  >
                    {selectedLine ? selectedLine.label : machineryLines.length ? "Search machinery…" : "No units in pool"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="z-[100] w-[var(--radix-popover-trigger-width)] overflow-hidden p-0"
                  align="start"
                  onWheel={(e) => e.stopPropagation()}
                >
                  <Command className="flex flex-col overflow-hidden">
                    <CommandInput placeholder="Search code or name…" />
                    <div
                      className="max-h-[min(260px,45vh)] overflow-y-auto overscroll-y-contain touch-pan-y"
                      onWheel={(e) => e.stopPropagation()}
                    >
                      <CommandList className="max-h-none overflow-visible">
                        <CommandEmpty>No machinery in this pool.</CommandEmpty>
                        <CommandGroup className="overflow-visible p-1">
                          {machineryLines.map((line) => (
                            <CommandItem
                              key={line.key}
                              value={`${line.label} ${line.key}`}
                              onSelect={() => {
                                setSelectedLineKey(line.key);
                                setQuantity(Math.min(quantity, line.availableCount) || 1);
                                setMachineryPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn("mr-2 h-4 w-4", selectedLineKey === line.key ? "opacity-100" : "opacity-0")}
                              />
                              <span className="flex-1 truncate">{line.label}</span>
                              <span className="ml-2 text-xs text-muted-foreground tabular-nums">{line.availableCount}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </div>
                  </Command>
                </PopoverContent>
              </Popover>
            </MotionField>
          )}

          {!isNewMachinesMode ? (
            <MotionField label="Quantity">
              <Input
                type="number"
                min={1}
                max={isCustomPool ? undefined : maxQuantity || 1}
                value={quantity}
                disabled={!isCustomPool && !selectedLine}
                onChange={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(next) && next >= 1) setQuantity(next);
                }}
              />
              {isCustomPool ? (
                <p className="text-xs text-muted-foreground">No limit for custom status — enter any quantity.</p>
              ) : selectedLine ? (
                <p className="text-xs text-muted-foreground">
                  {maxQuantity} unit{maxQuantity === 1 ? "" : "s"} available in this pool.
                </p>
              ) : null}
            </MotionField>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-border pt-4 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isPending ||
              (isNewMachinesMode
                ? !finalCategory || !resolvedUnitType || quantity < 1
                : isCustomPool
                  ? !activeCustomLabel || !customMachineryName.trim()
                  : !selectedLine)
            }
            className={cn(
              direction === "in"
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-amber-600 text-white hover:bg-amber-700",
            )}
          >
            {isPending
              ? "Saving…"
              : isEditing
                ? "Save changes"
                : `Record movement ${movementDirectionDisplayLabel(direction)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
