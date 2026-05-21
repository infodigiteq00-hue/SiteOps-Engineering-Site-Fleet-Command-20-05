import { useEffect, useMemo, useState } from "react";
import type { MachineryStatus } from "@/domain/types";
import { differenceInCalendarDays, format } from "date-fns";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddMachineryDialog } from "@/components/AddMachineryDialog";
import { CategoryOverviewCard, type CategorySummary } from "@/components/CategoryOverviewCard";
import { useCurrentUser } from "@/lib/session";
import { canAddMachinery } from "@/lib/rbac";
import { useScopedMachines, useScopedSites, useScopedLedger } from "@/hooks/useCompanyScope";

const MachineryOverview = () => {
  const user = useCurrentUser();
  const machines = useScopedMachines();
  const ledger = useScopedLedger();
  const sites = useScopedSites();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeStatusTab, setActiveStatusTab] = useState<MachineryStatus>("assigned");
  const [query, setQuery] = useState("");

  const siteById = useMemo(() => {
    return new Map(sites.map((site) => [site.id, site]));
  }, [sites]);

  const filteredMachines = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return machines;

    return machines.filter((machine) => {
      const siteName = machine.assignedSiteId ? (siteById.get(machine.assignedSiteId)?.name ?? "") : "";
      return `${machine.name} ${machine.code} ${machine.category} ${siteName}`.toLowerCase().includes(needle);
    });
  }, [machines, query, siteById]);

  const companyTargetsByCategory = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    filteredMachines.forEach((machine) => {
      let byCompany = map.get(machine.category);
      if (!byCompany) {
        byCompany = new Map();
        map.set(machine.category, byCompany);
      }
      byCompany.set(machine.companyId, (byCompany.get(machine.companyId) ?? 0) + 1);
    });
    return map;
  }, [filteredMachines]);

  const categorySummaries = useMemo(() => {
    const grouped = new Map<string, CategorySummary>();

    filteredMachines.forEach((machine) => {
      if (!grouped.has(machine.category)) {
        grouped.set(machine.category, {
          category: machine.category,
          total: 0,
          assigned: 0,
          maintenance: 0,
          available: 0,
        });
      }

      const summary = grouped.get(machine.category)!;
      summary.total += 1;
      summary[machine.status as MachineryStatus] += 1;
    });

    return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
  }, [filteredMachines]);

  const activeCategory = selectedCategory;

  const machineById = useMemo(() => {
    return new Map(machines.map((machine) => [machine.id, machine]));
  }, [machines]);

  const latestLedgerByMachineId = useMemo(() => {
    const sortedLedger = [...ledger].sort((a, b) => new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime());
    const map = new Map<string, (typeof sortedLedger)[number]>();
    sortedLedger.forEach((entry) => {
      entry.machineIds.forEach((machineId) => {
        if (!map.has(machineId)) map.set(machineId, entry);
      });
    });
    return map;
  }, [ledger]);

  useEffect(() => {
    if (selectedCategory) {
      setActiveStatusTab("assigned");
    }
  }, [selectedCategory]);

  const selectedSummary = useMemo(
    () => categorySummaries.find((summary) => summary.category === activeCategory) ?? null,
    [categorySummaries, activeCategory]
  );

  const categoryStatusRows = useMemo(() => {
    if (!activeCategory) return [];

    const needle = query.trim().toLowerCase();

    return filteredMachines
      .filter((machine) => machine.category === activeCategory && machine.status === activeStatusTab)
      .map((machine) => {
        const ledgerEntry = latestLedgerByMachineId.get(machine.id);
        const mappedSite = machine.assignedSiteId ? siteById.get(machine.assignedSiteId) : undefined;
        const ledgerSite = ledgerEntry ? siteById.get(ledgerEntry.siteId) : undefined;
        const site = mappedSite ?? ledgerSite;

        const approvedAt = ledgerEntry?.approvedAt ?? (site ? `${site.startDate}T00:00:00Z` : null);
        const daysOnSite = approvedAt ? Math.max(0, differenceInCalendarDays(new Date(), new Date(approvedAt))) : null;

        return {
          id: machine.id,
          approvedAt,
          siteName: site?.name ?? "—",
          machineCode: machine.code,
          requester: ledgerEntry?.requester ?? (site?.manager ?? "—"),
          approvedBy: ledgerEntry?.approvedBy ?? (site ? "Operations Lead" : "—"),
          daysOnSite,
        };
      })
      .filter((row) => {
        if (!needle) return true;
        return `${row.machineCode} ${row.siteName} ${row.requester} ${row.approvedBy}`
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        if (a.approvedAt && b.approvedAt) return new Date(b.approvedAt).getTime() - new Date(a.approvedAt).getTime();
        if (a.approvedAt) return -1;
        if (b.approvedAt) return 1;
        return a.machineCode.localeCompare(b.machineCode);
      });
  }, [activeCategory, activeStatusTab, filteredMachines, query, latestLedgerByMachineId, siteById]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Category-Wise Machinery Overview</h2>
          <p className="text-sm text-muted-foreground">View total fleet count by machinery category with status split for quick operational planning.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search category, code, site…"
              className="w-56 rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 sm:w-64"
            />
          </div>
          {canAddMachinery(user.role) && <AddMachineryDialog />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {categorySummaries.map((summary) => (
          <CategoryOverviewCard
            key={summary.category}
            summary={summary}
            companyTargets={Array.from(companyTargetsByCategory.get(summary.category)?.entries() ?? []).map(
              ([companyId, count]) => ({ companyId, count }),
            )}
            canManage={canAddMachinery(user.role)}
            onSelect={() => setSelectedCategory(summary.category)}
            onCategoryRenamed={(oldName, newName) => {
              if (selectedCategory === oldName) setSelectedCategory(newName);
            }}
          />
        ))}
        {categorySummaries.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            {query.trim() ? "No machinery matches your search." : "No machinery categories to show."}
          </div>
        )}
      </div>

      <Dialog open={Boolean(selectedCategory)} onOpenChange={(open) => !open && setSelectedCategory(null)}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>{activeCategory} Allocation History</DialogTitle>
            <DialogDescription>
              Ledger view of where this category has been allotted, requested by whom, approved by whom, and current days on site.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2 border-b border-border px-6 py-3">
            {([
              { key: "assigned", label: "Deployed", count: selectedSummary?.assigned ?? 0 },
              { key: "maintenance", label: "Maintenance", count: selectedSummary?.maintenance ?? 0 },
              { key: "available", label: "Available", count: selectedSummary?.available ?? 0 },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveStatusTab(tab.key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeStatusTab === tab.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label} <span className="ml-1 tabular-nums opacity-80">{tab.count}</span>
              </button>
            ))}
          </div>

          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-border bg-secondary/70 text-left text-xs uppercase tracking-wider text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-3 font-medium">Approved</th>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Machinery</th>
                  <th className="px-4 py-3 font-medium">Requested by</th>
                  <th className="px-4 py-3 font-medium">Approved by</th>
                  <th className="px-4 py-3 text-right font-medium">Days on site</th>
                </tr>
              </thead>
              <tbody>
                {categoryStatusRows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 hover:bg-secondary/30">
                    <td className="px-4 py-3 text-muted-foreground">{row.approvedAt ? format(new Date(row.approvedAt), "dd MMM yyyy") : "—"}</td>
                    <td className="px-4 py-3 font-medium">{row.siteName}</td>
                    <td className="px-4 py-3">
                      <div className="max-w-[260px] truncate text-muted-foreground">{row.machineCode}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.requester}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.approvedBy}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.daysOnSite ?? "—"}</td>
                  </tr>
                ))}
                {categoryStatusRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      {query.trim()
                        ? "No records match your search in this status."
                        : "No records found in this status for the selected category."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MachineryOverview;
