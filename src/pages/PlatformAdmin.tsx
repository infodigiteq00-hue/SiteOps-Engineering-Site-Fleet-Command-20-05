import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Building2, ChevronDown, Loader2, Mail, Pencil, Plus, Shield, Trash2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS, initialsFromName, useCurrentUser } from "@/lib/session";
import { supabase } from "@/lib/supabaseClient";
import { isSupabaseConfigured } from "@/lib/supabaseClient";
import { isEmailJsConfigured, resolveSignupUrl, sendInviteEmail } from "@/lib/sendInviteEmail";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type CompanyRow = { id: string; name: string; created_at: string };
type LooseProfile = { id: string; email: string | null; full_name: string | null; role: string; company_id: string | null };
type FirmInviteRow = {
  id: string;
  email: string;
  full_name: string;
  contact_phone: string | null;
  company_id: string;
  status: string;
  created_at: string;
};
type FirmAdminRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company_id: string | null;
  contact_phone: string | null;
};

type CompanyMemberRow = FirmAdminRow & { role: string };

const ROLE_ORDER: Record<string, number> = {
  firm_admin: 0,
  senior_manager: 1,
  store_manager: 2,
  site_manager: 3,
  viewer: 4,
  super_admin: 5,
};

function pickPrimaryMember(rows: CompanyMemberRow[]): CompanyMemberRow | undefined {
  if (rows.length === 0) return undefined;
  return [...rows].sort(
    (a, b) =>
      (ROLE_ORDER[normalizeRole(a.role)] ?? 99) - (ROLE_ORDER[normalizeRole(b.role)] ?? 99),
  )[0];
}

function normalizeRole(role: string | null | undefined): string {
  return (role ?? "").trim().toLowerCase();
}

