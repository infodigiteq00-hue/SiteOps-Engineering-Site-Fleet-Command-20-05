import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { operationalKeys } from "@/hooks/useOperationalData";

const WATCHED_TABLES = ["sites", "machinery", "machinery_requests", "audit_ledger"] as const;
const INVALIDATE_DEBOUNCE_MS = 800;

/** Invalidate operational queries when Supabase tables change (live dashboard counts). */
export function useOperationalRealtime() {
  const qc = useQueryClient();
  const { isSupabaseEnabled, session } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled || !session) return;

    const scheduleInvalidate = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: operationalKeys.all });
      }, INVALIDATE_DEBOUNCE_MS);
    };

    const channel = supabase.channel(`operational-live-${session.user.id}`);
    WATCHED_TABLES.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, scheduleInvalidate);
    });
    channel.subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [isSupabaseEnabled, session, qc]);
}
