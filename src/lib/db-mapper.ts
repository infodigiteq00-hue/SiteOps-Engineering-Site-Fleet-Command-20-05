import type {
  Site,
  Machine,
  Request,
  LedgerEntry,
  SiteStatus,
  SiteClosureSummary,
  MachineryStatus,
  RequestStatus,
  RequestSourceType,
  MachineryCategory,
} from "@/domain/types";
import { normalizeMachineryUnitType } from "@/lib/machinery-unit-types";

export type SiteRow = Record<string, unknown>;
export type MachineryRow = Record<string, unknown>;
export type RequestRow = Record<string, unknown>;
export type LedgerRow = Record<string, unknown>;
export type CompanyRow = { id: string; name: string };

function mapClosureSummary(raw: unknown): SiteClosureSummary | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const totalUnits = Number(o.totalUnits ?? o.total_units ?? 0);
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) return null;
  return {
    totalUnits,
    available: Number(o.available ?? 0),
    maintenance: Number(o.maintenance ?? 0),
    relocate: Number(o.relocate ?? 0),
    lost_damaged: Number(o.lost_damaged ?? 0),
    closedAt: String(o.closedAt ?? o.closed_at ?? ""),
    closedBy: o.closedBy != null ? String(o.closedBy) : o.closed_by != null ? String(o.closed_by) : undefined,
  };
}

export function mapSite(row: SiteRow): Site {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    name: String(row.name),
    code: String(row.code),
    location: String(row.location),
    manager: String(row.manager),
    status: row.status as SiteStatus,
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    closureSummary: mapClosureSummary(row.closure_summary),
  };
}

export function mapMachinery(row: MachineryRow): Machine {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    code: String(row.code),
    name: String(row.name),
    category: String(row.category) as MachineryCategory,
    unitType: normalizeMachineryUnitType(row.unit_type),
    status: row.status as MachineryStatus,
    assignedSiteId: row.assigned_site_id == null ? null : String(row.assigned_site_id),
    lostFromSiteId: row.lost_from_site_id == null ? null : String(row.lost_from_site_id),
    projectName: row.project_name == null ? undefined : String(row.project_name),
    projectLocation: row.project_location == null ? undefined : String(row.project_location),
    assignedTo: row.assigned_to == null ? undefined : String(row.assigned_to),
    approvedBy: row.approved_by == null ? undefined : String(row.approved_by),
    closureNotes: row.closure_notes == null ? undefined : String(row.closure_notes),
  };
}

function parseMachineIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function mapRequest(row: RequestRow): Request {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    siteId: String(row.site_id),
    machineIds: parseMachineIds(row.machine_ids),
    sourceType: row.source_type as RequestSourceType,
    sourceSiteId: row.source_site_id == null ? undefined : String(row.source_site_id),
    requestedCategory: row.requested_category == null ? undefined : (String(row.requested_category) as MachineryCategory),
    requestedQuantity: row.requested_quantity == null ? undefined : Number(row.requested_quantity),
    requester: String(row.requester),
    reason: String(row.reason),
    requestedAt: String(row.requested_at),
    neededFrom: String(row.needed_from),
    neededUntil: String(row.needed_until),
    status: row.status as RequestStatus,
    decidedAt: row.decided_at == null ? undefined : String(row.decided_at),
    decidedBy: row.decided_by == null ? undefined : String(row.decided_by),
    deciderRole: row.decider_role == null ? undefined : String(row.decider_role),
    decisionNotes: row.decision_notes == null ? undefined : String(row.decision_notes),
  };
}

export function mapLedger(row: LedgerRow): LedgerEntry {
  const requestIdRaw = row.request_id;
  const siteIdRaw = row.site_id;
  const summaryRaw = row.summary;
  const eventKindRaw = row.event_kind;

  return {
    id: String(row.id),
    companyId: String(row.company_id),
    eventKind:
      eventKindRaw == null || String(eventKindRaw).trim() === ""
        ? "request_approved"
        : String(eventKindRaw),
    summary: summaryRaw == null || String(summaryRaw).trim() === "" ? undefined : String(summaryRaw),
    requestId: requestIdRaw == null || String(requestIdRaw).trim() === "" ? null : String(requestIdRaw),
    siteId: siteIdRaw == null || String(siteIdRaw).trim() === "" ? null : String(siteIdRaw),
    machineIds: parseMachineIds(row.machine_ids),
    requester: row.requester == null ? "" : String(row.requester),
    approvedBy: row.approved_by == null ? "" : String(row.approved_by),
    approverRole: row.approver_role == null ? undefined : String(row.approver_role),
    approvedAt: String(row.approved_at),
    fromDate: row.from_date == null ? null : String(row.from_date),
    untilDate: row.until_date == null ? null : String(row.until_date),
    totalUnits: Number(row.total_units ?? 0),
  };
}
