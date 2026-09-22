import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { OPERATIONAL_LIVE_QUERY } from "@/hooks/useOperationalData";

export const adminKeys = {
  all: ["admin"] as const,
  team: (companyId: string) => [...adminKeys.all, "team", companyId] as const,
};

export type TeamProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  company_id: string | null;
  assigned_site_ids: string[] | null;
};

export type TeamInviteRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  assigned_site_ids: string[] | null;
  status: string;
  created_at: string;
  expires_at: string | null;
};

async function fetchTeamData(companyId: string): Promise<{ profiles: TeamProfileRow[]; invites: TeamInviteRow[] }> {
  const [{ data: profiles, error: pErr }, { data: invites, error: iErr }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, role, company_id, assigned_site_ids")
      .eq("company_id", companyId)
      .order("full_name", { ascending: true }),
    supabase
      .from("company_invites")
      .select("id, email, full_name, role, assigned_site_ids, status, created_at, expires_at")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (iErr) throw new Error(iErr.message);
  return {
    profiles: (profiles as TeamProfileRow[]) ?? [],
    invites: (invites as TeamInviteRow[]) ?? [],
  };
}

export function useTeamDataQuery(companyId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.team(companyId ?? ""),
    queryFn: () => fetchTeamData(companyId!),
    enabled: enabled && Boolean(companyId),
    ...OPERATIONAL_LIVE_QUERY,
  });
}

/** Refetch active admin/team queries immediately (after writes or live updates). */
export function refreshAdminData(qc: ReturnType<typeof useQueryClient>) {
  void qc.refetchQueries({ queryKey: adminKeys.all, type: "active" });
}
