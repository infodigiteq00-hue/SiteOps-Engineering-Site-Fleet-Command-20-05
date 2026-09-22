import { useMemo } from "react";
import { format, isValid, parseISO } from "date-fns";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Pencil } from "lucide-react";
import type { LedgerEntry, Machine } from "@/domain/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  classifySiteHistoryEntry,
  isMovementEntry,
  isSiteClosureHistoryEntry,
  movementDateIso,
  parseGatePassFromSummary,
  parseUnitTypeFromSummary,
  resolveMachineryDetails,
  sortSiteHistoryEntries,
  type SiteHistoryRowType,
} from "@/lib/site-allocation-history";
import { formatQtyWithUnit } from "@/lib/machinery-unit-types";

type HistoryRowKind = SiteHistoryRowType | "closure" | "site_completed";

type Props = {
  siteId: string;
  ledger: LedgerEntry[];
  machines: Machine[];
  allowEdit?: boolean;
  onEditEntry?: (entry: LedgerEntry) => void;
  /** Include site-finish / closure ledger rows (for finished-site audit). */
  includeClosureEvents?: boolean;
};

function formatHistoryDate(iso: string): string {
  const parsed = parseISO(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (!isValid(parsed)) return "—";
  return format(parsed, "dd MMM yyyy");
}

function typeBadge(type: SiteHistoryRowType) {
  if (type === "in") {
    return (
      <Badge className="gap-1 border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
        <ArrowDownToLine className="h-3 w-3" />
        IN
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 border-amber-200 bg-amber-100 text-amber-900 hover:bg-amber-100">
      <ArrowUpFromLine className="h-3 w-3" />
      OUT
    </Badge>
  );
}

function rowClassName(type: HistoryRowKind): string {
  if (type === "in") {
    return "border-l-4 border-l-emerald-500 bg-emerald-50/70 hover:bg-emerald-50";
  }
  if (type === "out") {
    return "border-l-4 border-l-amber-500 bg-amber-50/70 hover:bg-amber-50";
  }
  if (type === "site_completed") {
    return "border-l-4 border-l-primary bg-primary/5 hover:bg-primary/10";
  }
  return "border-l-4 border-l-muted-foreground/40 bg-secondary/40 hover:bg-secondary/60";
}

function classifyHistoryRow(entry: LedgerEntry): HistoryRowKind {
  if (entry.eventKind === "site_marked_completed") return "site_completed";
  if (entry.eventKind === "machinery_site_closure") return "closure";
  return classifySiteHistoryEntry(entry);
}

function historyTypeBadge(type: HistoryRowKind) {
  if (type === "closure") {
    return (
      <Badge className="gap-1 border-border bg-secondary text-foreground hover:bg-secondary">
        <CheckCircle2 className="h-3 w-3" />
        Closure
      </Badge>
    );
  }
  if (type === "site_completed") {
    return (
      <Badge className="gap-1 border-primary/30 bg-primary/10 text-primary hover:bg-primary/10">
        <CheckCircle2 className="h-3 w-3" />
        Finished
      </Badge>
    );
  }
  return typeBadge(type);
}

export function SiteAllocationHistory({
  siteId,
  ledger,
  machines,
  allowEdit = false,
  onEditEntry,
  includeClosureEvents = false,
}: Props) {
  const entries = useMemo(() => {
    const siteRows = ledger.filter((row) => row.siteId === siteId);
    const filtered = includeClosureEvents
      ? siteRows.filter((row) => isMovementEntry(row) || isSiteClosureHistoryEntry(row))
      : siteRows.filter((row) => isMovementEntry(row));
    return sortSiteHistoryEntries(filtered);
  }, [ledger, siteId, includeClosureEvents]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">
          {includeClosureEvents ? "Site history" : "Allocation History"}
        </h2>
        {entries.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {entries.length} movement record{entries.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Machinery</th>
                <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                <th className="px-4 py-2.5 font-medium">Gate pass</th>
                <th className="px-4 py-2.5 font-medium">Recorded by</th>
                {allowEdit && <th className="px-4 py-2.5 text-right font-medium">Action</th>}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={allowEdit ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    No IN/OUT movements yet. Use Manage Machinery to log entries.
                  </td>
                </tr>
              )}
              {entries.map((entry) => {
                const type = classifyHistoryRow(entry);
                const dateIso = movementDateIso(entry);
                const machinery =
                  type === "closure" || type === "site_completed"
                    ? entry.summary?.trim() || "—"
                    : resolveMachineryDetails(entry, machines);
                const gatePass = parseGatePassFromSummary(entry.summary);
                const qtyUnits = entry.totalUnits || entry.machineIds.length || 0;
                const linkedMachine = machines.find((m) => entry.machineIds.includes(m.id));
                const qtyLabel =
                  qtyUnits > 0
                    ? formatQtyWithUnit(
                        qtyUnits,
                        linkedMachine?.unitType ?? parseUnitTypeFromSummary(entry.summary),
                      )
                    : "—";
                const canEditRow = allowEdit && isMovementEntry(entry);

                return (
                  <tr key={entry.id} className={cn("border-b border-border last:border-0", rowClassName(type))}>
                    <td className="px-4 py-3">{historyTypeBadge(type)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatHistoryDate(dateIso)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium leading-snug">{machinery}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "inline-flex min-w-[2rem] justify-center rounded-md px-2 py-0.5 font-semibold tabular-nums",
                          type === "in" ? "bg-emerald-200/80 text-emerald-900" : "bg-amber-200/80 text-amber-900",
                        )}
                      >
                        {qtyLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {gatePass !== "—" ? (
                        <span className="font-mono text-xs font-medium text-foreground">{gatePass}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.approvedBy || entry.requester || "—"}</td>
                    {allowEdit && (
                      <td className="px-4 py-3 text-right">
                        {canEditRow ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => onEditEntry?.(entry)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
          Machinery IN
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
          Machinery OUT
        </span>
        {includeClosureEvents && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/50" />
              Closure
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
              Site finished
            </span>
          </>
        )}
      </div>
    </div>
  );
}
