export type MachineryCategory =
  | "Grinding Machine"
  | "Lathe Machine"
  | "Welding Machine"
  | "Hydraulic Press"
  | "CNC Machine"
  | "Compressor Unit"
  | "Industrial Generator";

export type MachineryStatus = "available" | "assigned" | "maintenance" | "lost_damaged";

import type { MachineryUnitType } from "@/lib/machinery-unit-types";
export type { MachineryUnitType } from "@/lib/machinery-unit-types";

export type SiteStatus = "active" | "planning" | "completed" | "on-hold";

/** Machinery disposition snapshot saved when a site is marked finished. */
export type SiteClosureSummary = {
  totalUnits: number;
  available: number;
  maintenance: number;
  relocate: number;
  lost_damaged: number;
  closedAt: string;
  closedBy?: string;
};

export type RequestStatus = "pending" | "approved" | "rejected";

export type RequestSourceType = "available" | "transfer" | "purchase";

export interface Site {
  id: string;
  name: string;
  code: string;
  location: string;
  manager: string;
  status: SiteStatus;
  startDate: string;
  endDate: string;
  companyId: string;
  closureSummary?: SiteClosureSummary | null;
}

export interface Machine {
  id: string;
  code: string;
  name: string;
  category: MachineryCategory;
  /** Quantity unit — nos, metre, kg, etc. */
  unitType: MachineryUnitType;
  status: MachineryStatus;
  assignedSiteId: string | null;
  /** Site where unit was marked lost/damaged (e.g. during site finish). */
  lostFromSiteId: string | null;
  companyId: string;
  projectName?: string;
  projectLocation?: string;
  assignedTo?: string;
  approvedBy?: string;
  closureNotes?: string;
}

export interface Request {
  id: string;
  siteId: string;
  companyId: string;
  machineIds: string[];
  sourceType: RequestSourceType;
  sourceSiteId?: string;
  requestedCategory?: MachineryCategory;
  requestedQuantity?: number;
  requester: string;
  reason: string;
  requestedAt: string;
  neededFrom: string;
  neededUntil: string;
  status: RequestStatus;
  decidedAt?: string;
  decidedBy?: string;
  deciderRole?: string;
  decisionNotes?: string;
}

/** Stored in audit_ledger.event_kind (+ optional bespoke values). */
export type LedgerEventKind =
  | "request_approved"
  | "request_rejected"
  | "request_created"
  | "site_created"
  | "site_created_bulk_upload"
  | "site_updated"
  | "site_marked_completed"
  | "site_deleted"
  | "machinery_created"
  | "machinery_status_changed"
  | "machinery_relocated"
  | "machinery_moved_in"
  | "machinery_moved_out"
  | "machinery_site_closure"
  | "machinery_field_updated"
  | "machinery_deleted"
  | "bulk_upload_completed"
  | "user_role_changed"
  | "user_invited"
  | "invite_cancelled"
  | string;

export interface LedgerEntry {
  id: string;
  companyId: string;
  eventKind: LedgerEventKind;
  /** Human-readable line when present (newer rows); fallback UI builds legacy text when absent. */
  summary?: string;
  /** Present for allocations tied to approved requests; optional for operational events. */
  requestId: string | null;
  /** May be omitted for company-pool machinery events logged without a deployment site. */
  siteId: string | null;
  machineIds: string[];
  requester: string;
  approvedBy: string;
  approverRole?: string;
  approvedAt: string;
  fromDate: string | null;
  untilDate: string | null;
  totalUnits: number;
}

export const MACHINERY_CATEGORIES: MachineryCategory[] = [
  "Grinding Machine",
  "Lathe Machine",
  "Welding Machine",
  "Hydraulic Press",
  "CNC Machine",
  "Compressor Unit",
  "Industrial Generator",
];

export const categoryCodePrefix: Record<MachineryCategory, string> = {
  "Grinding Machine": "GRD",
  "Lathe Machine": "LTH",
  "Welding Machine": "WLD",
  "Hydraulic Press": "HYP",
  "CNC Machine": "CNC",
  "Compressor Unit": "CMP",
  "Industrial Generator": "GEN",
};

export function toCodeChunk(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .join("")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
}
