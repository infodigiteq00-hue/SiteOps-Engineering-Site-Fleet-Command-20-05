import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/lib/session";
import { canCreateSite } from "@/lib/rbac";
import { useScopedMachines } from "@/hooks/useCompanyScope";
import { useCompaniesQuery, useCreateSiteMutation } from "@/hooks/useOperationalData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NewSite = () => {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const scopedMachines = useScopedMachines();
  const { data: companies = [] } = useCompaniesQuery();
  const createSiteMutation = useCreateSiteMutation();

  const [organisationId, setOrganisationId] = useState("");

  useEffect(() => {
    if (user.role === "super_admin" && companies.length && (!organisationId || !companies.some((c) => c.id === organisationId))) {
      setOrganisationId(companies[0].id);
    }
  }, [user.role, companies, organisationId]);

  useEffect(() => {
    if (!canCreateSite(user.role)) {
      toast({
        title: "Access denied",
        description: "Only Firm Admin, Senior Manager, or Super Admin can create sites.",
        variant: "destructive",
      });
      navigate("/sites");
    }
  }, [user.role, navigate]);

  const availableMachines = useMemo(() => scopedMachines.filter((machine) => machine.status === "available"), [scopedMachines]);

  const [form, setForm] = useState({
    name: "",
    location: "",
    machineIds: [] as string[],
  });

  if (!canCreateSite(user.role)) return null;

  const resolvedCompanyId = user.role === "super_admin" ? organisationId || companies[0]?.id || "" : user.companyId ?? "";

  const inputCls = "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30";
  const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground";

  const toggleMachine = (id: string) => {
    setForm((current) => ({
      ...current,
      machineIds: current.machineIds.includes(id) ? current.machineIds.filter((machineId) => machineId !== id) : [...current.machineIds, id],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.location.trim()) {
      toast({ title: "Missing fields", description: "Please add site name and location.", variant: "destructive" });
      return;
    }
    if (form.machineIds.length === 0) {
      toast({ title: "No machinery selected", description: "Please allot at least one available machine.", variant: "destructive" });
      return;
    }
    if (!resolvedCompanyId) {
      toast({ title: "No company", description: "Pick a company (Super Admin) or ensure your profile has a company.", variant: "destructive" });
      return;
    }
    try {
      const siteId = await createSiteMutation.mutateAsync({
        ...form,
        companyId: resolvedCompanyId,
      });
      toast({ title: "Site created", description: "New site is live with allotted machinery." });
      navigate(`/sites/${siteId}`);
    } catch (err) {
      toast({
        title: "Could not create site",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-card">
        <div>
          <h2 className="font-display text-xl font-semibold">Create New Site</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add site details and allot machinery from available units owned by your organisation.
          </p>
        </div>

        {user.role === "super_admin" && (
          <div>
            <label className={labelCls}>Company (tenancy)</label>
            <Select value={organisationId} onValueChange={setOrganisationId} disabled={companies.length === 0}>
              <SelectTrigger className={inputCls}>
                <SelectValue placeholder={companies.length ? "Choose company" : "Loading companies…"} />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">Super Admin may create sites under any company in Supabase.</p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Site name</label>
            <input
              className={inputCls}
              value={form.name}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              placeholder="e.g. Essar Steel - Hazira"
              maxLength={90}
            />
          </div>
          <div>
            <label className={labelCls}>Location</label>
            <input
              className={inputCls}
              value={form.location}
              onChange={(e) => setForm((current) => ({ ...current, location: e.target.value }))}
              placeholder="e.g. Hazira, Gujarat"
              maxLength={90}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={`${labelCls} mb-0`}>Allot machinery (available only)</label>
            <span className="text-xs text-muted-foreground">{form.machineIds.length} selected</span>
          </div>
          <div className="grid max-h-72 gap-1.5 overflow-y-auto rounded-md border border-border bg-background p-2 sm:grid-cols-2">
            {availableMachines.map((machine) => {
              const checked = form.machineIds.includes(machine.id);
              return (
                <label
                  key={machine.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition-colors ${
                    checked ? "border-accent bg-accent/10" : "border-transparent hover:bg-secondary"
                  }`}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleMachine(machine.id)} className="h-4 w-4 accent-[hsl(var(--accent))]" />
                  <div className="min-w-0">
                    <div className="font-medium">{machine.category}</div>
                    <div className="text-xs text-muted-foreground">
                      {machine.code} · {machine.name}
                    </div>
                  </div>
                </label>
              );
            })}
            {availableMachines.length === 0 && <div className="p-4 text-center text-sm text-muted-foreground">No available machinery to allot.</div>}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Link to="/" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createSiteMutation.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-card hover:opacity-90 disabled:opacity-50"
          >
            {createSiteMutation.isPending ? "Creating…" : "Create site"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewSite;
