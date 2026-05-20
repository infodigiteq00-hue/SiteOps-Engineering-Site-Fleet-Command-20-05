import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { mapSite, mapMachinery, mapRequest, mapLedger, type CompanyRow } from "@/lib/db-mapper";
import type { Site, SiteStatus, MachineryStatus, MachineryCategory, RequestSourceType } from "@/domain/types";
import { buildClosureSummaryFromDispositions } from "@/lib/site-closure-summary";
import type { MachineryMovementDirection } from "@/lib/site-allocation-history";
import { movementEventKindFromDirection } from "@/lib/site-allocation-history";
import type { SiteClosureDisposition } from "@/lib/site-closure";

export type { MachineryMovementDirection } from "@/lib/site-allocation-history";
import { categoryCodePrefix, toCodeChunk } from "@/domain/types";
import { DEFAULT_MACHINERY_UNIT_TYPE, normalizeMachineryUnitType } from "@/lib/machinery-unit-types";
import type { MachineryUnitType } from "@/lib/machinery-unit-types";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAllSupabasePages } from "@/lib/supabase-fetch-all";
import { peekCurrentUser, ROLE_LABELS } from "@/lib/session";

export const operationalKeys = {
  all: ["operational"] as const,
  sites: () => [...operationalKeys.all, "sites"] as const,
  machinery: () => [...operationalKeys.all, "machinery"] as const,
  requests: () => [...operationalKeys.all, "requests"] as const,
  ledger: () => [...operationalKeys.all, "ledger"] as const,
  companies: () => [...operationalKeys.all, "companies"] as const,
};

function queriesEnabled(enabled: boolean) {
  return Boolean(enabled);
}

/** Keep operational lists fresh for dashboard counts and tables. */
export const OPERATIONAL_LIVE_QUERY = {
  staleTime: 0,
  refetchOnWindowFocus: true,
  refetchInterval: 30_000,
} as const;

async function fetchSites(): Promise<Site[]> {
  const rows = await fetchAllSupabasePages((from, to) =>
    supabase.from("sites").select("*").order("name").range(from, to),
  );
  return rows.map(mapSite);
}

async function fetchMachinery() {
  const rows = await fetchAllSupabasePages((from, to) =>
    supabase.from("machinery").select("*").order("code").range(from, to),
  );
  return rows.map(mapMachinery);
}

async function fetchRequests() {
  const rows = await fetchAllSupabasePages((from, to) =>
    supabase.from("machinery_requests").select("*").order("requested_at", { ascending: false }).range(from, to),
  );
  return rows.map(mapRequest);
}

async function fetchLedger() {
  const rows = await fetchAllSupabasePages((from, to) =>
    supabase.from("audit_ledger").select("*").order("approved_at", { ascending: false }).range(from, to),
  );
  return rows.map(mapLedger);
}

async function fetchCompanies(): Promise<CompanyRow[]> {
  const rows = await fetchAllSupabasePages((from, to) =>
    supabase.from("companies").select("id, name").order("name").range(from, to),
  );
  return rows as CompanyRow[];
}

export function useSitesQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.sites(), queryFn: fetchSites, enabled: ok, ...OPERATIONAL_LIVE_QUERY });
}

export function useMachineryQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.machinery(), queryFn: fetchMachinery, enabled: ok, ...OPERATIONAL_LIVE_QUERY });
}

export function useRequestsQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.requests(), queryFn: fetchRequests, enabled: ok, ...OPERATIONAL_LIVE_QUERY });
}

export function useLedgerQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({
    queryKey: operationalKeys.ledger(),
    queryFn: fetchLedger,
    enabled: ok,
    ...OPERATIONAL_LIVE_QUERY,
  });
}

export function useCompaniesQuery() {
  const { isSupabaseEnabled, session } = useAuth();
  const ok = queriesEnabled(isSupabaseEnabled && Boolean(session));
  return useQuery({ queryKey: operationalKeys.companies(), queryFn: fetchCompanies, enabled: ok });
}

/** Resolved company display names from Supabase (empty until loaded). */
export function useCompanyNameMap(): Record<string, string> {
  const { data } = useCompaniesQuery();
  return useMemo(() => Object.fromEntries((data ?? []).map((c) => [c.id, c.name])), [data]);
}

function invalidateOperational(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: operationalKeys.all });
}

