import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronsUpDown, Truck } from "lucide-react";
import { format } from "date-fns";
import type { LedgerEntry, Machine, MachineryStatus, Site } from "@/domain/types";
import { cn } from "@/lib/utils";
import {
  CUSTOM_MOVEMENT_SOURCE_VALUE,
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
import {
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
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
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

  const isNewCustomStatus = sourceSelect === CUSTOM_MOVEMENT_SOURCE_VALUE;
  const isSavedCustomStatus = isSavedCustomStatusSelect(sourceSelect);
  const isCustomPool = isNewCustomStatus || isSavedCustomStatus;
  const activeCustomLabel = isSavedCustomStatus
    ? labelFromCustomStatusSelect(sourceSelect)
    : customSourceStatus.trim();
  const sourceStatusLabel =
    SOURCE_OPTIONS.find((opt) => opt.value === sourceStatus)?.label ?? sourceStatus;
  const sourceSelectDisplay = isNewCustomStatus
    ? customSourceStatus.trim() || "+ Add new status"
    : isSavedCustomStatus
      ? activeCustomLabel
      : sourceStatusLabel;

  const includeMachineIds = isEditing && editDraft ? editDraft.machineIds : [];

  const eligibleMachines = useMemo(
    () =>
      isCustomPool
        ? []
        : getEligibleMachines(direction, sourceStatus, site.id, machines, includeMachineIds),
    [direction, sourceStatus, site.id, machines, includeMachineIds, isCustomPool],
  );

  const machineryLines = useMemo(() => buildMachineryLines(eligibleMachines), [eligibleMachines]);

  const selectedLine = useMemo(
    () => machineryLines.find((line) => line.key === selectedLineKey) ?? null,
    [machineryLines, selectedLineKey],
  );

  const maxQuantity = isCustomPool ? 0 : (selectedLine?.availableCount ?? 0);
  const isPending = recordMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    if (editDraft) {
      originalSnapshot.current = editDraft;
      setDirection(editDraft.direction);
      if (editDraft.isCustomSource) {
        const label = editDraft.customSourceLabel.trim();
        const saved = savedCustomStatuses.find((row) => row.label.toLowerCase() === label.toLowerCase());
        if (saved) {
          setSourceSelect(customStatusSelectValue(saved.label));
          setCustomSourceStatus("");
        } else {
          setSourceSelect(CUSTOM_MOVEMENT_SOURCE_VALUE);
          setCustomSourceStatus(label);
        }
        setCustomMachineryName(editDraft.machineryLabel);
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
  }, [open, editDraft, savedCustomStatuses]);

  useEffect(() => {
    if (!open || isEditing || isCustomPool) return;
    const next = direction === "out" ? "assigned" : "available";
    setSourceSelect(next);
    setSourceStatus(next);
  }, [direction, open, isEditing, isCustomPool]);

  useEffect(() => {
    if (!open || isEditing) return;
    if (isCustomPool) {
      setSelectedLineKey("");
      return;
    }
    setSelectedLineKey("");
    setQuantity(1);
  }, [direction, sourceStatus, open, isEditing, isCustomPool]);

  useEffect(() => {
    if (isCustomPool || maxQuantity <= 0) return;
    if (quantity > maxQuantity) {
      setQuantity(maxQuantity);
    }
  }, [maxQuantity, quantity, isCustomPool]);

  const resetAndClose = () => {
    setOpen(false);
    setGatePassNumber("");
    setSelectedLineKey("");
    setCustomSourceStatus("");
    setCustomMachineryName("");
    setQuantity(1);
  };

  const handleSubmit = () => {
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
      <DialogContent className="overflow-visible sm:max-w-lg">
        <DialogHeader>
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

        <div className="space-y-4">
          <MotionField label="Movement direction">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-secondary/40 p-1">
              <button
                type="button"
                onClick={() => setDirection("in")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-all",
                  direction === "in"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ArrowUpFromLine className="h-4 w-4" />
                OUT
              </button>
              <button
                type="button"
                onClick={() => setDirection("out")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-all",
                  direction === "out"
                    ? "bg-amber-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ArrowDownToLine className="h-4 w-4" />
                IN
              </button>
            </div>
          </MotionField>

          <MotionField label="Machinery source / status">
            <Select
              value={sourceSelect}
              onValueChange={(v) => {
                if (v === CUSTOM_MOVEMENT_SOURCE_VALUE) {
                  setSourceSelect(CUSTOM_MOVEMENT_SOURCE_VALUE);
                  setCustomSourceStatus("");
                  setCustomMachineryName("");
                  setSelectedLineKey("");
                  return;
                }
                if (isSavedCustomStatusSelect(v)) {
                  setSourceSelect(v);
                  setCustomSourceStatus("");
                  setCustomMachineryName("");
                  setSelectedLineKey("");
                  return;
                }
                const next = v as MachineryStatus;
                setSourceSelect(next);
                setSourceStatus(next);
                setCustomSourceStatus("");
                setCustomMachineryName("");
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
                {savedCustomStatuses.map((row) => (
                  <SelectItem key={row.id} value={customStatusSelectValue(row.label)}>
                    {row.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_MOVEMENT_SOURCE_VALUE}>+ Add new status</SelectItem>
              </SelectContent>
            </Select>
            {isNewCustomStatus ? (
              <Input
                placeholder="e.g. On rent, Subcontractor pool"
                value={customSourceStatus}
                onChange={(e) => setCustomSourceStatus(e.target.value)}
                maxLength={80}
              />
            ) : null}
            <p className="text-xs text-muted-foreground">
              {isCustomPool
                ? "Custom pool — saved for your company and reusable in this list."
                : direction === "out"
                  ? "Pool these units are leaving from at this site."
                  : "Pool these units are arriving from (company pool or another site)."}
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

          {isCustomPool ? (
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
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isPending ||
              (isCustomPool
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
