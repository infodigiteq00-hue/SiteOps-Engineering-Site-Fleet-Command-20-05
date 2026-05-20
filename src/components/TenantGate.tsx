import { Outlet } from "react-router-dom";
import { Shield, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUser, type PlatformRole } from "@/lib/session";
import { Button } from "@/components/ui/button";

function requiresCompanyAssignment(role: PlatformRole): boolean {
  return role !== "super_admin";
}

export function TenantGate() {
  const { isSupabaseEnabled, signOut } = useAuth();
  const user = useCurrentUser();

  if (!isSupabaseEnabled) {
    return <Outlet />;
  }

  if (requiresCompanyAssignment(user.role) && !user.companyId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center">
        <Building2 className="h-14 w-14 text-muted-foreground" aria-hidden />
        <div className="max-w-md space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Company not assigned yet</h1>
          <p className="text-sm text-muted-foreground">
            Your login is active, but a Super Admin must attach your account to a company before you can access organisation data.


          </p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => void signOut()}>
          Sign out
        </Button>
        <div className="flex max-w-md items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            First-time setup: create a Super Admin in Supabase (set <strong>profiles.role</strong> to <strong>super_admin</strong>),
            seed companies via migration, then use Platform to assign Firm Admins to companies and invite teammates.
          </span>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
