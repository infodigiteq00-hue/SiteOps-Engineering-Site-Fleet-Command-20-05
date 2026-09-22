import { useEffect, useMemo, useState } from "react";
import { Building2, Wrench, ClipboardList, CheckCircle2, ArrowRight, Activity, ChevronDown, Package, AlertTriangle } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { SiteDashboardCard } from "@/components/SiteDashboardCard";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useScopedSites, useScopedRequests, useScopedLedger, useScopedMachines } from "@/hooks/useCompanyScope";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { resolveSiteClosureSummary } from "@/lib/site-closure-summary";
import { useCurrentUser } from "@/lib/session";

const Dashboard = () => {
  const sites = useScopedSites();
  const requests = useScopedRequests();
  const ledger = useScopedLedger();
  const machinesInView = useScopedMachines();
  const metrics = useDashboardMetrics();
  const user = useCurrentUser();
  if (user.role === "super_admin") {
    return <Navigate to="/platform" replace />;
  }
  const SITES_PER_PAGE = 6;
  const [sitesPage, setSitesPage] = useState(1);
  const [siteTab, setSiteTab] = useState<"active" | "finished">("active");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showAllRequests, setShowAllRequests] = useState(false);

  const activeSitesList = metrics.activeSitesList;
  const finishedSitesList = metrics.finishedSitesList;
  const sitesForTab = siteTab === "active" ? activeSitesList : finishedSitesList;

  const formatCount = (count: number) => count.toLocaleString("en-IN");

  const statValue = (count: number) => (metrics.isLoading ? "…" : formatCount(count));
  const machineryDeployedValue = metrics.isLoading ? "…" : formatCount(metrics.assigned);
  const machineryDeployedTrend = metrics.isLoading
    ? "…"
    : `of ${formatCount(metrics.totalMachines)} total · ${metrics.utilization.toFixed(1)}% utilization`;
  const totalSitePages = Math.max(1, Math.ceil(sitesForTab.length / SITES_PER_PAGE));
  const firstSiteIndex = (sitesPage - 1) * SITES_PER_PAGE;
  const paginatedSites = sitesForTab.slice(firstSiteIndex, firstSiteIndex + SITES_PER_PAGE);
  const recentRequests = [...requests]
    .filter((request) => request.status === "pending")
    .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());

  useEffect(() => {
    setSitesPage(1);
  }, [siteTab]);

  useEffect(() => {
    setSitesPage((current) => Math.min(current, totalSitePages));
  }, [totalSitePages]);

  return (
    <div className="space-y-7">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Sites"
          value={statValue(metrics.activeSites)}
          icon={Building2}
          trend={`${formatCount(metrics.finishedSites)} finished`}
          accent="blue"
        />
        <StatCard
          label="Machinery Deployed"
          value={machineryDeployedValue}
          icon={Wrench}
          trend={machineryDeployedTrend}
          accent="cyan"
        />
        <StatCard
          label="Total Machinery Available"
          value={statValue(metrics.available)}
          icon={Package}
          trend="Ready to deploy"
          accent="green"
        />
        <StatCard
          label="Total Lost or Damaged"
          value={statValue(metrics.lostDamaged)}
          icon={AlertTriangle}
          trend="Marked lost / damaged"
          accent="orange"
        />
      </div>

      <div className="space-y-6">
        <div>
          <div className="rounded-2xl border border-info/20 bg-gradient-to-b from-info/5 via-card to-card p-4 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 rounded-lg border border-border bg-background/80 p-1">
                <button
                  type="button"
                  onClick={() => setSiteTab("active")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    siteTab === "active"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Active sites
                  <span className="ml-1 text-xs opacity-70">{activeSitesList.length}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSiteTab("finished")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    siteTab === "finished"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Finished sites
                  <span className="ml-1 text-xs opacity-70">{finishedSitesList.length}</span>
                </button>
              </div>
              <Link to="/sites" className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                View all <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {paginatedSites.length === 0 ? (
                <div className="col-span-full rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
                  {siteTab === "active"
                    ? "No active sites right now."
                    : "No finished sites yet. When you mark a site finished, it will appear here."}
                </div>
              ) : null}
              {paginatedSites.map((site) => {
                const count = machinesInView.filter((m) => m.assignedSiteId === site.id).length;
                const deployment = machinesInView.length ? Math.round((count / machinesInView.length) * 100) : 0;
                const closureSummary = resolveSiteClosureSummary(site, ledger);
                return (
                  <SiteDashboardCard
                    key={site.id}
                    site={site}
                    machineryCount={count}
                    deploymentPercent={deployment}
                    closureSummary={closureSummary}
                  />
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/80 px-3 py-2">
              <div className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{firstSiteIndex + 1}</span>-
                <span className="font-semibold text-foreground">
                  {Math.min(firstSiteIndex + SITES_PER_PAGE, sitesForTab.length)}
                </span>{" "}
                of <span className="font-semibold text-foreground">{sitesForTab.length}</span>{" "}
                {siteTab === "active" ? "active" : "finished"} sites
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSitesPage((current) => Math.max(1, current - 1))}
                  disabled={sitesPage === 1}
                >
                  Previous
                </Button>
                <span className="min-w-16 text-center text-xs font-medium tabular-nums">
                  {sitesPage} / {totalSitePages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSitesPage((current) => Math.min(totalSitePages, current + 1))}
                  disabled={sitesPage === totalSitePages}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-success/20 bg-gradient-to-b from-success/5 via-card to-card p-4 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Recent Activity</h2>
              <Link to="/ledger" className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                Ledger <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className={`${showAllActivity ? "max-h-[20rem]" : "max-h-[12.5rem]"} space-y-2 overflow-y-auto pr-1`}>
              {ledger.map((entry) => {
                const site = entry.siteId ? sites.find((s) => s.id === entry.siteId) : undefined;
                const sum = entry.summary?.trim();
                const line = sum
                  ? sum.slice(0, 140) + (sum.length > 140 ? "…" : "")
                  : `${entry.totalUnits} unit${entry.totalUnits !== 1 ? "s" : ""}${site?.name ? ` · ${site.name}` : ""}`;
                return (
                  <div key={entry.id} className="group relative rounded-xl border border-border/80 bg-card/90 p-3 pl-4 transition-all hover:border-success/35 hover:shadow-card">
                    <div className="absolute bottom-3 left-1.5 top-3 w-px bg-success/20" />
                    <div className="relative flex items-start gap-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium leading-snug">{line}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {entry.requester || entry.approvedBy || "System"} ·{" "}
                          {formatDistanceToNow(new Date(entry.approvedAt), { addSuffix: true })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {ledger.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">No activity yet</div>
              )}
            </div>
            {ledger.length > 3 && (
              <div className="mt-3 flex justify-center border-t border-border/80 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAllActivity((value) => !value)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all hover:border-success/35 hover:text-foreground"
                  aria-label={showAllActivity ? "Show less activity" : "Show more activity"}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAllActivity ? "rotate-180" : ""}`} />
                </button>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-border/80 pt-3 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5 text-success" />
              <span>Live approvals sync automatically</span>
            </div>
          </div>

          <div className="rounded-2xl border border-info/20 bg-gradient-to-b from-info/5 via-card to-card p-4 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">Recent Requests</h2>
              <Link to="/requests" className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                Requests <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className={`${showAllRequests ? "max-h-[20rem]" : "max-h-[12.5rem]"} space-y-2 overflow-y-auto pr-1`}>
              {recentRequests.map((request) => {
                const site = sites.find((s) => s.id === request.siteId);
                const unitCount = request.sourceType === "purchase" ? request.requestedQuantity ?? 0 : request.machineIds.length;
                return (
                  <div key={request.id} className="rounded-xl border border-border/80 bg-card/90 p-3 transition-all hover:border-info/30 hover:shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm">
                          <span className="font-semibold">{unitCount} unit{unitCount > 1 ? "s" : ""}</span>{" "}
                          <span className="text-muted-foreground">for</span>{" "}
                          <span className="font-medium">{site?.name}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {request.requester} · {formatDistanceToNow(new Date(request.requestedAt), { addSuffix: true })}
                        </div>
                      </div>
                      <StatusBadge status={request.status} />
                    </div>
                  </div>
                );
              })}
              {recentRequests.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground">No requests yet</div>
              )}
            </div>
            {recentRequests.length > 3 && (
              <div className="mt-3 flex justify-center border-t border-border/80 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAllRequests((value) => !value)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all hover:border-info/35 hover:text-foreground"
                  aria-label={showAllRequests ? "Show fewer requests" : "Show more requests"}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAllRequests ? "rotate-180" : ""}`} />
                </button>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-border/80 pt-3 text-xs text-muted-foreground">
              <ClipboardList className="h-3.5 w-3.5 text-info" />
              <span>Latest request pipeline snapshot</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
