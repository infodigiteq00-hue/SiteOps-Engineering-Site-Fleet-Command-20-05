import { useMemo } from "react";
import type { Machine } from "@/domain/types";
import { useCurrentUser } from "@/lib/session";
import { useMachineryQuery, useRequestsQuery, useLedgerQuery, useSitesQuery } from "@/hooks/useOperationalData";

/** Sites visible under company tenancy. Super Admin sees all companies. */
export function useScopedSites() {
  const { data: sites = [] } = useSitesQuery();
  const user = useCurrentUser();

  return useMemo(() => {
    if (user.role === "super_admin") return sites;
    if (user.companyId) return sites.filter((s) => s.companyId === user.companyId);
    return sites;
  }, [sites, user.role, user.companyId]);
}

export function useScopedMachines() {
  const { data: machines = [] } = useMachineryQuery();
  const user = useCurrentUser();

  return useMemo((): Machine[] => {
    if (user.role === "super_admin") return machines;
    if (user.companyId) return machines.filter((m) => m.companyId === user.companyId);
    return machines;
  }, [machines, user.role, user.companyId]);
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
    if (user.companyId) return ledger.filter((row) => row.companyId === user.companyId);
    return ledger;
  }, [ledger, user.role, user.companyId]);
}
