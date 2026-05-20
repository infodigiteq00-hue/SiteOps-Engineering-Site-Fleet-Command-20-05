import type { PlatformRole } from "@/lib/session";

export function canCreateSite(role: PlatformRole): boolean {
  return role === "firm_admin" || role === "senior_manager" || role === "super_admin";
}

export function canManageCompanyUsers(role: PlatformRole): boolean {
  return role === "firm_admin";
}

export function canAccessPlatformAdmin(role: PlatformRole): boolean {
  return role === "super_admin";
}

export function canAddMachinery(role: PlatformRole): boolean {
  return (
    role === "firm_admin" ||
    role === "senior_manager" ||
    role === "store_manager" ||
    role === "super_admin"
  );
}

/** Site managers may request machinery; Firm Admin etc. approve instead of submitting as primary flow. */
export function canCreateMachineryRequest(role: PlatformRole): boolean {
  return role === "site_manager";
}

export function canApproveRequests(role: PlatformRole): boolean {
  return (
    role === "firm_admin" ||
    role === "senior_manager" ||
    role === "store_manager" ||
    role === "super_admin"
  );
}

/** Super Admin crosses companies; Site Manager uses assignments; everyone else stays within `userCompanyId`. */
export function canAccessSite(
  role: PlatformRole,
  siteId: string,
  assignedSiteIds: string[],
  siteCompanyId?: string | null,
  userCompanyId?: string | null,
): boolean {
  if (role === "super_admin") return true;
  if (role === "site_manager") return assignedSiteIds.includes(siteId);
  if (!userCompanyId || !siteCompanyId) return true;
  return userCompanyId === siteCompanyId;
}

/** Read-only company member: UI should hide mutations (RLS also blocks writes). */
export function isViewerRole(role: PlatformRole): boolean {
  return role === "viewer";
}

export function canEditMachineryOnSite(role: PlatformRole): boolean {
  return canAddMachinery(role);
}
