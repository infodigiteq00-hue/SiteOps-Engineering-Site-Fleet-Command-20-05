import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import {
  operationalSlicesForTable,
  refreshOperationalSlices,
  type OperationalSlice,
} from "@/hooks/useOperationalData";
import { refreshAdminData } from "@/hooks/useAdminData";

const WATCHED_TABLES = [
  "sites",
  "machinery",
  "machinery_requests",
  "audit_ledger",
  "profiles",
  "companies",
  "company_invites",
  "company_machinery_source_statuses",
] as const;
const INVALIDATE_DEBOUNCE_MS = 400;

const ADMIN_TABLES = new Set(["profiles", "company_invites"]);

/** Refetch only the slices that changed, not the whole operational database. */
export function useOperationalRealtime() {
  const qc = useQueryClient();
  const { isSupabaseEnabled, session } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ admin: boolean; slices: Set<OperationalSlice> }>({
    admin: false,
    slices: new Set(),
  });

  useEffect(() => {
    if (!isSupabaseEnabled || !session) return;

    const scheduleRefresh = (table: string) => {
      if (ADMIN_TABLES.has(table)) pendingRef.current.admin = true;
      for (const slice of operationalSlicesForTable(table)) {
        pendingRef.current.slices.add(slice);
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const { admin, slices } = pendingRef.current;
        pendingRef.current = { admin: false, slices: new Set() };
        if (slices.size > 0) refreshOperationalSlices(qc, ...slices);
        if (admin) refreshAdminData(qc);
      }, INVALIDATE_DEBOUNCE_MS);
    };

    const channel = supabase.channel(`operational-live-${session.user.id}`);
    WATCHED_TABLES.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => scheduleRefresh(table));
    });
    channel.subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [isSupabaseEnabled, session, qc]);
}
