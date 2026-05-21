import type { PlatformRole } from "@/lib/session";

/** Senior Manager and Site Manager share operational UI powers; Site Manager cannot open Team. */
export function hasSeniorManagerCapabilities(role: PlatformRole): boolean {
  return role === "senior_manager" || role === "site_manager";
}

export function canCreateSite(role: PlatformRole): boolean {
  return role === "firm_admin" || hasSeniorManagerCapabilities(role) || role === "super_admin";
}

/** Firm Admin only — Team tab and user invites. */
export function canManageCompanyUsers(role: PlatformRole): boolean {
  return role === "firm_admin";
}

export function canAccessTeamPage(role: PlatformRole): boolean {
  return canManageCompanyUsers(role);
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

/** Legacy request-submit flow (viewer / other roles only). */
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

/** Site card edit actions (name, managers, finish workflow). */
export function canUpdateSite(role: PlatformRole): boolean {
  return role === "super_admin" || role === "firm_admin" || hasSeniorManagerCapabilities(role);
}

/** Super Admin crosses companies; company roles stay within `userCompanyId`. */
export function canAccessSite(
  role: PlatformRole,
  siteId: string,
  assignedSiteIds: string[],
  siteCompanyId?: string | null,
  userCompanyId?: string | null,
): boolean {
  void siteId;
  void assignedSiteIds;
  if (role === "super_admin") return true;
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
