import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Requires configured Supabase env and an authenticated session; otherwise `/login`.
 */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isSupabaseEnabled, session, authReady } = useAuth();
  const location = useLocation();

  if (!authReady)
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Loading…</div>;
  if (!isSupabaseEnabled) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return children;
}