const PlatformAdmin = () => {
  const { isSupabaseEnabled } = useAuth();
  const user = useCurrentUser();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [unassigned, setUnassigned] = useState<LooseProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [firmInvites, setFirmInvites] = useState<FirmInviteRow[]>([]);
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [busyOnboard, setBusyOnboard] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editCompanyId, setEditCompanyId] = useState<string | null>(null);
  const [editInviteId, setEditInviteId] = useState<string | null>(null);
  const [editFirmAdminProfileId, setEditFirmAdminProfileId] = useState<string | null>(null);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editAdminName, setEditAdminName] = useState("");
  const [editAdminEmail, setEditAdminEmail] = useState("");
  const [editAdminPhone, setEditAdminPhone] = useState("");
  const [firmAdminByCompany, setFirmAdminByCompany] = useState<Record<string, FirmAdminRow>>({});
  const [primaryMemberByCompany, setPrimaryMemberByCompany] = useState<Record<string, CompanyMemberRow>>({});
  const [memberCountByCompany, setMemberCountByCompany] = useState<Record<string, number>>({});
  const [deleteTarget, setDeleteTarget] = useState<CompanyRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    const [{ data: cData, error: cErr }, { data: uData, error: uErr }] = await Promise.all([
      supabase.from("companies").select("id, name, created_at").order("name", { ascending: true }),
      supabase.from("profiles").select("id, email, full_name, role, company_id").is("company_id", null).order("email"),
    ]);
    if (cErr) toast({ title: "Companies", description: cErr.message, variant: "destructive" });
    if (uErr) toast({ title: "Profiles", description: uErr.message, variant: "destructive" });

    let iData: FirmInviteRow[] | null = null;
    let iErr: { message: string } | null = null;
    const invWithPhone = await supabase
      .from("company_invites")
      .select("id, email, full_name, contact_phone, company_id, status, created_at")
      .eq("role", "firm_admin")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (invWithPhone.error && /contact_phone|does not exist|schema cache/i.test(invWithPhone.error.message ?? "")) {
      const invNo = await supabase
        .from("company_invites")
        .select("id, email, full_name, company_id, status, created_at")
        .eq("role", "firm_admin")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      iErr = invNo.error;
      iData =
        (invNo.data as FirmInviteRow[] | null)?.map((r) => ({
          ...r,
          contact_phone: null,
        })) ?? null;
    } else {
      iErr = invWithPhone.error;
      iData = invWithPhone.data as FirmInviteRow[] | null;
    }
    if (iErr) toast({ title: "Invites", description: iErr.message, variant: "destructive" });
    const list = (cData as CompanyRow[]) ?? [];
    setCompanies(list);
    setUnassigned((uData as LooseProfile[]) ?? []);
    setFirmInvites((iData as FirmInviteRow[]) ?? []);

    const ids = list.map((c) => c.id);
    if (ids.length === 0) {
      setFirmAdminByCompany({});
      setPrimaryMemberByCompany({});
      setMemberCountByCompany({});
      setLoading(false);
      return;
    }

    let memberRows: CompanyMemberRow[] | null = null;
    let mErr: { message: string } | null = null;
    const withPhone = await supabase
      .from("profiles")
      .select("id, email, full_name, role, company_id, contact_phone")
      .in("company_id", ids);
    if (withPhone.error && /contact_phone|does not exist|schema cache/i.test(withPhone.error.message ?? "")) {
      const noPhone = await supabase.from("profiles").select("id, email, full_name, role, company_id").in("company_id", ids);
      mErr = noPhone.error;
      memberRows = (noPhone.data as CompanyMemberRow[] | null)?.map((r) => ({ ...r, contact_phone: null })) ?? null;
    } else {
      mErr = withPhone.error;
      memberRows = withPhone.data as CompanyMemberRow[] | null;
    }
    if (mErr) toast({ title: "Team profiles", description: mErr.message, variant: "destructive" });

    const rows = (memberRows as CompanyMemberRow[] | null) ?? [];
    const byCompany = new Map<string, CompanyMemberRow[]>();
    for (const row of rows) {
      if (!row.company_id) continue;
      const list = byCompany.get(row.company_id) ?? [];
      list.push(row);
      byCompany.set(row.company_id, list);
    }

    const counts: Record<string, number> = {};
    const adminMap: Record<string, FirmAdminRow> = {};
    const primaryMap: Record<string, CompanyMemberRow> = {};
    for (const id of ids) {
      const list = byCompany.get(id) ?? [];
      counts[id] = list.length;
      const firm = list.find((r) => normalizeRole(r.role) === "firm_admin");
      if (firm) {
        adminMap[id] = {
          id: firm.id,
          email: firm.email,
          full_name: firm.full_name,
          company_id: firm.company_id,
          contact_phone: firm.contact_phone ?? null,
        };
      }
      const primary = pickPrimaryMember(list);
      if (primary) primaryMap[id] = primary;
    }
    setMemberCountByCompany(counts);
    setFirmAdminByCompany(adminMap);
    setPrimaryMemberByCompany(primaryMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inviteByCompanyId = useMemo(() => {
    const m = new Map<string, FirmInviteRow>();
    firmInvites.forEach((inv) => {
      if (!m.has(inv.company_id)) m.set(inv.company_id, inv);
    });
    return m;
  }, [firmInvites]);

  useLayoutEffect(() => {
    if (!editOpen || !editCompanyId || loading) return;

    const company = companies.find((x) => x.id === editCompanyId);
    if (!company) return;

    const invite = inviteByCompanyId.get(editCompanyId);
    const admin = firmAdminByCompany[editCompanyId];
    const primary = primaryMemberByCompany[editCompanyId];

    setEditCompanyName(company.name);
    if (invite) {
      setEditInviteId(invite.id);
      setEditFirmAdminProfileId(null);
      setEditAdminName(invite.full_name ?? "");
      setEditAdminEmail((invite.email ?? "").trim());
      setEditAdminPhone(invite.contact_phone ?? "");
    } else if (admin) {
      setEditInviteId(null);
      setEditFirmAdminProfileId(admin.id);
      setEditAdminName(admin.full_name ?? "");
      setEditAdminEmail((admin.email ?? "").trim());
      setEditAdminPhone(admin.contact_phone ?? "");
    } else if (primary) {
      setEditInviteId(null);
      setEditFirmAdminProfileId(normalizeRole(primary.role) === "firm_admin" ? primary.id : null);
      setEditAdminName(primary.full_name ?? "");
      setEditAdminEmail((primary.email ?? "").trim());
      setEditAdminPhone(primary.contact_phone ?? "");
    } else {
      setEditInviteId(null);
      setEditFirmAdminProfileId(null);
      setEditAdminName("");
      setEditAdminEmail("");
      setEditAdminPhone("");
    }
  }, [
    editOpen,
    editCompanyId,
    loading,
    companies,
    inviteByCompanyId,
    firmAdminByCompany,
    primaryMemberByCompany,
  ]);

  const stats = useMemo(() => {
    const pending = firmInvites.length;
    const onboarded = companies.filter((c) => firmAdminByCompany[c.id]).length;
    return { total: companies.length, pending, onboarded };
  }, [companies, firmInvites.length, firmAdminByCompany]);

  const resetCreateForm = () => {
    setNewCompanyName("");
    setAdminName("");
    setAdminEmail("");
    setAdminPhone("");
  };

  const resetEditForm = () => {
    setEditCompanyId(null);
    setEditInviteId(null);
    setEditFirmAdminProfileId(null);
    setEditCompanyName("");
    setEditAdminName("");
    setEditAdminEmail("");
    setEditAdminPhone("");
  };

  const openEditCompany = (c: CompanyRow) => {
    setEditCompanyId(c.id);
    setEditOpen(true);
  };

  const confirmDeleteCompany = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    const { error } = await supabase.from("companies").delete().eq("id", deleteTarget.id);
    setDeleteBusy(false);
    if (error) {
      toast({ title: "Could not delete company", description: error.message, variant: "destructive" });
      return;
    }
    if (editCompanyId === deleteTarget.id) {
      setEditOpen(false);
      resetEditForm();
    }
    setDeleteTarget(null);
    toast({ title: "Company deleted" });
    void load();
  };

  const saveEditCompany = async () => {
    if (!editCompanyId) return;
    const coName = editCompanyName.trim();
    if (!coName) {
      toast({ title: "Company name required", variant: "destructive" });
      return;
    }
    const adminNameTrim = editAdminName.trim();
    const adminEmailTrim = editAdminEmail.trim().toLowerCase();
    const adminPhoneTrim = editAdminPhone.trim() || null;

    if (editInviteId || editFirmAdminProfileId) {
      if (!adminNameTrim || !adminEmailTrim) {
        toast({ title: "Admin name and email required", variant: "destructive" });
        return;
      }
    } else if (adminNameTrim || adminEmailTrim || adminPhoneTrim) {
      if (!adminNameTrim || !adminEmailTrim) {
        toast({ title: "For a new invite, add both admin name and email (or clear admin fields to only rename the company).", variant: "destructive" });
        return;
      }
    }

    setEditBusy(true);
    const { error: coErr } = await supabase.from("companies").update({ name: coName }).eq("id", editCompanyId);
    if (coErr) {
      setEditBusy(false);
      toast({ title: "Could not update company", description: coErr.message, variant: "destructive" });
      return;
    }

    if (editInviteId) {
      const { error: invErr } = await supabase
        .from("company_invites")
        .update({
          full_name: adminNameTrim,
          email: adminEmailTrim,
          contact_phone: adminPhoneTrim,
        })
        .eq("id", editInviteId)
        .eq("status", "pending");
      if (invErr) {
        setEditBusy(false);
        toast({ title: "Could not update invite", description: invErr.message, variant: "destructive" });
        void load();
        return;
      }
      if (isEmailJsConfigured()) {
        try {
          await sendInviteEmail({
            toEmail: adminEmailTrim,
            toName: adminNameTrim,
            companyName: coName,
            roleLabel: ROLE_LABELS.firm_admin,
            signupUrl: resolveSignupUrl(),
            contactPhone: adminPhoneTrim ?? undefined,
          });
        } catch (e) {
          toast({
            title: "Saved; invite email failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        }
      }
    } else if (editFirmAdminProfileId) {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          full_name: adminNameTrim || null,
          email: adminEmailTrim,
          contact_phone: adminPhoneTrim,
        })
        .eq("id", editFirmAdminProfileId);
      if (pErr) {
        setEditBusy(false);
        toast({ title: "Could not update admin profile", description: pErr.message, variant: "destructive" });
        void load();
        return;
      }
    } else if (adminNameTrim && adminEmailTrim) {
      const { error: insErr } = await supabase.from("company_invites").insert({
        company_id: editCompanyId,
        email: adminEmailTrim,
        full_name: adminNameTrim,
        contact_phone: adminPhoneTrim,
        role: "firm_admin",
        assigned_site_ids: [],
        invited_by: user.id,
      });
      if (insErr) {
        setEditBusy(false);
        toast({ title: "Could not create invite", description: insErr.message, variant: "destructive" });
        void load();
        return;
      }
      if (isEmailJsConfigured()) {
        try {
          await sendInviteEmail({
            toEmail: adminEmailTrim,
            toName: adminNameTrim,
            companyName: coName,
            roleLabel: ROLE_LABELS.firm_admin,
            signupUrl: resolveSignupUrl(),
            contactPhone: adminPhoneTrim ?? undefined,
          });
        } catch (e) {
          toast({
            title: "Invite saved; email failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        }
      }
    }

    setEditBusy(false);
    toast({ title: "Saved" });
    resetEditForm();
    setEditOpen(false);
    void load();
  };

  const createCompanyAndInviteFirmAdmin = async () => {
    const coName = newCompanyName.trim();
    const name = adminName.trim();
    const email = adminEmail.trim().toLowerCase();
    const phone = adminPhone.trim();
    if (!coName || !name || !email) {
      toast({ title: "Fill company and admin details", variant: "destructive" });
      return;
    }
    setBusyOnboard(true);
    const { data: inserted, error: coErr } = await supabase.from("companies").insert({ name: coName }).select("id").single();
    if (coErr || !inserted?.id) {
      setBusyOnboard(false);
      toast({ title: "Could not create company", description: coErr?.message, variant: "destructive" });
      return;
    }
    const companyId = inserted.id as string;
    const { error: invErr } = await supabase.from("company_invites").insert({
      company_id: companyId,
      email,
      full_name: name,
      contact_phone: phone || null,
      role: "firm_admin",
      assigned_site_ids: [],
      invited_by: user.id,
    });
    if (invErr) {
      setBusyOnboard(false);
      toast({ title: "Company created but invite failed", description: invErr.message, variant: "destructive" });
      void load();
      return;
    }

    if (isEmailJsConfigured()) {
      try {
        await sendInviteEmail({
          toEmail: email,
          toName: name,
          companyName: coName,
          roleLabel: ROLE_LABELS.firm_admin,
          signupUrl: resolveSignupUrl(),
          contactPhone: phone || undefined,
        });
      } catch (e) {
        setBusyOnboard(false);
        toast({
          title: "Invite saved; email failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
        resetCreateForm();
        setCreateOpen(false);
        void load();
        return;
      }
    } else {
      toast({
        title: "Company and invite saved",
        description: "Configure EmailJS env vars to send the signup email automatically.",
      });
    }

    setBusyOnboard(false);
    toast({ title: isEmailJsConfigured() ? "Company created and invite email sent" : "Company created" });
    resetCreateForm();
    setCreateOpen(false);
    void load();
  };

  if (!isSupabaseEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="h-7 w-7 text-muted-foreground" />
          Platform
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure <code className="rounded bg-muted px-1">VITE_SUPABASE_URL</code> and{" "}
          <code className="rounded bg-muted px-1">VITE_SUPABASE_ANON_KEY</code> to manage companies and onboarding.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h2 className="font-display flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Shield className="h-7 w-7 text-muted-foreground" />
          Platform — Super Admin
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Create companies and invite Firm Admins. Invited companies appear as cards below; after they confirm email and sign up, status moves to active.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total companies" value={stats.total} icon={Building2} accent="blue" />
        <StatCard label="Pending invites" value={stats.pending} icon={Mail} accent="cyan" />
        <StatCard label="Onboarded" value={stats.onboarded} icon={Users} accent="green" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Companies overview</h3>
          <p className="text-sm text-muted-foreground">Invited tenants and their Firm Admin. Day-to-day users are managed inside each company.</p>
        </div>
        <Button type="button" className="gap-2 bg-blue-600 hover:bg-blue-500" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create new company
        </Button>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreateForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New company & Firm Admin</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="coName">Company name</Label>
              <Input id="coName" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)} placeholder="e.g. Krishna Infra Pvt Ltd" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admName">Admin name</Label>
              <Input id="admName" value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admEmail">Admin email</Label>
              <Input id="admEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@company.com" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="admPhone">Contact number</Label>
              <Input id="admPhone" type="tel" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} placeholder="+91 …" />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Saves <span className="font-mono">company_invites</span> (role firm_admin). EmailJS sends <span className="font-mono">signup_link</span> when configured.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busyOnboard} onClick={() => void createCompanyAndInviteFirmAdmin()}>
              {busyOnboard ? "Working…" : "Create & send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) resetEditForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit company</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="editCoName">Company name</Label>
              <Input id="editCoName" value={editCompanyName} onChange={(e) => setEditCompanyName(e.target.value)} placeholder="Company name" />
            </div>
            <div className="space-y-1.5 sm:col-span-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-muted-foreground">Firm Admin</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editAdmName">Admin name</Label>
              <Input
                id="editAdmName"
                value={editAdminName}
                onChange={(e) => setEditAdminName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editAdmEmail">Admin email</Label>
              <Input
                id="editAdmEmail"
                type="email"
                value={editAdminEmail}
                onChange={(e) => setEditAdminEmail(e.target.value)}
                placeholder="admin@company.com"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="editAdmPhone">Contact number</Label>
              <Input
                id="editAdmPhone"
                type="tel"
                value={editAdminPhone}
                onChange={(e) => setEditAdminPhone(e.target.value)}
                placeholder="+91 …"
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {editInviteId
                ? "Pending invite — save updates it; invite email sends again if EmailJS is on."
                : editFirmAdminProfileId
                  ? "Firm Admin profile — save updates this user."
                  : "Add name + email and save to send a Firm Admin invite. Leave admin fields empty to only rename the company."}
            </p>
            {editFirmAdminProfileId && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Login email in Supabase Auth may differ from this directory email; update Auth in the dashboard if the user cannot sign in.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={editBusy} onClick={() => void saveEditCompany()}>
              {editBusy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this company?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{deleteTarget?.name}</span> will be removed. Related sites, machinery, requests, and audit rows for this company are removed by the database;
              team profiles lose this company link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={deleteBusy} onClick={() => void confirmDeleteCompany()}>
              {deleteBusy ? "Deleting…" : "Delete company"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          Loading companies…
        </div>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center text-sm text-muted-foreground">
          No companies yet. Use <strong className="text-foreground">Create new company</strong> to add one.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((c) => {
            const invite = inviteByCompanyId.get(c.id);
            const adminProfile = firmAdminByCompany[c.id];
            const primary = primaryMemberByCompany[c.id];
            const pending = Boolean(invite);
            const onboarded = Boolean(adminProfile) && !pending;
            const displayName = invite?.full_name ?? adminProfile?.full_name ?? primary?.full_name ?? "—";
            const displayEmail = invite?.email ?? adminProfile?.email ?? primary?.email ?? "—";
            const displayPhone = invite?.contact_phone ?? adminProfile?.contact_phone ?? primary?.contact_phone ?? "—";
            const members = memberCountByCompany[c.id] ?? 0;

            return (
              <div
                key={c.id}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card transition-shadow hover:shadow-elevated"
              >
                <div className="relative bg-gradient-to-r from-blue-600 to-blue-800 px-4 py-3 text-white">
                  <div className="flex items-start justify-between gap-2 pr-20">
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-base font-semibold leading-tight">{c.name}</div>
                      <div className="mt-1 text-[10px] font-mono uppercase tracking-wider text-blue-100/90">{c.id.slice(0, 8)}…</div>
                    </div>
                  </div>
                  <div className="absolute right-2 top-2 flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => openEditCompany(c)}
                      className="rounded-md p-1.5 text-white/90 transition-colors hover:bg-white/15 hover:text-white"
                      aria-label="Edit company"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={loading || deleteBusy}
                      onClick={() => setDeleteTarget(c)}
                      className="rounded-md p-1.5 text-white/90 transition-colors hover:bg-red-600/45 hover:text-white"
                      aria-label="Delete company"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex flex-wrap gap-2">
                    {pending ? (
                      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200">Invite pending</Badge>
                    ) : onboarded ? (
                      <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200">Active</Badge>
                    ) : (
                      <Badge variant="secondary">No admin yet</Badge>
                    )}
                    <Badge variant="outline">{ROLE_LABELS.firm_admin}</Badge>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">Created</span> · {format(new Date(c.created_at), "MMM d, yyyy")}
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Members</span> · {members}
                    </div>
                  </div>
                  <div className="border-t border-border pt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Company admin</div>
                    <div className="mt-2 flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
                          "bg-gradient-to-br from-blue-500 to-blue-700",
                        )}
                      >
                        {initialsFromName(displayName === "—" ? displayEmail : displayName)}
                      </div>
                      <div className="min-w-0 text-sm">
                        <div className="font-medium text-foreground">{displayName}</div>
                        <div className="truncate text-muted-foreground">{displayEmail}</div>
                        {displayPhone !== "—" && <div className="text-muted-foreground">{displayPhone}</div>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Collapsible className="rounded-xl border border-border bg-card">
        <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted/50">
          <span className="text-muted-foreground">Self-registered users without a company ({unassigned.length})</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border px-4 py-4">
            <p className="mb-4 text-xs text-muted-foreground">Profiles with no company (for reference). Company linking is handled via invites or Supabase admin.</p>
            {unassigned.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassigned.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.full_name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.email || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.role}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default PlatformAdmin;
