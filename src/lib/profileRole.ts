import type { PlatformRole } from "@/lib/session";

const ALLOWED: PlatformRole[] = [
  "super_admin",
  "firm_admin",
  "senior_manager",
  "store_manager",
  "site_manager",
  "viewer",
];

export function parsePlatformRole(raw: unknown): PlatformRole {
  if (typeof raw !== "string") return "viewer";
  return ALLOWED.includes(raw as PlatformRole) ? (raw as PlatformRole) : "viewer";
}
