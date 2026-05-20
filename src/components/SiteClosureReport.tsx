import { format } from "date-fns";
import type { SiteClosureSummary } from "@/domain/types";
import { cn } from "@/lib/utils";
import {
  CLOSURE_SUMMARY_LABELS,
  closureReturnedPercent,
} from "@/lib/site-closure-summary";

type Props = {
  summary: SiteClosureSummary;
  siteName: string;
  compact?: boolean;
};

const ROW_STYLES: Record<keyof typeof CLOSURE_SUMMARY_LABELS, string> = {
  available: "border-success/25 bg-success/5",
  maintenance: "border-warning/25 bg-warning/5",
  relocate: "border-info/25 bg-info/5",
  lost_damaged: "border-destructive/25 bg-destructive/5",
};

export function SiteClosureReport({ summary, siteName, compact }: Props) {
  const returnedPct = closureReturnedPercent(summary);
  const rows = (
    Object.keys(CLOSURE_SUMMARY_LABELS) as (keyof typeof CLOSURE_SUMMARY_LABELS)[]
  ).filter((key) => summary[key] > 0);

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div className={cn("rounded-xl border border-border bg-card p-4", compact && "p-3")}>
        <p className="text-sm text-muted-foreground">
          When <strong className="text-foreground">{siteName}</strong> was finished,{" "}
          <strong className="text-foreground">{summary.totalUnits}</strong> machinery unit
          {summary.totalUnits === 1 ? "" : "s"} were on site and processed as follows:
        </p>
        {summary.closedAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Closed {format(new Date(summary.closedAt), "d MMM yyyy, h:mm a")}
            {summary.closedBy ? ` · ${summary.closedBy}` : ""}
          </p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((key) => (
          <div
            key={key}
            className={cn("flex items-center justify-between rounded-lg border px-4 py-3", ROW_STYLES[key])}
          >
            <span className="text-sm font-medium">{CLOSURE_SUMMARY_LABELS[key]}</span>
            <span className="font-display text-2xl font-bold tabular-nums">{summary[key]}</span>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-secondary/30 px-4 py-3">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Returned to company pool</span>
          <span className="font-medium tabular-nums text-foreground">{returnedPct}%</span>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-secondary">
          {summary.available > 0 && (
            <div
              className="h-full bg-success"
              style={{ width: `${(summary.available / summary.totalUnits) * 100}%` }}
              title={`${summary.available} available`}
            />
          )}
          {summary.maintenance > 0 && (
            <div
              className="h-full bg-warning"
              style={{ width: `${(summary.maintenance / summary.totalUnits) * 100}%` }}
              title={`${summary.maintenance} maintenance`}
            />
          )}
          {summary.relocate > 0 && (
            <div
              className="h-full bg-info"
              style={{ width: `${(summary.relocate / summary.totalUnits) * 100}%` }}
              title={`${summary.relocate} relocated`}
            />
          )}
          {summary.lost_damaged > 0 && (
            <div
              className="h-full bg-destructive/80"
              style={{ width: `${(summary.lost_damaged / summary.totalUnits) * 100}%` }}
              title={`${summary.lost_damaged} lost/damaged`}
            />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {summary.available > 0 && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> Pool</span>}
          {summary.maintenance > 0 && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> Maintenance</span>}
          {summary.relocate > 0 && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-info" /> Relocated</span>}
          {summary.lost_damaged > 0 && <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-destructive/80" /> Lost / damaged</span>}
        </div>
      </div>
    </div>
  );
}
