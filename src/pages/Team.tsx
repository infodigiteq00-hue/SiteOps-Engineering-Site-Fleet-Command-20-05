import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Users, MailPlus, Loader2 } from "lucide-react";
import { ROLE_LABELS, useCurrentUser, type PlatformRole } from "@/lib/session";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { formatCompanyLabel } from "@/lib/companyTenancy";
import {
  appendAuditLedgerEntry,
  operationalKeys,
  useCompanyNameMap,
} from "@/hooks/useOperationalData";
import { parsePlatformRole } from "@/lib/profileRole";
import { isEmailJsConfigured, resolveSignupUrl, sendInviteEmail } from "@/lib/sendInviteEmail";
import { useScopedSites } from "@/hooks/useCompanyScope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  company_id: string | null;
  assigned_site_ids: string[] | null;
};

type CompanyInviteRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  assigned_site_ids: string[] | null;
  status: string;
  created_at: string;
  expires_at: string | null;
};

const invitableRoles: PlatformRole[] = ["senior_manager", "store_manager", "site_manager"];
const editableMemberRoles: PlatformRole[] = [...invitableRoles, "viewer"];

const Team = () => {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const companyNames = useCompanyNameMap();
  const scopedSites = useScopedSites();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<CompanyInviteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<PlatformRole>("site_manager");
  const [inviteSiteIds, setInviteSiteIds] = useState<string[]>([]);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [cancelInviteId, setCancelInviteId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<ProfileRow | null>(null);
  const [editRole, setEditRole] = useState<PlatformRole>("site_manager");
  const [editSites, setEditSites] = useState<string[]>([]);
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || user.role !== "firm_admin" || !user.companyId) return;
    setLoading(true);
    const [{ data: profiles, error: pErr }, { data: invites, error: iErr }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, full_name, role, company_id, assigned_site_ids")
        .eq("company_id", user.companyId)
        .order("full_name", { ascending: true }),
      supabase
        .from("company_invites")
        .select("id, email, full_name, role, assigned_site_ids, status, created_at, expires_at")
        .eq("company_id", user.companyId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    setLoading(false);
    if (pErr) {
      toast({ title: "Could not load team", description: pErr.message, variant: "destructive" });
      return;
    }
    if (iErr) {
      toast({ title: "Could not load invitations", description: iErr.message, variant: "destructive" });
    }
    setRows((profiles as ProfileRow[]) ?? []);
    setPendingInvites((invites as CompanyInviteRow[]) ?? []);
  }, [user.role, user.companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const companyLabel = useMemo(() => formatCompanyLabel(user.companyId, companyNames), [user.companyId, companyNames]);

  const sitesById = useMemo(() => Object.fromEntries(scopedSites.map((s) => [s.id, s.name])), [scopedSites]);

  const openEdit = (row: ProfileRow) => {
    setEditRow(row);
    setEditRole(parsePlatformRole(row.role) as PlatformRole);
    setEditSites(Array.isArray(row.assigned_site_ids) ? row.assigned_site_ids : []);
  };

  const saveEdit = async () => {
    if (!editRow) return;
    if (editRole === "site_manager" && scopedSites.length > 0 && editSites.length === 0) {
      toast({ title: "Sites required", description: "Choose at least one site for Site Manager.", variant: "destructive" });
      return;
    }
    setEditBusy(true);
    const siteIds = editRole === "site_manager" ? editSites : [];
    const { error } = await supabase
      .from("profiles")
      .update({ role: editRole, assigned_site_ids: siteIds })
      .eq("id", editRow.id);
    setEditBusy(false);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    const prevRole = parsePlatformRole(editRow.role) as PlatformRole;
    const prevSites = [...(editRow.assigned_site_ids ?? [])].sort().join(",");
    const nextSites = [...editSites].sort().join(",");
    const siteNote = prevSites !== nextSites ? " Site assignments were updated." : "";

    if (editRow.company_id && user.companyId === editRow.company_id) {
      try {
        await appendAuditLedgerEntry({
          companyId: editRow.company_id,
          eventKind: "user_role_changed",
          summary: `${user.name} (${ROLE_LABELS[user.role]}) updated ${editRow.full_name ?? editRow.email ?? "member"}: role ${ROLE_LABELS[prevRole]} → ${ROLE_LABELS[editRole]}.${siteNote}`,
          siteId: null,
          machineIds: [],
          requester: editRow.full_name ?? editRow.email ?? "Member",
          approvedBy: user.name ?? "Firm admin",
          approverRole: ROLE_LABELS[user.role],
          totalUnits: 0,
        });
      } catch (err) {
        console.warn("[ledger] skipped after user_role_changed", err);
      }
      void queryClient.invalidateQueries({ queryKey: operationalKeys.all });
    }

    toast({ title: "Member updated" });
    setEditRow(null);
    void load();
  };

  const revokeInvite = async (id: string) => {
    const inv = pendingInvites.find((item) => item.id === id);
    setCancelInviteId(id);
    const { error } = await supabase.from("company_invites").update({ status: "cancelled" }).eq("id", id);
    setCancelInviteId(null);
    if (error) {
      toast({ title: "Could not cancel invite", description: error.message, variant: "destructive" });
      return;
    }

    if (user.companyId) {
      try {
        await appendAuditLedgerEntry({
          companyId: user.companyId,
          eventKind: "invite_cancelled",
          summary: `${user.name} cancelled pending invitation for ${inv?.full_name ?? "invite"} (${inv?.email ?? id}).`,
          siteId: inv?.assigned_site_ids?.[0] ?? null,
          machineIds: [],
          requester: inv?.full_name ?? inv?.email ?? "invite",
          approvedBy: user.name ?? "Firm admin",
          approverRole: ROLE_LABELS[user.role],
          totalUnits: 0,
        });
      } catch (err) {
        console.warn("[ledger] skipped after invite_cancelled", err);
      }
      void queryClient.invalidateQueries({ queryKey: operationalKeys.all });
    }

    toast({ title: "Invitation cancelled" });
    void load();
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) {
      toast({ title: "Missing fields", description: "Email and full name are required.", variant: "destructive" });
      return;
    }
    if (!user.companyId) {
      toast({ title: "No company", description: "Your firm admin profile must belong to a company.", variant: "destructive" });
      return;
    }
    if (inviteRole === "site_manager" && scopedSites.length > 0 && inviteSiteIds.length === 0) {
      toast({ title: "Sites required", description: "Choose at least one site for Site Manager.", variant: "destructive" });
      return;
    }
    const sitePayload = inviteRole === "site_manager" ? inviteSiteIds : [];

    setInviteBusy(true);
    const { error } = await supabase.from("company_invites").insert({
      company_id: user.companyId,
      email: inviteEmail.trim().toLowerCase(),
      full_name: inviteName.trim(),
      role: inviteRole,
      assigned_site_ids: sitePayload,
      invited_by: user.id,
    });
    setInviteBusy(false);
    if (error) {
      const msg =
        error.code === "23505"
          ? "There is already a pending invitation for this email."
          : error.message.includes("assigned_site_ids")
            ? error.message
            : error.message;
      toast({ title: "Could not save invite", description: msg, variant: "destructive" });
      return;
    }

    if (isEmailJsConfigured()) {
      try {
        await sendInviteEmail({
          toEmail: inviteEmail.trim().toLowerCase(),
          toName: inviteName.trim(),
          companyName: formatCompanyLabel(user.companyId, companyNames) || "Your organisation",
          roleLabel: ROLE_LABELS[inviteRole],
          signupUrl: resolveSignupUrl(),
        });
      } catch (e) {
        toast({
          title: "Invite saved; email not sent",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
    }

    try {
      await appendAuditLedgerEntry({
        companyId: user.companyId,
        eventKind: "user_invited",
        summary: `${user.name} (${ROLE_LABELS[user.role]}) invited ${inviteName.trim()} (${inviteEmail.trim().toLowerCase()}) as ${ROLE_LABELS[inviteRole]}.`,
        siteId: inviteSiteIds[0] ?? null,
        machineIds: [],
        requester: inviteName.trim(),
        approvedBy: user.name ?? "Firm admin",
        approverRole: ROLE_LABELS[user.role],
        totalUnits: 0,
      });
    } catch (err) {
      console.warn("[ledger] skipped after user_invited", err);
    }
    void queryClient.invalidateQueries({ queryKey: operationalKeys.all });

    const noSitesSiteManager = inviteRole === "site_manager" && scopedSites.length === 0;
    toast({
      title: isEmailJsConfigured() ? "Invitation saved and email sent" : "Invitation saved",
      description: isEmailJsConfigured()
        ? noSitesSiteManager
          ? "They can sign up with this email. Create sites, then assign them to this Site Manager from Team."
          : "They can complete sign-up from the link in their inbox (same work email)."
        : noSitesSiteManager
          ? "Create sites, then assign this Site Manager from Team. They can register on /signup with this email."
          : "Configure EmailJS env vars to send the signup link by email. They can still register on /signup with this email.",
    });
    setInviteOpen(false);
    setInviteEmail("");
    setInviteName("");
    setInviteSiteIds([]);
    void load();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Users className="h-7 w-7 text-muted-foreground" />
            Team
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Company: <strong className="text-foreground">{companyLabel}</strong>. Invite operational roles; Super Admins are provisioned in the database only.
          </p>
        </div>
        <Button type="button" className="gap-2 self-start" onClick={() => setInviteOpen(true)}>
          <MailPlus className="h-4 w-4" />
          Invite member
        </Button>
      </div>

      {pendingInvites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold tracking-tight">Pending invitations</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Sites</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[parsePlatformRole(inv.role) as PlatformRole]}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                      {(inv.assigned_site_ids ?? []).map((id) => sitesById[id] ?? id).join(", ") || "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={cancelInviteId === inv.id}
                        onClick={() => void revokeInvite(inv.id)}
                      >
                        {cancelInviteId === inv.id ? "…" : "Cancel"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading team…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Sites</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.full_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{row.email || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABELS[parsePlatformRole(row.role) as PlatformRole]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {(row.assigned_site_ids ?? []).map((id) => sitesById[id] ?? id).join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    {row.id !== user.id && (
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Invitations are stored in <code className="rounded bg-muted px-1">company_invites</code> with the selected role. With EmailJS configured, an invite email is sent with a link to{" "}
        <strong>/signup</strong>. The invitee must use the <strong>same email</strong>; after Supabase email confirmation they sign in and receive the role from the invite row.
      </p>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="invEmail">Work email</Label>
              <Input id="invEmail" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="invName">Full name</Label>
              <Input id="invName" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
            </div>
            <div>
              <Label>Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => {
                  setInviteRole(v as PlatformRole);
                  setInviteSiteIds([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {invitableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {inviteRole === "site_manager" && (
              <div className="space-y-2">
                <Label>Assigned sites</Label>
                {scopedSites.length === 0 ? (
                  <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    <p>
                      No sites yet. You can still save this invitation — they will join as Site Manager with no sites assigned. After you add sites, assign them from this Team list (
                      <span className="font-medium text-foreground">Edit</span> on the member).
                    </p>
                    <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                      <Link to="/sites">Create sites</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-border p-2">
                    {scopedSites.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={inviteSiteIds.includes(s.id)}
                          onCheckedChange={(c) => {
                            setInviteSiteIds((prev) => (c ? [...prev, s.id] : prev.filter((x) => x !== s.id)));
                          }}
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={inviteBusy} onClick={() => void sendInvite()}>
              {inviteBusy ? "Saving…" : "Save invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update member</DialogTitle>
          </DialogHeader>
          {editRow && (
            <>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{editRow.email}</p>
                <div>
                  <Label>Role</Label>
                  <Select value={editRole} onValueChange={(v) => setEditRole(v as PlatformRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editableMemberRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {editRole === "site_manager" && (
                  <div className="space-y-2">
                    <Label>Assigned sites</Label>
                    {scopedSites.length === 0 ? (
                      <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                        <p>No sites to assign yet. Create sites first, then return here to assign this Site Manager.</p>
                        <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" asChild>
                          <Link to="/sites">Go to Sites</Link>
                        </Button>
                      </div>
                    ) : (
                      <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border border-border p-2">
                        {scopedSites.map((s) => (
                          <label key={s.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={editSites.includes(s.id)}
                              onCheckedChange={(c) => {
                                setEditSites((prev) => (c ? [...prev, s.id] : prev.filter((x) => x !== s.id)));
                              }}
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditRow(null)}>
                  Cancel
                </Button>
                <Button type="button" disabled={editBusy} onClick={() => void saveEdit()}>
                  {editBusy ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Team;
