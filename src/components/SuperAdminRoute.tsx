import { Navigate } from "react-router-dom";
import { useCurrentUser } from "@/lib/session";
import { canAccessPlatformAdmin } from "@/lib/rbac";

export function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  if (!canAccessPlatformAdmin(user.role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
