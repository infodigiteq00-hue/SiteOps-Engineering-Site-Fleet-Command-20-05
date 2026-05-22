import { useMemo } from "react";
import { useScopedLedger, useScopedMachines, useScopedRequests, useScopedSites } from "@/hooks/useCompanyScope";
import { useLedgerQuery, useMachineryQuery, useRequestsQuery, useSitesQuery } from "@/hooks/useOperationalData";

/** Dashboard stat cards — counts derived from latest scoped Supabase data. */
export function useDashboardMetrics() {
  const sites = useScopedSites();
  const machines = useScopedMachines();
  const requests = useScopedRequests();
  const ledger = useScopedLedger();

  const sitesQuery = useSitesQuery();
  const machineryQuery = useMachineryQuery();
  const requestsQuery = useRequestsQuery();
  const ledgerQuery = useLedgerQuery();

  const queries = [sitesQuery, machineryQuery, requestsQuery, ledgerQuery];
  const isLoading = queries.some((q) => q.data === undefined && (q.isPending || q.isFetching));

  return useMemo(() => {
    const activeSitesList = sites.filter((site) => site.status !== "completed");
    const finishedSitesList = sites.filter((site) => site.status === "completed");
    const assigned = machines.filter((machine) => machine.status === "assigned").length;
    const available = machines.filter((machine) => machine.status === "available").length;
    const lostDamaged = machines.filter((machine) => machine.status === "lost_damaged").length;
    const totalMachines = machines.length;
    const pending = requests.filter((request) => request.status === "pending").length;

    return {
      isLoading,
      activeSites: activeSitesList.length,
      finishedSites: finishedSitesList.length,
      activeSitesList,
      finishedSitesList,
      assigned,
      available,
      lostDamaged,
      totalMachines,
      pending,
      ledgerEntries: ledger.length,
      utilization: totalMachines > 0 ? (assigned / totalMachines) * 100 : 0,
    };
  }, [sites, machines, requests, ledger, isLoading]);
}
