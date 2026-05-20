import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { MachineryCategory } from "@/domain/types";
import { MACHINERY_CATEGORIES } from "@/domain/types";
import { ArrowLeft, Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/lib/session";
import { canCreateMachineryRequest } from "@/lib/rbac";
import { useScopedSites, useScopedMachines, useScopedRequests } from "@/hooks/useCompanyScope";
import { useCreateRequestMutation } from "@/hooks/useOperationalData";

type RequestSourceType = "available" | "transfer" | "purchase";
const MAX_REQUESTER_OPTIONS = 12;

const NewRequest = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const siteParam = params.get("site") ?? "";
  const sites = useScopedSites();
  const machines = useScopedMachines();
  const requests = useScopedRequests();
  const createRequestMutation = useCreateRequestMutation();
  const user = useCurrentUser();
  const eligibleSites = useMemo(
    () =>
      user.role === "site_manager"
        ? sites.filter((site) => user.assignedSiteIds.includes(site.id))
        : [...sites],
    [sites, user.role, user.assignedSiteIds],
  );

  const available = machines.filter((m) => m.status === "available");
  const categoryOptions = useMemo(
    () => Array.from(new Set([...MACHINERY_CATEGORIES, ...machines.map((machine) => machine.category)])).sort(),
    [machines],
  );
  const defaultRequesterOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...eligibleSites.map((site) => site.manager),
          ...requests.map((request) => request.requester),
          "Operations Lead",
          "Project Coordinator",
          user.role === "super_admin" ? user.name : "",
        ]),
      )
        .filter(Boolean)
        .sort()
        .slice(0, MAX_REQUESTER_OPTIONS),
    [eligibleSites, requests, user.name, user.role],
  );

  const [form, setForm] = useState({
    siteId: "",
    sourceType: "available" as RequestSourceType,
    sourceSiteId: "",
    requestedCategory: "" as MachineryCategory | "__new__" | "",
    requestedQuantity: 1,
    requester: "",
    reason: "",
    neededFrom: "",
    neededUntil: "",
    machineIds: [] as string[],
  });
  const [customCategory, setCustomCategory] = useState("");
  const [requesterOptions, setRequesterOptions] = useState(defaultRequesterOptions);
  const [requesterMenuOpen, setRequesterMenuOpen] = useState(false);
  const [editingRequesterName, setEditingRequesterName] = useState<string | null>(null);
  const [editingRequesterValue, setEditingRequesterValue] = useState("");
  const [isAddingRequester, setIsAddingRequester] = useState(false);
  const [newRequesterValue, setNewRequesterValue] = useState("");

  useEffect(() => {
    setForm((current) => {
      const ids = eligibleSites.map((s) => s.id);
      const nextSiteId =
        siteParam && ids.includes(siteParam)
          ? siteParam
          : ids.includes(current.siteId)
            ? current.siteId
            : ids[0] ?? "";
      if (!nextSiteId || nextSiteId === current.siteId) return current;
      const ts = eligibleSites.filter((site) => site.id !== nextSiteId);
      const nextSourceSiteId =
        current.sourceType === "transfer"
          ? ts.find((s) => s.id === current.sourceSiteId)?.id ?? ts[0]?.id ?? ""
          : current.sourceSiteId;
      return {
        ...current,
        siteId: nextSiteId,
        sourceSiteId: nextSourceSiteId,
        machineIds: current.sourceType === "transfer" ? [] : current.machineIds,
      };
    });
  }, [eligibleSites, siteParam]);

  useEffect(() => {
    if (user.role === "site_manager") {
      setForm((f) => ({ ...f, requester: user.name }));
    }
  }, [user.name, user.role]);

  const toggleMachine = (id: string) =>
    setForm((f) => ({ ...f, machineIds: f.machineIds.includes(id) ? f.machineIds.filter((x) => x !== id) : [...f.machineIds, id] }));

  const transferSites = useMemo(
    () => eligibleSites.filter((site) => site.id !== form.siteId),
    [eligibleSites, form.siteId],
  );

  const transferMachines = useMemo(
    () =>
      machines.filter(
        (machine) => machine.status === "assigned" && machine.assignedSiteId === form.sourceSiteId,
      ),
    [machines, form.sourceSiteId],
  );

  if (!canCreateMachineryRequest(user.role)) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Your role cannot create machinery requests. Firm Admins delegate Site Managers on the Team page so they may raise requests.
      </div>
    );
  }

  if (eligibleSites.length === 0) {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <Link to="/requests" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to requests
        </Link>
        <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
          No sites are assigned to your account yet. Ask your Firm Admin to assign sites before raising requests.
        </div>
      </div>
    );
  }

  const setSourceType = (sourceType: RequestSourceType) => {
    setForm((current) => ({
      ...current,
      sourceType,
      machineIds: [],
      sourceSiteId: sourceType === "transfer" ? transferSites[0]?.id ?? "" : "",
      requestedCategory: sourceType === "purchase" ? current.requestedCategory : "",
      requestedQuantity: sourceType === "purchase" ? current.requestedQuantity : 1,
    }));
  };

  const selectRequester = (name: string) => {
    setForm((current) => ({ ...current, requester: name }));
    setRequesterMenuOpen(false);
  };

  const addRequester = () => {
    const normalized = newRequesterValue.trim();
    if (!normalized) {
      toast({ title: "Invalid name", description: "Requester name cannot be empty.", variant: "destructive" });
      return;
    }
    if (requesterOptions.includes(normalized)) {
      toast({ title: "Duplicate name", description: "Requester already exists.", variant: "destructive" });
      return;
    }
    if (requesterOptions.length >= MAX_REQUESTER_OPTIONS) {
      toast({
        title: "Requester limit reached",
        description: `For demo, keep up to ${MAX_REQUESTER_OPTIONS} names. Delete one to add another.`,
        variant: "destructive",
      });
      return;
    }
    setRequesterOptions((current) => [...current, normalized].sort((a, b) => a.localeCompare(b)));
    setForm((current) => ({ ...current, requester: normalized }));
    setIsAddingRequester(false);
    setNewRequesterValue("");
    setRequesterMenuOpen(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.requester.trim() || !form.reason.trim() || !form.neededFrom || !form.neededUntil) {
      toast({ title: "Missing fields", description: "Please fill all mandatory fields.", variant: "destructive" });
      return;
    }
    if (form.neededFrom > form.neededUntil) {
      toast({ title: "Invalid dates", description: "Needed until must be after needed from.", variant: "destructive" });
      return;
    }
    const purchaseCategory =
      form.sourceType === "purchase"
        ? (form.requestedCategory === "__new__" ? customCategory.trim() : form.requestedCategory)
        : "";

    if (form.sourceType === "purchase") {
      if (!purchaseCategory || form.requestedQuantity < 1) {
        toast({ title: "Missing fields", description: "Choose machinery category and quantity to buy.", variant: "destructive" });
        return;
      }
    } else if (form.machineIds.length === 0) {
      toast({ title: "Missing fields", description: "Select at least one machine.", variant: "destructive" });
      return;
    }
    if (form.sourceType === "transfer" && !form.sourceSiteId) {
      toast({ title: "Missing fields", description: "Select a source site for transfer.", variant: "destructive" });
      return;
    }
    if (!eligibleSites.some((s) => s.id === form.siteId)) {
      toast({ title: "Invalid site", description: "You can only submit for sites you have access to.", variant: "destructive" });
      return;
    }

    void createRequestMutation
      .mutateAsync({
        siteId: form.siteId,
        sourceType: form.sourceType,
        sourceSiteId: form.sourceType === "transfer" ? form.sourceSiteId : undefined,
        requestedCategory: form.sourceType === "purchase" ? (purchaseCategory as MachineryCategory) : undefined,
        requestedQuantity: form.sourceType === "purchase" ? form.requestedQuantity : undefined,
        requester: form.requester,
        reason: form.reason,
        neededFrom: form.neededFrom,
        neededUntil: form.neededUntil,
        machineIds: form.sourceType === "purchase" ? [] : form.machineIds,
      })
      .then(() => {
        toast({ title: "Request submitted", description: "Awaiting approval." });
        navigate("/requests");
      })
      .catch((err) =>
        toast({
          title: "Request failed",
          description: err instanceof Error ? err.message : "Try again.",
          variant: "destructive",
        }),
      );
  };

  const inputCls = "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30";
  const labelCls = "block text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/requests" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to requests
      </Link>

      <form onSubmit={submit} className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-card">
        <div>
          <h2 className="font-display text-xl font-semibold">New Machinery Request</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose request type, then submit machinery needs for approval.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Target site</label>
            <select
              className={inputCls}
              value={form.siteId}
              onChange={(e) =>
                setForm((current) => {
                  const nextSiteId = e.target.value;
                  const nextTransferSites = eligibleSites.filter((site) => site.id !== nextSiteId);
                  const nextSourceSiteId =
                    current.sourceType === "transfer"
                      ? nextTransferSites.find((site) => site.id === current.sourceSiteId)?.id ?? nextTransferSites[0]?.id ?? ""
                      : current.sourceSiteId;
                  return {
                    ...current,
                    siteId: nextSiteId,
                    sourceSiteId: nextSourceSiteId,
                    machineIds: current.sourceType === "transfer" ? [] : current.machineIds,
                  };
                })
              }
            >
              {eligibleSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Requester name</label>
            {user.role === "site_manager" ? (
              <input type="text" className={inputCls} readOnly value={user.name} title="Recorded as your account name for accountability." />
            ) : (
            <DropdownMenu open={requesterMenuOpen} onOpenChange={setRequesterMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button type="button" className={inputCls + " flex items-center justify-between"}>
                  <span className={form.requester ? "text-foreground" : "text-muted-foreground"}>
                    {form.requester || "Select requester"}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-72 overflow-y-auto p-2" align="start">
                {requesterOptions.map((name) => {
                  const isEditing = editingRequesterName === name;
                  return (
                    <div key={name} className="mb-1 flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-accent">
                      {isEditing ? (
                        <input
                          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none"
                          value={editingRequesterValue}
                          onChange={(e) => setEditingRequesterValue(e.target.value)}
                          maxLength={80}
                        />
                      ) : (
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1 text-left text-sm"
                          onClick={() => selectRequester(name)}
                        >
                          {form.requester === name && <Check className="h-3.5 w-3.5 shrink-0" />}
                          <span className="truncate">{name}</span>
                        </button>
                      )}
                      <div className="flex items-center gap-0.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              aria-label="Save requester name"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const normalized = editingRequesterValue.trim();
                                if (!normalized) {
                                  toast({ title: "Invalid name", description: "Requester name cannot be empty.", variant: "destructive" });
                                  return;
                                }
                                if (normalized !== name && requesterOptions.includes(normalized)) {
                                  toast({ title: "Duplicate name", description: "Requester already exists.", variant: "destructive" });
                                  return;
                                }
                                setRequesterOptions((current) =>
                                  current
                                    .map((item) => (item === name ? normalized : item))
                                    .sort((a, b) => a.localeCompare(b))
                                );
                                setForm((current) => ({
                                  ...current,
                                  requester: current.requester === name ? normalized : current.requester,
                                }));
                                setEditingRequesterName(null);
                                setEditingRequesterValue("");
                              }}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              aria-label="Cancel editing requester name"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingRequesterName(null);
                                setEditingRequesterValue("");
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              aria-label="Edit requester name"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setEditingRequesterName(name);
                                setEditingRequesterValue(name);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label="Delete requester name"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setRequesterOptions((current) => current.filter((item) => item !== name));
                                setForm((current) => ({
                                  ...current,
                                  requester: current.requester === name ? "" : current.requester,
                                }));
                                if (editingRequesterName === name) {
                                  setEditingRequesterName(null);
                                  setEditingRequesterValue("");
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
                <DropdownMenuSeparator />
                {isAddingRequester ? (
                  <div className="flex items-center gap-1 px-1 py-1">
                    <input
                      className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none"
                      value={newRequesterValue}
                      onChange={(e) => setNewRequesterValue(e.target.value)}
                      maxLength={80}
                      placeholder="Enter new name"
                    />
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label="Save requester name"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        addRequester();
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      aria-label="Cancel add requester name"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsAddingRequester(false);
                        setNewRequesterValue("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsAddingRequester(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add new name
                  </button>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>
          <div>
            <label className={labelCls}>Needed from</label>
            <input type="date" className={inputCls} value={form.neededFrom} onChange={(e) => setForm({ ...form, neededFrom: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Needed until</label>
            <input type="date" className={inputCls} value={form.neededUntil} onChange={(e) => setForm({ ...form, neededUntil: e.target.value })} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Request source</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              { id: "available", title: "From available stock" },
              { id: "transfer", title: "Transfer from another site" },
              { id: "purchase", title: "Buy new machinery" },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSourceType(option.id)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  form.sourceType === option.id
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.title}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Reason</label>
          <textarea className={inputCls} rows={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why is this machinery needed?" />
        </div>

        {form.sourceType !== "purchase" && (
          <div>
            {form.sourceType === "transfer" && (
              <div className="mb-3">
                <label className={labelCls}>Source site</label>
                <select
                  className={inputCls}
                  value={form.sourceSiteId}
                  onChange={(e) => setForm((current) => ({ ...current, sourceSiteId: e.target.value, machineIds: [] }))}
                >
                  <option value="">Select source site</option>
                  {transferSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name} ({site.code})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-2 flex items-center justify-between">
              <label className={labelCls + " mb-0"}>
                {form.sourceType === "transfer" ? "Machinery at source site" : "Available machinery"}
              </label>
              <span className="text-xs text-muted-foreground">{form.machineIds.length} selected</span>
            </div>
            <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-md border border-border bg-background p-2 sm:grid-cols-2">
              {(form.sourceType === "transfer" ? transferMachines : available).map((machine) => {
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
                      <div className="text-xs text-muted-foreground">{machine.code}</div>
                    </div>
                  </label>
                );
              })}
              {(form.sourceType === "transfer" ? transferMachines.length === 0 : available.length === 0) && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {form.sourceType === "transfer" ? "No assigned machinery on selected site." : "No available machinery."}
                </div>
              )}
            </div>
          </div>
        )}

        {form.sourceType === "purchase" && (
          <div className="grid gap-4 rounded-md border border-border bg-background p-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Machinery category</label>
              <select
                className={inputCls}
                value={form.requestedCategory}
                onChange={(e) => setForm((current) => ({ ...current, requestedCategory: e.target.value as MachineryCategory }))}
              >
                <option value="">Select category</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
                <option value="__new__">+ Add new category</option>
              </select>
            </div>
            {form.requestedCategory === "__new__" && (
              <div>
                <label className={labelCls}>New category name</label>
                <input
                  className={inputCls}
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Plasma Cutter"
                />
              </div>
            )}
            <div>
              <label className={labelCls}>Units to purchase</label>
              <input
                type="number"
                min={1}
                max={50}
                className={inputCls}
                value={form.requestedQuantity}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    requestedQuantity: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Link to="/requests" className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary">Cancel</Link>
          <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-card hover:opacity-90">
            Submit request
          </button>
        </div>
      </form>
    </div>
  );
};

export default NewRequest;
