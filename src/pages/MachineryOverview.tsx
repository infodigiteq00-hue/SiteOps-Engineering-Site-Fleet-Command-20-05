import { useMemo, useState } from "react";
import type { MachineryStatus } from "@/domain/types";
import { Search } from "lucide-react";
import { AddMachineryDialog } from "@/components/AddMachineryDialog";
import {
  CategoryOverviewCard,
  type CategoryAssignedSite,
  type CategorySummary,
} from "@/components/CategoryOverviewCard";
import { useCurrentUser } from "@/lib/session";
import { canAddMachinery } from "@/lib/rbac";
import { useScopedMachines, useScopedSites } from "@/hooks/useCompanyScope";
import { machineryStockQuantity } from "@/lib/site-closure";

const MachineryOverview = () => {
  const user = useCurrentUser();
  const machines = useScopedMachines();
  const sites = useScopedSites();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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

  const assignedSitesByCategory = useMemo(() => {
    const map = new Map<string, Map<string, CategoryAssignedSite>>();

    filteredMachines.forEach((machine) => {
      if (!machine.assignedSiteId) return;
      const site = siteById.get(machine.assignedSiteId);
      if (!site) return;

      let bySite = map.get(machine.category);
      if (!bySite) {
        bySite = new Map();
        map.set(machine.category, bySite);
      }
      const existing = bySite.get(site.id);
      if (existing) {
        existing.unitCount += machineryStockQuantity(machine);
      } else {
        bySite.set(site.id, { id: site.id, name: site.name, unitCount: machineryStockQuantity(machine) });
      }
    });

    const result = new Map<string, CategoryAssignedSite[]>();
    map.forEach((bySite, category) => {
      result.set(
        category,
        Array.from(bySite.values()).sort((a, b) => b.unitCount - a.unitCount || a.name.localeCompare(b.name)),
      );
    });
    return result;
  }, [filteredMachines, siteById]);

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

      <div className="flex flex-col gap-3">
        {categorySummaries.map((summary) => (
          <CategoryOverviewCard
            key={summary.category}
            summary={summary}
            companyTargets={Array.from(companyTargetsByCategory.get(summary.category)?.entries() ?? []).map(
              ([companyId, count]) => ({ companyId, count }),
            )}
            assignedSites={assignedSitesByCategory.get(summary.category) ?? []}
            expanded={selectedCategory === summary.category}
            canManage={canAddMachinery(user.role)}
            onSelect={() =>
              setSelectedCategory((current) => (current === summary.category ? null : summary.category))
            }
            onCategoryRenamed={(oldName, newName) => {
              if (selectedCategory === oldName) setSelectedCategory(newName);
            }}
          />
        ))}
        {categorySummaries.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            {query.trim() ? "No machinery matches your search." : "No machinery categories to show."}
          </div>
        )}
      </div>
    </div>
  );
};

export default MachineryOverview;
