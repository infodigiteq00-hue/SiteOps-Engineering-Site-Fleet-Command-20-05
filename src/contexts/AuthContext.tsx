import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { useSession, type SessionUser } from "@/lib/session";
import { parsePlatformRole } from "@/lib/profileRole";

type AuthContextValue = {
  isSupabaseEnabled: boolean;
  session: Session | null;
  authReady: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type ProfileRow = {
  full_name: string | null;
  role: string | null;
  assigned_site_ids: string[] | null;
  company_id: string | null;
};

function mapProfileToSessionUser(userId: string, email: string | undefined, row: ProfileRow | null): SessionUser {
  const name =
    row?.full_name?.trim() ||
    email?.split("@")[0] ||
    "User";
  const role = parsePlatformRole(row?.role);
  const companyId = row?.company_id ?? null;
  const assignedSiteIds = Array.isArray(row?.assigned_site_ids) ? row!.assigned_site_ids! : [];

  return {
    id: userId,
    name,
    role,
    companyId,
    assignedSiteIds,
  };
}

async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from("profiles").select("full_name, role, assigned_site_ids, company_id").eq("id", userId).maybeSingle();
  if (error) {
    console.warn("[auth] profiles fetch:", error.message);
    return null;
  }
  return data as ProfileRow | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const applyAuthenticatedUser = useSession((s) => s.applyAuthenticatedUser);
  const clearSession = useSession((s) => s.clearSession);

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);

  const isSupabaseEnabled = isSupabaseConfigured;

  const applySessionUser = useCallback(
    async (next: Session | null) => {
      if (!next?.user) {
        setSession(null);
        clearSession();
        return;
      }
      const profile = await fetchProfile(next.user.id);
      const sessionUser = mapProfileToSessionUser(next.user.id, next.user.email, profile);
      applyAuthenticatedUser(sessionUser);
      setSession(next);
    },
    [applyAuthenticatedUser, clearSession],
  );

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setAuthReady(true);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await applySessionUser(data.session ?? null);
      setAuthReady(true);
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySessionUser(nextSession);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [isSupabaseEnabled, applySessionUser]);

  const signOut = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    await supabase.auth.signOut();
    clearSession();
  }, [isSupabaseEnabled, clearSession]);

  const value = useMemo(
    () => ({
      isSupabaseEnabled,
      session,
      authReady,
      signOut,
    }),
    [isSupabaseEnabled, session, authReady, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
