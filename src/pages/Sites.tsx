import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { MapPin, Search, User } from "lucide-react";
import { useScopedSites, useScopedMachines, useScopedLedger } from "@/hooks/useCompanyScope";
import { closureReturnedPercent, resolveSiteClosureSummary } from "@/lib/site-closure-summary";

type SiteTab = "active" | "finished";

const Sites = () => {
  const machines = useScopedMachines();
  const sites = useScopedSites();
  const ledger = useScopedLedger();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SiteTab>("active");

  const activeSites = useMemo(() => sites.filter((s) => s.status !== "completed"), [sites]);
  const finishedSites = useMemo(() => sites.filter((s) => s.status === "completed"), [sites]);
  const sitesForTab = tab === "active" ? activeSites : finishedSites;

  const filteredSites = useMemo(
    () => sitesForTab.filter((site) => site.name.toLowerCase().includes(query.trim().toLowerCase())),
    [sitesForTab, query],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {tab === "active"
            ? "Sites currently in operation. Click a row for machinery details."
            : "Sites marked finished. Machinery has been processed through site closure."}
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search site name..."
            className="w-56 rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-card w-fit">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "active" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Active sites
          <span className="ml-1 text-xs opacity-70">{activeSites.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("finished")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "finished" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Finished sites
          <span className="ml-1 text-xs opacity-70">{finishedSites.length}</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Site</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Manager</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">
                {tab === "finished" ? "Units at closure" : "Machinery"}
              </th>
              <th className="px-4 py-3 font-medium">
                {tab === "finished" ? "Returned to pool" : "Percentage Deployment"}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredSites.map((site) => {
              const count = machines.filter((m) => m.assignedSiteId === site.id).length;
              const deployment = machines.length ? Math.round((count / machines.length) * 100) : 0;
              const closureSummary = resolveSiteClosureSummary(site, ledger);
              const displayCount =
                tab === "finished" && closureSummary ? closureSummary.totalUnits : count;
              const displayPct =
                tab === "finished" && closureSummary
                  ? closureReturnedPercent(closureSummary)
                  : deployment;
              return (
                <tr key={site.id} className="border-b border-border last:border-0 transition-colors hover:bg-secondary/30">
                  <td className="px-4 py-3">
                    <Link to={`/sites/${site.id}`} className="block">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{site.code}</div>
                      <div className="font-display font-semibold hover:text-accent">{site.name}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      {site.location}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <User className="h-3 w-3" />
                      {site.manager}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={site.status} />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{displayCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full bg-gradient-accent" style={{ width: `${displayPct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-muted-foreground">{displayPct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredSites.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {query.trim()
                    ? "No sites match your search."
                    : tab === "active"
                      ? "No active sites."
                      : "No finished sites yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Sites;
