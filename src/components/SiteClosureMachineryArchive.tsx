import { useMemo } from "react";
import { Archive } from "lucide-react";
import type { LedgerEntry, Machine } from "@/domain/types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StatusBadge } from "@/components/StatusBadge";
import {
  buildSiteClosureArchive,
  groupClosureArchiveByCategory,
  summarizeClosureArchiveCategory,
} from "@/lib/site-closure-archive";
import type { SiteClosureAction } from "@/lib/site-closure";

type Props = {
  siteId: string;
  ledger: LedgerEntry[];
  machines: Machine[];
};

const CLOSURE_BADGE_STATUS: Record<SiteClosureAction, "available" | "maintenance" | "assigned" | "lost_damaged"> = {
  available: "available",
  maintenance: "maintenance",
  relocate: "assigned",
  lost_damaged: "lost_damaged",
};

export function SiteClosureMachineryArchive({ siteId, ledger, machines }: Props) {
  const archive = useMemo(
    () => buildSiteClosureArchive(siteId, ledger, machines),
    [siteId, ledger, machines],
  );
  const groups = useMemo(() => groupClosureArchiveByCategory(archive), [archive]);

  if (archive.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        <Archive className="mx-auto mb-2 h-6 w-6 opacity-40" />
        No machinery closure records found for this site.
      </div>
    );
  }

  return (
    <Accordion type="single" collapsible className="space-y-3">
      {groups.map(({ category, rows }) => (
        <AccordionItem
          key={category}
          value={category}
          className="overflow-hidden rounded-xl border border-border bg-card px-0 shadow-card"
        >
          <AccordionTrigger className="px-4 py-4 hover:no-underline">
            <div className="flex w-full items-center justify-between gap-4 pr-3 text-left">
              <div>
                <div className="font-display text-4xl font-bold leading-none tabular-nums">{rows.length}</div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  At closure
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-display text-lg font-semibold">{category}</div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {summarizeClosureArchiveCategory(rows)}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="border-t border-border px-4 pt-3">
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium">Outcome at finish</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.machineId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.code}</td>
                      <td className="px-3 py-2 font-medium">{row.name}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-xs text-muted-foreground">{row.closureLabel}</span>
                        <div className="mt-1 flex justify-end">
                          <StatusBadge status={CLOSURE_BADGE_STATUS[row.closureAction]} />
                        </div>
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
  );
}
