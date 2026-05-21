import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { CreateNewSiteDialog } from "@/components/CreateNewSiteDialog";
import { useOperationalRealtime } from "@/hooks/useOperationalRealtime";
import {
  LayoutDashboard,
  Building2,
  Wrench,
  ClipboardList,
  ScrollText,
  HardHat,
  Layers3,
  Users,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, initialsFromName, useCurrentUser, type PlatformRole } from "@/lib/session";
import { canCreateSite, canAccessTeamPage, canAccessPlatformAdmin } from "@/lib/rbac";
import { useScopedRequests } from "@/hooks/useCompanyScope";
import { useOperationalBootstrap } from "@/hooks/useOperationalData";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseConfigured } from "@/lib/supabaseClient";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

function buildNav(role: PlatformRole): NavItem[] {
  if (role === "super_admin") {
    return [{ to: "/platform", label: "Platform", icon: Shield }];
  }

  const items: NavItem[] = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/sites", label: "Sites", icon: Building2 },
    { to: "/machinery", label: "Machinery List", icon: Wrench },
    { to: "/machinery-overview", label: "Machinery Overview", icon: Layers3 },
  ];
  items.push(
    { to: "/requests", label: "Requests", icon: ClipboardList },
    { to: "/ledger", label: "Audit Ledger", icon: ScrollText },
  );
  if (canAccessTeamPage(role)) {
    items.push({ to: "/team", label: "Team", icon: Users });
  }
  if (canAccessPlatformAdmin(role)) {
    items.push({ to: "/platform", label: "Platform", icon: Shield });
  }
  return items;
}

export const AppShell = () => {
  useOperationalRealtime();
  const { signOut, isSupabaseEnabled } = useAuth();
  const { isBootstrapping, hasError, errorMessage } = useOperationalBootstrap();
  const currentUser = useCurrentUser();
  const location = useLocation();
  const pendingCount = useScopedRequests().filter((r) => r.status === "pending").length;
  if (currentUser.role === "super_admin" && location.pathname !== "/platform") {
    return <Navigate to="/platform" replace />;
  }
  const nav = buildNav(currentUser.role);
  const current = nav.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to) && n.to !== "/"));
  const isDashboard = location.pathname === "/";

  return (
    <div className="flex min-h-screen w-full bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-blue-900/60 bg-gradient-to-b from-blue-950 via-blue-900 to-slate-900 text-blue-50 lg:flex lg:flex-col">
        <div className="flex min-h-16 items-center gap-3 border-b border-blue-800/70 px-6 py-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-xl bg-gradient-hero sm:h-11 sm:w-11">
            <HardHat className="h-[1.125rem] w-[1.125rem] text-white sm:h-6 sm:w-6" aria-hidden strokeWidth={1.75} />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="font-display text-sm font-bold tracking-tight text-white">SiteManager</div>
            <div className="mt-0.5 text-[10px] leading-snug text-blue-200/80">Inventory management platform</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-500/20 text-white ring-1 ring-blue-300/40"
                    : "text-blue-100/80 hover:bg-blue-600/20 hover:text-white"
                )
              }
            >
              <span className="flex items-center gap-3">
                <item.icon className="h-4 w-4" />
                {item.label}
              </span>
              {item.to === "/requests" && pendingCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-foreground">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-blue-800/70 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/25 text-sm font-semibold text-white">
              {initialsFromName(currentUser.name)}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{currentUser.name}</div>
                <div className="truncate text-[11px] text-blue-200/85">{ROLE_LABELS[currentUser.role]}</div>
              </div>
              {isSupabaseConfigured && (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="w-full rounded-md border border-blue-700/80 bg-blue-950/50 px-2 py-1.5 text-[11px] font-medium text-blue-100 transition-colors hover:bg-blue-900/40"
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-card/50 px-6 backdrop-blur">
          <div>
            <h1 className="font-display text-xl font-semibold">{current?.label ?? "Site Detail"}</h1>
          </div>
          <div className="flex items-center gap-2">
            {isDashboard && canCreateSite(currentUser.role) && <CreateNewSiteDialog />}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          {isSupabaseEnabled && isBootstrapping ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
              <p className="text-sm font-medium text-foreground">Loading organization data…</p>
              <p className="max-w-sm text-xs">Sites, machinery, and requests are syncing. This may take a moment on first load.</p>
            </div>
          ) : isSupabaseEnabled && hasError ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
              <p className="text-sm font-medium text-foreground">Could not load data</p>
              <p className="max-w-md text-xs text-muted-foreground">{errorMessage}</p>
              <button
                type="button"
                className="mt-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => window.location.reload()}
              >
                Refresh page
              </button>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
};