export type AppendAuditLedgerInput = {
  companyId: string;
  eventKind: string;
  summary: string;
  siteId?: string | null;
  machineIds?: string[];
  requestId?: string | null;
  requester?: string;
  approvedBy?: string;
  approverRole?: string | null;
  fromDate?: string | null;
  untilDate?: string | null;
  totalUnits?: number;
  approvedAt?: string;
};

/** SECURITY DEFINER RPC (see migrations). Throws on denial / DB errors. Best-effort callers may catch+log. */
export async function appendAuditLedgerEntry(input: AppendAuditLedgerInput): Promise<void> {
  const { error } = await supabase.rpc("append_audit_ledger", {
    p_company_id: input.companyId,
    p_event_kind: input.eventKind,
    p_summary: input.summary,
    p_site_id: input.siteId ?? null,
    p_machine_ids: input.machineIds ?? [],
    p_request_id: input.requestId ?? null,
    p_requester: input.requester ?? "System",
    p_approved_by: input.approvedBy ?? "System",
    p_approver_role: input.approverRole ?? null,
    p_from_date: input.fromDate ?? null,
    p_until_date: input.untilDate ?? null,
    p_total_units: input.totalUnits ?? 0,
    p_approved_at: input.approvedAt ?? new Date().toISOString(),
  });
  if (error) throw error;
}

/** Machinery.id is globally unique (not scoped per company); do not derive m1,m2… from tenant-filtered selects. */
function newMachineryRowId(): string {
  return `m-${crypto.randomUUID().replace(/-/g, "")}`;
}

export type CreateSiteInput = {
  name: string;
  location: string;
  machineIds: string[];
  companyId: string;
  /** When true, ledger uses site_created_bulk_upload for clearer audit trail. */
  createdDuringBulkUpload?: boolean;
};

