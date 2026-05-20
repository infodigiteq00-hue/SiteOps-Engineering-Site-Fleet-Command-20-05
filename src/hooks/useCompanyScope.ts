import { useMemo } from "react";
import type { Machine } from "@/domain/types";
import { useCurrentUser } from "@/lib/session";
import { useMachineryQuery, useRequestsQuery, useLedgerQuery, useSitesQuery } from "@/hooks/useOperationalData";

/** Sites visible under company tenancy + Site Manager assignments. Super Admin sees all companies. */
export function useScopedSites() {
  const { data: sites = [] } = useSitesQuery();
  const user = useCurrentUser();

  return useMemo(() => {
    let list = sites;
    if (user.role !== "super_admin" && user.companyId) {
      list = sites.filter((s) => s.companyId === user.companyId);
    }
    if (user.role === "site_manager") {
      const allow = new Set(user.assignedSiteIds);
      return list.filter((s) => allow.has(s.id));
    }
    return list;
  }, [sites, user.role, user.companyId, user.assignedSiteIds]);
}

export function useScopedMachines() {
  const { data: machines = [] } = useMachineryQuery();
  const scopedSites = useScopedSites();
  const user = useCurrentUser();

  return useMemo((): Machine[] => {
    if (user.role === "super_admin") return machines;

    const companyScoped = machines.filter((m) => user.companyId && m.companyId === user.companyId);

    if (user.role !== "site_manager") return companyScoped;

    const siteIds = new Set(scopedSites.map((s) => s.id));
    return companyScoped.filter((m) => !m.assignedSiteId || siteIds.has(m.assignedSiteId));
  }, [machines, scopedSites, user.role, user.companyId]);
}

export function useScopedRequests() {
  const { data: requests = [] } = useRequestsQuery();
  const scopedSites = useScopedSites();

  return useMemo(() => {
    const ids = new Set(scopedSites.map((s) => s.id));
    return requests.filter((r) => ids.has(r.siteId));
  }, [requests, scopedSites]);
}

export function useScopedLedger() {
  const { data: ledger = [] } = useLedgerQuery();
  const scopedSites = useScopedSites();
  const user = useCurrentUser();
  return useMemo(() => {
    if (user.role === "super_admin") return ledger;
    const ids = new Set(scopedSites.map((s) => s.id));
    return ledger.filter((row) => {
      if (!row.siteId) return user.role !== "site_manager";
      return ids.has(row.siteId);
    });
  }, [ledger, scopedSites, user.role]);
}
