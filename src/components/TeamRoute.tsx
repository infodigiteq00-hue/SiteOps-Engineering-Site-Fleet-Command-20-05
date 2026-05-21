import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/lib/session";
import { canAccessTeamPage } from "@/lib/rbac";
import Team from "@/pages/Team";

/** Team management is Firm Admin only (Site Managers match Senior Managers elsewhere, not here). */
export function TeamRoute() {
  const user = useCurrentUser();
  if (!canAccessTeamPage(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Team />;
}