export function useCreateSiteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSiteInput) => {
      const siteId = `s-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const startDate = new Date().toISOString().slice(0, 10);
      const endDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      let code = toCodeChunk(input.name);
      const { data: clash } = await supabase.from("sites").select("id").eq("company_id", input.companyId).eq("code", code).maybeSingle();
      if (clash?.id) code = `${toCodeChunk(input.name)}-${siteId.slice(-4)}`.slice(0, 24);

      const { error: insErr } = await supabase.from("sites").insert({
        id: siteId,
        company_id: input.companyId,
        name: input.name.trim(),
        code,
        location: input.location.trim(),
        manager: "Operations Lead",
        status: "active",
        start_date: startDate,
        end_date: endDate,
      });
      if (insErr) throw insErr;

      if (input.machineIds.length > 0) {
        const { error: upErr } = await supabase
          .from("machinery")
          .update({ status: "assigned", assigned_site_id: siteId })
          .in("id", input.machineIds);
        if (upErr) throw upErr;
      }

      const actor = peekCurrentUser();
      try {
        const bulk = Boolean(input.createdDuringBulkUpload);
        await appendAuditLedgerEntry({
          companyId: input.companyId,
          eventKind: bulk ? "site_created_bulk_upload" : "site_created",
          summary: bulk
            ? `New site "${input.name.trim()}" was created during bulk upload (${input.location.trim()}).`
            : `Site created: ${input.name.trim()} — ${input.location.trim()}`,
          siteId,
          machineIds: input.machineIds.length ? [...input.machineIds] : [],
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: input.machineIds.length,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after site_created", err);
      }

      return siteId;
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type UpdateSiteInput = {
  siteId: string;
  companyId: string;
  name?: string;
  manager?: string;
  status?: SiteStatus;
};

export function useUpdateSiteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSiteInput) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (input.name !== undefined) patch.name = input.name.trim();
      if (input.manager !== undefined) patch.manager = input.manager.trim();
      if (input.status !== undefined) {
        patch.status = input.status;
        if (input.status === "active") patch.closure_summary = null;
      }
      const { error } = await supabase.from("sites").update(patch).eq("id", input.siteId);
      if (error) throw error;

      const actor = peekCurrentUser();
      const bits: string[] = [];
      if (input.name !== undefined) bits.push(`name → "${input.name.trim()}"`);
      if (input.manager !== undefined) bits.push(`managers → "${input.manager.trim()}"`);
      if (input.status !== undefined) bits.push(`status → ${input.status}`);
      try {
        await appendAuditLedgerEntry({
          companyId: input.companyId,
          eventKind: input.status === "completed" ? "site_marked_completed" : "site_updated",
          summary: `Site updated (${bits.join("; ")}).`,
          siteId: input.siteId,
          machineIds: [],
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: 0,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after site_updated", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useDeleteSiteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { siteId: string; companyId: string; siteName: string }) => {
      const { error } = await supabase.from("sites").delete().eq("id", args.siteId);
      if (error) throw error;
      const actor = peekCurrentUser();
      try {
        await appendAuditLedgerEntry({
          companyId: args.companyId,
          eventKind: "site_deleted",
          summary: `Site deleted: "${args.siteName}" (${args.siteId}).`,
          siteId: null,
          machineIds: [],
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: 0,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after site_deleted", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type CreateRequestInput = {
  siteId: string;
  machineIds: string[];
  sourceType: RequestSourceType;
  sourceSiteId?: string;
  requestedCategory?: MachineryCategory;
  requestedQuantity?: number;
  requester: string;
  reason: string;
  neededFrom: string;
  neededUntil: string;
};

export function useCreateRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (r: CreateRequestInput) => {
      const { data: site, error: siteErr } = await supabase.from("sites").select("company_id").eq("id", r.siteId).single();
      if (siteErr || !site?.company_id) throw new Error(siteErr?.message ?? "Site not found or missing company");
      const id = `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { error } = await supabase.from("machinery_requests").insert({
        id,
        company_id: site.company_id,
        site_id: r.siteId,
        machine_ids: r.machineIds,
        source_type: r.sourceType,
        source_site_id: r.sourceSiteId ?? null,
        requested_category: r.requestedCategory ?? null,
        requested_quantity: r.requestedQuantity ?? null,
        requester: r.requester,
        reason: r.reason,
        needed_from: r.neededFrom,
        needed_until: r.neededUntil,
      });
      if (error) throw error;

      const actor = peekCurrentUser();
      try {
        await appendAuditLedgerEntry({
          companyId: site.company_id,
          eventKind: "request_created",
          summary: `New ${r.sourceType.replace(/_/g, " ")} request (${r.machineIds.length} asset(s)): ${r.reason.trim().slice(0, 200)}`,
          siteId: r.siteId,
          requestId: id,
          requester: r.requester,
          approvedBy: actor?.name ?? r.requester,
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          machineIds: r.machineIds,
          fromDate: r.neededFrom,
          untilDate: r.neededUntil,
          totalUnits: r.machineIds.length,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after request_created", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type RequestDecision = { actorName: string; actorRole: string; notes?: string };

export async function approveRequestRemote(requestId: string, decision: RequestDecision) {
  const { data: reqRow, error: rErr } = await supabase.from("machinery_requests").select("*").eq("id", requestId).single();
  if (rErr || !reqRow) throw new Error(rErr?.message ?? "Request not found");
  const req = mapRequest(reqRow);

  const decidedAt = new Date().toISOString();
  const notes = decision.notes?.trim() || null;
  let allocatedMachineIds = [...req.machineIds];
  const requestCompanyId = req.companyId;

  if (req.sourceType === "purchase") {
    const category = req.requestedCategory;
    const quantity = req.requestedQuantity ?? 0;
    if (!category || quantity <= 0) throw new Error("Invalid purchase request");

    const machRows = await fetchAllSupabasePages((from, to) =>
      supabase.from("machinery").select("id, code").eq("company_id", requestCompanyId).order("code").range(from, to),
    );
    const machines = machRows.map((row) => mapMachinery(row));

    const highestCodeNumber = machines.reduce((maxCode, machine) => {
      const match = machine.code.match(/-(\d+)$/);
      const parsed = match ? Number.parseInt(match[1], 10) : -1;
      return Number.isFinite(parsed) ? Math.max(maxCode, parsed) : maxCode;
    }, -1);

    const newRows = Array.from({ length: quantity }).map((_, index) => {
      const codeNumber = highestCodeNumber + index + 1;
      const categoryPrefix = categoryCodePrefix[category] ?? toCodeChunk(category);
      return {
        id: newMachineryRowId(),
        company_id: requestCompanyId,
        code: `${categoryPrefix}-${String(codeNumber).padStart(3, "0")}`,
        name: `${category} Unit ${codeNumber}`,
        category,
        status: "assigned" as const,
        assigned_site_id: req.siteId,
      };
    });

    allocatedMachineIds = newRows.map((r) => r.id);
    const { error: insErr } = await supabase.from("machinery").insert(newRows);
    if (insErr) throw insErr;
  } else {
    const { error: upErr } = await supabase
      .from("machinery")
      .update({ status: "assigned", assigned_site_id: req.siteId })
      .in("id", allocatedMachineIds);
    if (upErr) throw upErr;
  }

  const { error: reqUp } = await supabase
    .from("machinery_requests")
    .update({
      status: "approved",
      decided_at: decidedAt,
      decided_by: decision.actorName,
      decider_role: decision.actorRole,
      decision_notes: notes,
    })
    .eq("id", requestId);
  if (reqUp) throw reqUp;

  const summaryText = [
    `${decision.actorName} (${decision.actorRole}) approved ${req.sourceType.replace(/_/g, " ")} request.`,
    `${allocatedMachineIds.length} asset(s).`,
    req.reason.trim() ? req.reason.trim().slice(0, 200) : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    await appendAuditLedgerEntry({
      companyId: requestCompanyId,
      eventKind: "request_approved",
      summary: summaryText,
      siteId: req.siteId,
      machineIds: allocatedMachineIds,
      requestId: req.id,
      requester: req.requester,
      approvedBy: decision.actorName,
      approverRole: decision.actorRole,
      fromDate: req.neededFrom,
      untilDate: req.neededUntil,
      totalUnits: allocatedMachineIds.length,
      approvedAt: decidedAt,
    });
  } catch (err) {
    console.warn("[ledger] append skipped after request_approved (apply migration 20260510203000 if missing)", err);
  }
}

export async function rejectRequestRemote(requestId: string, decision: RequestDecision) {
  const { data: reqRow, error: rErr } = await supabase.from("machinery_requests").select("*").eq("id", requestId).single();
  if (rErr || !reqRow) throw new Error(rErr?.message ?? "Request not found");
  const req = mapRequest(reqRow);

  const decidedAt = new Date().toISOString();
  const notes = decision.notes?.trim() || null;
  const { error } = await supabase
    .from("machinery_requests")
    .update({
      status: "rejected",
      decided_at: decidedAt,
      decided_by: decision.actorName,
      decider_role: decision.actorRole,
      decision_notes: notes,
    })
    .eq("id", requestId);
  if (error) throw error;

  const summaryText = [
    `${decision.actorName} (${decision.actorRole}) rejected machinery request.`,
    req.reason.trim().slice(0, 200),
    notes ? `Notes: ${notes.slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    await appendAuditLedgerEntry({
      companyId: req.companyId,
      eventKind: "request_rejected",
      summary: summaryText,
      siteId: req.siteId,
      machineIds: req.machineIds,
      requestId: req.id,
      requester: req.requester,
      approvedBy: decision.actorName,
      approverRole: decision.actorRole,
      fromDate: req.neededFrom,
      untilDate: req.neededUntil,
      totalUnits: req.machineIds.length,
      approvedAt: decidedAt,
    });
  } catch (err) {
    console.warn("[ledger] append skipped after request_rejected", err);
  }
}

export function useApproveRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: RequestDecision }) => approveRequestRemote(id, decision),
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useRejectRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: RequestDecision }) => rejectRequestRemote(id, decision),
    onSuccess: () => invalidateOperational(qc),
  });
}

export type MachineUpdate = Partial<{
  status: MachineryStatus;
  assignedSiteId: string | null;
  lostFromSiteId: string | null;
  projectName: string | undefined;
  projectLocation: string | undefined;
  assignedTo: string | undefined;
  approvedBy: string | undefined;
}>;

export function useUpdateMachineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ machineId, updates }: { machineId: string; updates: MachineUpdate }) => {
      const { data: row, error: gErr } = await supabase.from("machinery").select("*").eq("id", machineId).maybeSingle();
      if (gErr) throw gErr;
      if (!row) throw new Error("Machinery not found");
      const before = mapMachinery(row);

      const patch: Record<string, unknown> = {};
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.assignedSiteId !== undefined) patch.assigned_site_id = updates.assignedSiteId;
      if (updates.lostFromSiteId !== undefined) patch.lost_from_site_id = updates.lostFromSiteId;

      if (updates.status === "lost_damaged") {
        if (updates.assignedSiteId === undefined) patch.assigned_site_id = null;
        if (updates.lostFromSiteId === undefined && before.assignedSiteId) {
          patch.lost_from_site_id = before.assignedSiteId;
        }
      } else if (updates.status !== undefined) {
        patch.lost_from_site_id = null;
      }
      if (updates.projectName !== undefined) patch.project_name = updates.projectName ?? null;
      if (updates.projectLocation !== undefined) patch.project_location = updates.projectLocation ?? null;
      if (updates.assignedTo !== undefined) patch.assigned_to = updates.assignedTo ?? null;
      if (updates.approvedBy !== undefined) patch.approved_by = updates.approvedBy ?? null;

      const { error } = await supabase.from("machinery").update(patch).eq("id", machineId);
      if (error) throw error;

      const idsToLabel = [...new Set([before.assignedSiteId, updates.assignedSiteId].filter(Boolean))] as string[];
      let siteNamesById: Record<string, string> = {};
      if (idsToLabel.length > 0) {
        const { data: siteRows } = await supabase.from("sites").select("id,name").in("id", idsToLabel);
        siteNamesById = Object.fromEntries((siteRows ?? []).map((r) => [String(r.id), String(r.name)]));
      }
      const describeSite = (id: string | null) =>
        id == null ? "company pool" : siteNamesById[id] ?? id;

      const changes: string[] = [];
      let eventKind = "machinery_field_updated";

      if (updates.status !== undefined && updates.status !== before.status) {
        changes.push(`Status ${before.status} → ${updates.status}`);
      }
      if (updates.assignedSiteId !== undefined && updates.assignedSiteId !== before.assignedSiteId) {
        changes.push(`Transferred ${describeSite(before.assignedSiteId)} → ${describeSite(updates.assignedSiteId)}`);
      }
      if (updates.projectName !== undefined && updates.projectName?.trim() !== (before.projectName ?? "").trim()) {
        changes.push("Project title updated");
      }
      if (updates.projectLocation !== undefined && updates.projectLocation?.trim() !== (before.projectLocation ?? "").trim()) {
        changes.push("Site / location notes updated");
      }
      if (updates.assignedTo !== undefined && updates.assignedTo?.trim() !== (before.assignedTo ?? "").trim()) {
        changes.push("Assigned personnel updated");
      }
      if (updates.approvedBy !== undefined && updates.approvedBy?.trim() !== (before.approvedBy ?? "").trim()) {
        changes.push("Approval contact updated");
      }

      const siteChanged =
        updates.assignedSiteId !== undefined && updates.assignedSiteId !== before.assignedSiteId;
      if (siteChanged) eventKind = "machinery_relocated";
      else if (updates.status !== undefined && updates.status !== before.status) eventKind = "machinery_status_changed";

      if (changes.length > 0) {
        const actor = peekCurrentUser();
        const auditSite =
          updates.assignedSiteId !== undefined ? updates.assignedSiteId : before.assignedSiteId;
        try {
          await appendAuditLedgerEntry({
            companyId: before.companyId,
            eventKind,
            summary: `[${before.code}] ${before.name} — ${changes.join("; ")}`,
            siteId: auditSite,
            machineIds: [machineId],
            requester: actor?.name ?? "System",
            approvedBy: actor?.name ?? "System",
            approverRole: actor ? ROLE_LABELS[actor.role] : null,
            totalUnits: 1,
          });
        } catch (err) {
          console.warn("[ledger] append skipped after machinery update", err);
        }
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export function useDeleteMachineMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (machineId: string) => {
      const { data: row, error: gErr } = await supabase.from("machinery").select("*").eq("id", machineId).maybeSingle();
      if (gErr) throw gErr;
      const before = row ? mapMachinery(row) : null;

      const { error } = await supabase.from("machinery").delete().eq("id", machineId);
      if (error) throw error;

      if (before) {
        const actor = peekCurrentUser();
        try {
          await appendAuditLedgerEntry({
            companyId: before.companyId,
            eventKind: "machinery_deleted",
            summary: `Removed machinery ${before.code} (${before.name}).`,
            siteId: before.assignedSiteId,
            machineIds: [machineId],
            requester: actor?.name ?? "System",
            approvedBy: actor?.name ?? "System",
            approverRole: actor ? ROLE_LABELS[actor.role] : null,
            totalUnits: 1,
          });
        } catch (err) {
          console.warn("[ledger] append skipped after machinery_deleted", err);
        }
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type AddMachineryUnit = {
  code: string;
  name: string;
  projectName?: string;
  projectLocation?: string;
  assignedTo?: string;
  approvedBy?: string;
};

export type AddMachineryPayload = {
  category: string;
  status: MachineryStatus;
  assignedSiteId: string | null;
  companyId: string;
  units: AddMachineryUnit[];
  unitType?: MachineryUnitType;
  /** When set (e.g. bulk CSV import), ledger summary mentions bulk upload. */
  ledgerImportTag?: "bulk_csv";
};

export function useAddMachineryMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: AddMachineryPayload) => {
      const normalizedUnits = payload.units
        .map((unit) => ({
          code: unit.code.trim(),
          name: unit.name.trim(),
          project_name: unit.projectName?.trim() ?? null,
          project_location: unit.projectLocation?.trim() ?? null,
          assigned_to: unit.assignedTo?.trim() ?? null,
          approved_by: unit.approvedBy?.trim() ?? null,
        }))
        .filter((unit) => unit.code && unit.name);
      if (!payload.category.trim() || normalizedUnits.length === 0) throw new Error("Invalid machinery payload");

      let siteCompany = payload.companyId;
      if (payload.assignedSiteId) {
        const { data: st } = await supabase.from("sites").select("company_id").eq("id", payload.assignedSiteId).single();
        siteCompany = st?.company_id ?? payload.companyId;
      }

      const unitType = normalizeMachineryUnitType(payload.unitType ?? DEFAULT_MACHINERY_UNIT_TYPE);

      const fixedRows = normalizedUnits.map((unit) => {
        return {
          id: newMachineryRowId(),
          company_id: siteCompany,
          code: unit.code,
          name: unit.name,
          category: payload.category.trim(),
          unit_type: unitType,
          status: payload.status,
          assigned_site_id: payload.status === "assigned" ? payload.assignedSiteId : null,
          project_name: unit.project_name,
          project_location: unit.project_location,
          assigned_to: unit.assigned_to,
          approved_by: unit.approved_by,
        };
      });

      const { error: insErr } = await supabase.from("machinery").insert(fixedRows);
      if (insErr) throw insErr;

      const actor = peekCurrentUser();
      const siteIdForLedger = payload.status === "assigned" ? payload.assignedSiteId : null;
      const codeNameList = normalizedUnits.map((unit) => `${unit.code} (${unit.name})`).join("; ");
      const bulkNote = payload.ledgerImportTag === "bulk_csv" ? "Bulk CSV import · " : "";
      const clipped = codeNameList.length > 400 ? `${codeNameList.slice(0, 400)}…` : codeNameList;
      try {
        await appendAuditLedgerEntry({
          companyId: siteCompany,
          eventKind: "machinery_created",
          summary: `${bulkNote}${actor?.name ?? "User"} added ${normalizedUnits.length} unit(s) — ${payload.category.trim()}: ${clipped}`,
          siteId: siteIdForLedger,
          machineIds: fixedRows.map((r) => r.id as string),
          requester: actor?.name ?? "System",
          approvedBy: actor?.name ?? "System",
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits: normalizedUnits.length,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after machinery_created", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type RecordMachineryMovementInput = {
  siteId: string;
  siteName: string;
  companyId: string;
  direction: MachineryMovementDirection;
  sourceStatus: MachineryStatus;
  movementDate: string;
  gatePassNumber?: string;
  machineIds: string[];
  machineryLabel: string;
  quantity: number;
};

function revertSourceStatusForMovement(
  originalDirection: MachineryMovementDirection,
  originalSourceStatus: MachineryStatus,
): MachineryStatus {
  if (originalDirection === "out") {
    return originalSourceStatus === "maintenance" ? "maintenance" : "available";
  }
  return originalSourceStatus === "maintenance" ? "maintenance" : "assigned";
}

function buildMovementSummary(input: {
  quantity: number;
  machineryLabel: string;
  direction: MachineryMovementDirection;
  siteName: string;
  actorName: string;
  sourceStatus: MachineryStatus;
  gatePassNumber?: string;
}): string {
  const gatePass = input.gatePassNumber?.trim();
  const gatePassNote = gatePass ? ` · Gate pass ${gatePass}` : "";
  const poolLabel = input.sourceStatus.charAt(0).toUpperCase() + input.sourceStatus.slice(1);
  const movementVerb = input.direction === "in" ? "moved OUT from" : "received IN at";
  return `${input.quantity} Qty ${input.machineryLabel} ${movementVerb} ${input.siteName} by ${input.actorName} (${poolLabel} pool)${gatePassNote}.`;
}

function movementUpdatesForDirection(
  direction: MachineryMovementDirection,
  sourceStatus: MachineryStatus,
  siteId: string,
): { status: MachineryStatus; assigned_site_id: string | null } {
  if (direction === "out") {
    if (sourceStatus === "maintenance") {
      return { status: "maintenance", assigned_site_id: null };
    }
    return { status: "available", assigned_site_id: null };
  }
  if (sourceStatus === "maintenance") {
    return { status: "maintenance", assigned_site_id: siteId };
  }
  return { status: "assigned", assigned_site_id: siteId };
}

export function useRecordMachineryMovementMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordMachineryMovementInput) => {
      if (input.machineIds.length === 0 || input.quantity < 1) {
        throw new Error("Select machinery and quantity");
      }
      if (input.machineIds.length !== input.quantity) {
        throw new Error("Quantity does not match selected units");
      }

      const patch = movementUpdatesForDirection(input.direction, input.sourceStatus, input.siteId);
      const { error } = await supabase.from("machinery").update(patch).in("id", input.machineIds);
      if (error) throw error;

      const actor = peekCurrentUser();
      const actorName = actor?.name ?? "System";
      const summary = buildMovementSummary({
        quantity: input.quantity,
        machineryLabel: input.machineryLabel,
        direction: input.direction,
        siteName: input.siteName,
        actorName,
        sourceStatus: input.sourceStatus,
        gatePassNumber: input.gatePassNumber,
      });

      try {
        await appendAuditLedgerEntry({
          companyId: input.companyId,
          eventKind: movementEventKindFromDirection(input.direction),
          summary,
          siteId: input.siteId,
          machineIds: input.machineIds,
          requester: actorName,
          approvedBy: actorName,
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          fromDate: input.movementDate,
          untilDate: null,
          totalUnits: input.quantity,
          approvedAt: new Date(input.movementDate).toISOString(),
        });
      } catch (err) {
        console.warn("[ledger] append skipped after machinery movement", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type UpdateMachineryMovementInput = RecordMachineryMovementInput & {
  ledgerEntryId: string;
  original: {
    direction: MachineryMovementDirection;
    sourceStatus: MachineryStatus;
    machineIds: string[];
  };
};

export function useUpdateMachineryMovementMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMachineryMovementInput) => {
      if (input.machineIds.length === 0 || input.quantity < 1) {
        throw new Error("Select machinery and quantity");
      }
      if (input.machineIds.length !== input.quantity) {
        throw new Error("Quantity does not match selected units");
      }

      const inverseDirection: MachineryMovementDirection = input.original.direction === "in" ? "out" : "in";
      const revertSource = revertSourceStatusForMovement(input.original.direction, input.original.sourceStatus);
      const revertPatch = movementUpdatesForDirection(inverseDirection, revertSource, input.siteId);

      if (input.original.machineIds.length > 0) {
        const { error: revertErr } = await supabase
          .from("machinery")
          .update(revertPatch)
          .in("id", input.original.machineIds);
        if (revertErr) throw revertErr;
      }

      const patch = movementUpdatesForDirection(input.direction, input.sourceStatus, input.siteId);
      const { error: applyErr } = await supabase.from("machinery").update(patch).in("id", input.machineIds);
      if (applyErr) throw applyErr;

      const actor = peekCurrentUser();
      const actorName = actor?.name ?? "System";
      const summary = buildMovementSummary({
        quantity: input.quantity,
        machineryLabel: input.machineryLabel,
        direction: input.direction,
        siteName: input.siteName,
        actorName,
        sourceStatus: input.sourceStatus,
        gatePassNumber: input.gatePassNumber,
      });

      const { error: ledgerErr } = await supabase
        .from("audit_ledger")
        .update({
          event_kind: movementEventKindFromDirection(input.direction),
          summary,
          machine_ids: input.machineIds,
          from_date: input.movementDate,
          until_date: null,
          total_units: input.quantity,
          approved_at: new Date(input.movementDate).toISOString(),
          approved_by: actorName,
        })
        .eq("id", input.ledgerEntryId);
      if (ledgerErr) throw ledgerErr;
    },
    onSuccess: () => invalidateOperational(qc),
  });
}

export type CompleteSiteClosureInput = {
  siteId: string;
  siteName: string;
  companyId: string;
  dispositions: SiteClosureDisposition[];
};

function closurePatchForAction(
  action: SiteClosureDisposition["action"],
  relocateSiteId: string | undefined,
  remarks: string | undefined,
  closingSiteId: string | undefined,
): Record<string, unknown> {
  if (action === "available") {
    return { status: "available", assigned_site_id: null, lost_from_site_id: null, closure_notes: null };
  }
  if (action === "maintenance") {
    return { status: "maintenance", assigned_site_id: null, lost_from_site_id: null, closure_notes: null };
  }
  if (action === "relocate") {
    return {
      status: "assigned",
      assigned_site_id: relocateSiteId ?? null,
      lost_from_site_id: null,
      closure_notes: null,
    };
  }
  const note = remarks?.trim() || null;
  return {
    status: "lost_damaged",
    assigned_site_id: null,
    lost_from_site_id: closingSiteId ?? null,
    closure_notes: note,
  };
}

function closureLedgerSummary(
  disposition: SiteClosureDisposition,
  siteName: string,
  actorName: string,
  targetSiteName?: string,
): string {
  const qty = disposition.machineIds.length;
  const unitLabel = qty === 1 ? "unit" : "units";
  const name = disposition.label;

  switch (disposition.action) {
    case "available":
      return `${qty} ${unitLabel} (${name}) marked available after closure of ${siteName} by ${actorName}.`;
    case "maintenance":
      return `${qty} ${unitLabel} (${name}) sent to maintenance after closure of ${siteName} by ${actorName}.`;
    case "relocate":
      return `${qty} ${unitLabel} (${name}) relocated from ${siteName} to ${targetSiteName ?? "another site"} during site closure by ${actorName}.`;
    case "lost_damaged": {
      const note = disposition.remarks?.trim();
      return note
        ? `${qty} ${unitLabel} (${name}) marked lost/damaged during site completion of ${siteName} by ${actorName}. Notes: ${note}`
        : `${qty} ${unitLabel} (${name}) marked lost/damaged during site completion of ${siteName} by ${actorName}.`;
    }
  }
}

export function useCompleteSiteClosureMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompleteSiteClosureInput) => {
      const actor = peekCurrentUser();
      const actorName = actor?.name ?? "System";

      const siteNameById: Record<string, string> = {};
      if (input.dispositions.some((d) => d.action === "relocate")) {
        const ids = [
          ...new Set(input.dispositions.map((d) => d.relocateSiteId).filter(Boolean)),
        ] as string[];
        if (ids.length > 0) {
          const { data: siteRows } = await supabase.from("sites").select("id,name").in("id", ids);
          for (const row of siteRows ?? []) {
            siteNameById[String(row.id)] = String(row.name);
          }
        }
      }

      for (const disposition of input.dispositions) {
        if (disposition.machineIds.length === 0) continue;
        if (disposition.action === "relocate" && !disposition.relocateSiteId) {
          throw new Error("Select a destination site for relocation.");
        }

        const patch = closurePatchForAction(
          disposition.action,
          disposition.relocateSiteId,
          disposition.remarks,
          input.siteId,
        );
        const { error } = await supabase.from("machinery").update(patch).in("id", disposition.machineIds);
        if (error) throw error;

        const targetName =
          disposition.relocateSiteId != null ? siteNameById[disposition.relocateSiteId] : undefined;
        try {
          await appendAuditLedgerEntry({
            companyId: input.companyId,
            eventKind: "machinery_site_closure",
            summary: closureLedgerSummary(disposition, input.siteName, actorName, targetName),
            siteId: input.siteId,
            machineIds: disposition.machineIds,
            requester: actorName,
            approvedBy: actorName,
            approverRole: actor ? ROLE_LABELS[actor.role] : null,
            totalUnits: disposition.machineIds.length,
          });
        } catch (err) {
          console.warn("[ledger] append skipped after site closure disposition", err);
        }
      }

      const closureSummary = buildClosureSummaryFromDispositions(input.dispositions, actorName);
      const { error: siteErr } = await supabase
        .from("sites")
        .update({
          status: "completed",
          closure_summary: closureSummary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.siteId);
      if (siteErr) throw siteErr;

      const totalUnits = closureSummary.totalUnits;
      try {
        await appendAuditLedgerEntry({
          companyId: input.companyId,
          eventKind: "site_marked_completed",
          summary: `Site "${input.siteName}" marked finished. ${totalUnits} machinery unit(s) processed through site closure by ${actorName}.`,
          siteId: input.siteId,
          machineIds: input.dispositions.flatMap((d) => d.machineIds),
          requester: actorName,
          approvedBy: actorName,
          approverRole: actor ? ROLE_LABELS[actor.role] : null,
          totalUnits,
        });
      } catch (err) {
        console.warn("[ledger] append skipped after site_marked_completed", err);
      }
    },
    onSuccess: () => invalidateOperational(qc),
  });
}
