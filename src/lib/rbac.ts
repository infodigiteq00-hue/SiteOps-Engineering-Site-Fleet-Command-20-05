import type { PlatformRole } from "@/lib/session";

export function canCreateSite(role: PlatformRole): boolean {
  return role === "firm_admin" || role === "senior_manager" || role === "site_manager" || role === "super_admin";
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
    role === "site_manager" ||
    role === "super_admin"
  );
}

/** Legacy request-submit flow (viewer / other roles only). Site managers use senior-style approve + add machinery. */
export function canCreateMachineryRequest(role: PlatformRole): boolean {
  return false;
}

export function canApproveRequests(role: PlatformRole): boolean {
  return (
    role === "firm_admin" ||
    role === "senior_manager" ||
    role === "store_manager" ||
    role === "site_manager" ||
    role === "super_admin"
  );
}

/** Site card edit actions (name, managers, finish workflow) — same as senior manager. */
export function canUpdateSite(role: PlatformRole): boolean {
  return (
    role === "super_admin" ||
    role === "firm_admin" ||
    role === "senior_manager" ||
    role === "site_manager"
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
