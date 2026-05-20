import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { operationalKeys } from "@/hooks/useOperationalData";

const WATCHED_TABLES = ["sites", "machinery", "machinery_requests", "audit_ledger"] as const;

/** Invalidate operational queries when Supabase tables change (live dashboard counts). */
export function useOperationalRealtime() {
  const qc = useQueryClient();
  const { isSupabaseEnabled, session } = useAuth();

  useEffect(() => {
    if (!isSupabaseEnabled || !session) return;

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: operationalKeys.all });
    };

    const channel = supabase.channel(`operational-live-${session.user.id}`);
    WATCHED_TABLES.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, invalidate);
    });
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isSupabaseEnabled, session, qc]);
}
