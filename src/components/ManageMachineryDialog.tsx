import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronsUpDown, Truck } from "lucide-react";
import { format } from "date-fns";
import type { LedgerEntry, Machine, MachineryStatus, Site } from "@/domain/types";
import { cn } from "@/lib/utils";
import {
  machineryLineKey,
  movementDirectionDisplayLabel,
  parseMovementEditFromLedger,
  type MachineryMovementDirection,
} from "@/lib/site-allocation-history";
import {
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
    const entry = grouped.get(key) ?? { label: `${machine.code} — ${machine.name}`, machineIds: [] };
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
  const [sourceStatus, setSourceStatus] = useState<MachineryStatus>("available");
  const [movementDate, setMovementDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [gatePassNumber, setGatePassNumber] = useState("");
  const [selectedLineKey, setSelectedLineKey] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [machineryPickerOpen, setMachineryPickerOpen] = useState(false);

  const includeMachineIds = isEditing && editDraft ? editDraft.machineIds : [];

  const eligibleMachines = useMemo(
    () => getEligibleMachines(direction, sourceStatus, site.id, machines, includeMachineIds),
    [direction, sourceStatus, site.id, machines, includeMachineIds],
  );

  const machineryLines = useMemo(() => buildMachineryLines(eligibleMachines), [eligibleMachines]);

  const selectedLine = useMemo(
    () => machineryLines.find((line) => line.key === selectedLineKey) ?? null,
    [machineryLines, selectedLineKey],
  );

  const maxQuantity = selectedLine?.availableCount ?? 0;
  const isPending = recordMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (!open) return;
    if (editDraft) {
      originalSnapshot.current = editDraft;
      setDirection(editDraft.direction);
      setSourceStatus(editDraft.sourceStatus);
      setMovementDate(editDraft.movementDate);
      setGatePassNumber(editDraft.gatePassNumber);
      setSelectedLineKey(editDraft.lineKey);
      setQuantity(editDraft.quantity);
      return;
    }
    const defaults = defaultFormState();
    setDirection(defaults.direction);
    setSourceStatus("assigned");
    setMovementDate(defaults.movementDate);
    setGatePassNumber("");
    setSelectedLineKey("");
    setQuantity(1);
  }, [open, editDraft]);

  useEffect(() => {
    if (!open || isEditing) return;
    setSourceStatus(direction === "out" ? "assigned" : "available");
  }, [direction, open, isEditing]);

  useEffect(() => {
    if (!open || isEditing) return;
    setSelectedLineKey("");
    setQuantity(1);
  }, [direction, sourceStatus, open, isEditing]);

  useEffect(() => {
    if (quantity > maxQuantity && maxQuantity > 0) {
      setQuantity(maxQuantity);
    }
  }, [maxQuantity, quantity]);

  const resetAndClose = () => {
    setOpen(false);
    setGatePassNumber("");
    setSelectedLineKey("");
    setQuantity(1);
  };

  const handleSubmit = () => {
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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
            <Select value={sourceStatus} onValueChange={(v) => setSourceStatus(v as MachineryStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {direction === "out"
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

          <MotionField label="Select machinery">
            <Popover open={machineryPickerOpen} onOpenChange={setMachineryPickerOpen}>
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
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search code or name…" />
                  <CommandList>
                    <CommandEmpty>No machinery in this pool.</CommandEmpty>
                    <CommandGroup>
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
                </Command>
              </PopoverContent>
            </Popover>
          </MotionField>

          <MotionField label="Quantity">
            <Input
              type="number"
              min={1}
              max={maxQuantity || 1}
              value={quantity}
              disabled={!selectedLine}
              onChange={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(next)) setQuantity(next);
              }}
            />
            {selectedLine && (
              <p className="text-xs text-muted-foreground">
                {maxQuantity} unit{maxQuantity === 1 ? "" : "s"} available in this pool.
              </p>
            )}
          </MotionField>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedLine || isPending}
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
