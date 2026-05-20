import { useMemo, useState } from "react";
import type { LedgerEntry } from "@/domain/types";
import { useScopedLedger, useScopedSites, useScopedMachines } from "@/hooks/useCompanyScope";
import { format, isValid, parseISO } from "date-fns";
import {
  CalendarDays,
  ClipboardList,
  Download,
  Factory,
  Layers,
  MapPin,
  Search,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/lib/session";
import { isViewerRole } from "@/lib/rbac";

const EVENT_LABELS: Record<string, string> = {
  request_approved: "Request approved",
  request_rejected: "Request rejected",
  request_created: "Request created",
  site_created: "Site created",
  site_created_bulk_upload: "Site created (bulk)",
  site_updated: "Site updated",
  site_marked_completed: "Site completed",
  site_deleted: "Site deleted",
  machinery_created: "Machinery added",
  machinery_status_changed: "Status changed",
  machinery_relocated: "Transferred / reassigned",
  machinery_moved_in: "Machinery IN",
  machinery_moved_out: "Machinery OUT",
  machinery_site_closure: "Site closure",
  machinery_field_updated: "Machinery updated",
  machinery_deleted: "Machinery removed",
  bulk_upload_completed: "Bulk import complete",
  user_role_changed: "User / role change",
  user_invited: "User invited",
  invite_cancelled: "Invite cancelled",
};

function labelForEvent(kind: string): string {
  return EVENT_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function eventIcon(kind: string) {
  if (kind.includes("request")) return ClipboardList;
  if (kind.includes("site_deleted")) return Trash2;
  if (kind.includes("site")) return Factory;
  if (kind.includes("deleted")) return Trash2;
  if (kind.includes("relocat") || kind.includes("transfer")) return MapPin;
  if (kind.includes("status")) return Wrench;
  if (kind.includes("bulk")) return Layers;
  if (kind.includes("user") || kind.includes("invite")) return User;
  if (kind.includes("machinery") || kind.includes("created")) return Layers;
  return Layers;
}

function eventBadgeVariant(kind: string): "default" | "secondary" | "destructive" | "outline" {
  if (kind === "request_rejected" || kind === "machinery_deleted" || kind === "site_deleted" || kind === "invite_cancelled")
    return "destructive";
  if (kind === "request_approved" || kind === "bulk_upload_completed") return "default";
  if (kind === "machinery_relocated" || kind === "machinery_status_changed" || kind === "site_marked_completed") return "secondary";
  return "outline";
}

function legacyDescription(entry: LedgerEntry, siteName: string, equipmentLabel: string): string {
  if (entry.summary?.trim()) return entry.summary.trim();
  return `${entry.totalUnits} unit(s) · ${siteName || "deployment"} · ${equipmentLabel || "see codes"}`;
}

function buildHaystack(entry: LedgerEntry, siteName: string, siteLoc: string, equipmentBits: string[]): string {
  const period =
    entry.fromDate && entry.untilDate && isValid(parseISO(entry.fromDate)) && isValid(parseISO(entry.untilDate))
      ? `${entry.fromDate} ${entry.untilDate}`
      : "";
  return [
    entry.eventKind,
    labelForEvent(entry.eventKind),
    entry.summary ?? "",
    entry.requestId ?? "",
    entry.siteId ?? "",
    siteName,
    siteLoc,
    entry.requester,
    entry.approvedBy,
    entry.approverRole ?? "",
    period,
    format(new Date(entry.approvedAt), "yyyy-MM-dd HH:mm"),
    String(entry.totalUnits),
    ...equipmentBits,
  ]
    .join(" ")
    .toLowerCase();
}

const Ledger = () => {
  const user = useCurrentUser();
  const ledgerScope = useScopedLedger();
  const sites = useScopedSites();
  const machines = useScopedMachines();
  const [query, setQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [untilDate, setUntilDate] = useState("");

  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);

  const filteredLedger = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const until = untilDate ? new Date(`${untilDate}T23:59:59`).getTime() : null;

    return ledgerScope.filter((entry) => {
      const approvedAt = new Date(entry.approvedAt).getTime();
      if (from !== null && approvedAt < from) return false;
      if (until !== null && approvedAt > until) return false;

      if (!normalizedQuery) return true;

      const site = entry.siteId ? siteById.get(entry.siteId) : undefined;
      const siteName = site?.name ?? "";
      const siteLoc = site?.location ?? "";

      const ms = entry.machineIds.map((id) => machineById.get(id)).filter(Boolean);
      const equipmentBits = ms.flatMap((m) =>
        m ? [m.code, m.name, m.category, m.projectName ?? "", m.projectLocation ?? "", m.assignedTo ?? "", m.approvedBy ?? ""] : [],
      );

      const haystack =
        `${buildHaystack(entry, siteName, siteLoc, equipmentBits)} ${entry.machineIds.join(" ")}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [ledgerScope, query, fromDate, untilDate, siteById, machineById]);

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, LedgerEntry[]>();
    filteredLedger.forEach((entry) => {
      const day = format(new Date(entry.approvedAt), "yyyy-MM-dd");
      const list = groups.get(day) ?? [];
      list.push(entry);
      groups.set(day, list);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => (a > b ? -1 : 1))
      .map(([day, entries]) => [
        day,
        [...entries].sort((x, y) => new Date(y.approvedAt).getTime() - new Date(x.approvedAt).getTime()),
      ] as const);
  }, [filteredLedger]);

  const resetFilters = () => {
    setQuery("");
    setFromDate("");
    setUntilDate("");
  };

  const exportExcelReport = () => {
    const rows = filteredLedger.map((entry) => {
      const site = entry.siteId ? siteById.get(entry.siteId) : undefined;
      const equipmentCodes = entry.machineIds
        .map((id) => machineById.get(id)?.code)
        .filter(Boolean)
        .join(", ");
      return {
        when: format(new Date(entry.approvedAt), "dd MMM yyyy HH:mm"),
        type: entry.eventKind,
        title: legacyDescription(entry, site?.name ?? "", equipmentCodes),
        site: site ? `${site.name} (${site.location})` : "—",
        requester: entry.requester || "—",
        approvedBy: entry.approvedBy || "—",
        approverRole: entry.approverRole ?? "",
        requestId: entry.requestId ?? "",
        period:
          entry.fromDate && entry.untilDate ? `${entry.fromDate} → ${entry.untilDate}` : "",
        equipment: equipmentCodes,
        units: entry.totalUnits,
      };
    });

    const header = ["When", "Type", "Summary", "Site", "Requester", "Recorded by", "Role", "Request ID", "Period", "Equipment codes", "Units"];
    const csvRows = [
      header.join(","),
      ...rows.map((row) =>
        [
          row.when,
          row.type,
          row.title,
          row.site,
          row.requester,
          row.approvedBy,
          row.approverRole,
          row.requestId,
          row.period,
          row.equipment,
          String(row.units),
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const csvContent = csvRows.join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-ledger-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">Operational activity log</p>
        <p className="mt-2">
          Entries are recorded in Supabase (<span className="font-mono text-xs">audit_ledger</span>) for approvals, requests,
          machinery and site changes, bulk imports, and team invitations. The feed refreshes periodically while this page is open.
        </p>
      </section>

      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-lg font-semibold text-foreground sm:text-xl">Operational audit log</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search by site, machinery code or name, people, roles, activity text, or anything in the summary — optionally narrow by date.
            {!isViewerRole(user.role) && " Export matches to CSV anytime."}
          </p>
        </div>
        {!isViewerRole(user.role) && (
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={exportExcelReport}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="flex flex-wrap items-end gap-3 sm:flex-nowrap">
          <div className="min-w-0 flex-1 basis-[min(100%,20rem)]">
            <label htmlFor="ledger-search" className="mb-1 block text-xs font-medium text-muted-foreground">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                id="ledger-search"
                className="h-10 w-full rounded-md border border-border bg-background py-0 pl-9 pr-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                placeholder="Sites, machinery, people, roles, activity type, codes, summaries…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search ledger — sites, machinery, people, roles, and more"
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-1">
            <label htmlFor="ledger-from-date" className="text-xs font-medium text-muted-foreground">
              From
            </label>
            <input
              id="ledger-from-date"
              type="date"
              className="h-10 w-[10rem] rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 sm:w-[9.75rem]"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              aria-label="From date"
            />
          </div>

          <div className="flex shrink-0 flex-col gap-1">
            <label htmlFor="ledger-to-date" className="text-xs font-medium text-muted-foreground">
              To
            </label>
            <input
              id="ledger-to-date"
              type="date"
              className="h-10 w-[10rem] rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring/30 sm:w-[9.75rem]"
              value={untilDate}
              onChange={(e) => setUntilDate(e.target.value)}
              aria-label="To date"
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 shrink-0 whitespace-nowrap px-2 text-muted-foreground hover:text-foreground"
            onClick={resetFilters}
          >
            Clear
          </Button>

          <div
            className="flex shrink-0 flex-col justify-center border-t border-border pt-2 sm:ml-auto sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0"
            aria-live="polite"
          >
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Results</span>
            <span className="tabular-nums text-sm font-semibold text-foreground">
              {filteredLedger.length}
              <span className="font-normal text-muted-foreground"> / {ledgerScope.length}</span>
            </span>
          </div>
        </div>
      </section>

      <div className="space-y-8">
        {groupedByDay.map(([day, entries]) => {
          const parsed = parseISO(day);
          const heading = isValid(parsed) ? format(parsed, "EEEE · dd MMM yyyy") : day;
          return (
            <section key={day} aria-labelledby={`ledger-day-${day}`}>
              <div id={`ledger-day-${day}`} className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                {heading}
                <Badge variant="secondary" className="font-normal tabular-nums">
                  {entries.length}
                </Badge>
              </div>
              <ul className="space-y-3">
                {entries.map((entry) => {
                  const site = entry.siteId ? siteById.get(entry.siteId) : undefined;
                  const ms = entry.machineIds.map((id) => machineById.get(id)).filter(Boolean);
                  const equipmentCodes = ms.map((m) => m.code).join(", ");
                  const title = legacyDescription(entry, site?.name ?? "", equipmentCodes);
                  const Icon = eventIcon(entry.eventKind);

                  return (
                    <li
                      key={entry.id}
                      className="rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/25"
                    >
                      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex gap-3">
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={eventBadgeVariant(entry.eventKind)} className="font-normal">
                                {labelForEvent(entry.eventKind)}
                              </Badge>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {format(new Date(entry.approvedAt), "HH:mm")}
                              </span>
                              {entry.requestId ? (
                                <span className="font-mono text-[11px] text-muted-foreground">req {entry.requestId}</span>
                              ) : null}
                            </div>
                            <p className="text-sm font-medium leading-snug text-foreground">{title}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Factory className="h-3.5 w-3.5 shrink-0" />
                                {site ? (
                                  <>
                                    <span className="font-medium text-foreground">{site.name}</span>
                                    <span>·</span>
                                    <span>{site.location}</span>
                                  </>
                                ) : (
                                  <span>Not tied to a single site (company / pool)</span>
                                )}
                              </span>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <User className="h-3.5 w-3.5" />
                                <span>{entry.requester || "—"}</span>
                                <span aria-hidden="true">
                                  ·
                                </span>
                                <span>Recorded by {entry.approvedBy || "—"}</span>
                                {entry.approverRole ? (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{entry.approverRole}</span>
                                  </>
                                ) : null}
                              </span>
                              {entry.fromDate && entry.untilDate ? (
                                <span className="inline-flex items-center gap-1">
                                  <CalendarDays className="h-3.5 w-3.5" />
                                  {format(new Date(`${entry.fromDate}T12:00:00`), "dd MMM")} →{" "}
                                  {format(new Date(`${entry.untilDate}T12:00:00`), "dd MMM yyyy")}
                                </span>
                              ) : null}
                              {entry.totalUnits > 0 ? (
                                <span className="inline-flex items-center gap-1 tabular-nums">
                                  <Layers className="h-3.5 w-3.5" />
                                  {entry.totalUnits} referenced asset{entry.totalUnits !== 1 ? "s" : ""}
                                </span>
                              ) : null}
                            </div>
                            {ms.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {ms.map((m) => (
                                  <span
                                    key={m!.id}
                                    className="inline-flex flex-col rounded-md bg-secondary px-2 py-1 text-[11px] leading-tight text-secondary-foreground"
                                  >
                                    <span className="font-mono text-xs">{m!.code}</span>
                                    <span className="text-muted-foreground">{m!.name}</span>
                                  </span>
                                ))}
                              </div>
                            ) : equipmentCodes ? (
                              <div className="text-[11px] text-muted-foreground">Codes recorded: {equipmentCodes}</div>
                            ) : entry.machineIds.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5 pt-1 text-[11px] text-muted-foreground">
                                Referenced IDs (asset may have been removed):{" "}
                                {entry.machineIds.map((mid) => (
                                  <span key={mid} className="font-mono">{machineById.get(mid)?.code ?? mid.slice(0, 12)}</span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        {filteredLedger.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
            No entries match your search or date range yet. Try different keywords or broader dates.
          </div>
        )}
      </div>
    </div>
  );
};

export default Ledger;
