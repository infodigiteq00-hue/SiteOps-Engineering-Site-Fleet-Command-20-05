import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapPin, MoreVertical, Pencil, Users, CheckCircle, RotateCcw, Trash2 } from "lucide-react";
import type { Site, SiteClosureSummary } from "@/domain/types";
import { closureReturnedPercent } from "@/lib/site-closure-summary";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDeleteSiteMutation, useUpdateSiteMutation } from "@/hooks/useOperationalData";
import { canUpdateSite } from "@/lib/rbac";
import { useScopedMachines, useScopedSites } from "@/hooks/useCompanyScope";
import { SiteFinishWorkflowDialog } from "@/components/SiteFinishWorkflowDialog";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/lib/session";
import { toast } from "@/hooks/use-toast";

type ProfilePick = { id: string; full_name: string | null; email: string | null };

function parseManagerTokens(manager: string): string[] {
  return manager
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function guessSelectedProfileIds(manager: string, profiles: ProfilePick[]): Set<string> {
  const tokens = parseManagerTokens(manager).map((t) => t.toLowerCase());
  if (tokens.length === 0) return new Set();
  const next = new Set<string>();
  profiles.forEach((p) => {
    const name = (p.full_name ?? "").trim().toLowerCase();
    const email = (p.email ?? "").trim().toLowerCase();
    if (tokens.some((t) => (name && (name === t || name.includes(t))) || (email && email.includes(t)))) {
      next.add(p.id);
    }
  });
  return next;
}

type Props = {
  site: Site;
  machineryCount: number;
  deploymentPercent: number;
  closureSummary?: SiteClosureSummary | null;
};

export function SiteDashboardCard({ site, machineryCount, deploymentPercent, closureSummary }: Props) {
  const isFinished = site.status === "completed";
  const displayUnits = isFinished && closureSummary ? closureSummary.totalUnits : machineryCount;
  const displayPct =
    isFinished && closureSummary
      ? closureReturnedPercent(closureSummary)
      : deploymentPercent;
  const unitsLabel = isFinished ? "Units at closure" : "Machinery";
  const metricLabel = isFinished ? "Returned to pool" : "Deployment";
  const footerLabel = isFinished ? "View closure report" : "Site utilization overview";
  const user = useCurrentUser();
  const updateSite = useUpdateSiteMutation();
  const deleteSite = useDeleteSiteMutation();

  const canUpdate = canUpdateSite(user.role);
  const canDelete = user.role === "super_admin" || user.role === "firm_admin";

  const canPickTeamProfiles = user.role === "super_admin" || user.role === "firm_admin";

  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(site.name);

  const [managersOpen, setManagersOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfilePick[]>([]);
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(new Set());
  const [managersTextDraft, setManagersTextDraft] = useState(site.manager);
  const [profilesLoading, setProfilesLoading] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);

  const allMachines = useScopedMachines();
  const allSites = useScopedSites();

  useEffect(() => {
    if (!nameOpen) return;
    setNameDraft(site.name);
  }, [nameOpen, site.name]);

  useEffect(() => {
    if (!managersOpen) return;
    setManagersTextDraft(site.manager);
    if (!canPickTeamProfiles || !isSupabaseConfigured) {
      setProfiles([]);
      setSelectedProfileIds(new Set());
      return;
    }
    let cancelled = false;
    setProfilesLoading(true);
    void (async () => {
      const companyId = site.companyId;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("company_id", companyId)
        .order("full_name", { ascending: true });
      if (cancelled) return;
      setProfilesLoading(false);
      if (error) {
        setProfiles([]);
        toast({ title: "Could not load team", description: error.message, variant: "destructive" });
        return;
      }
      const rows = (data ?? []) as ProfilePick[];
      setProfiles(rows);
      setSelectedProfileIds(guessSelectedProfileIds(site.manager, rows));
    })();
    return () => {
      cancelled = true;
    };
  }, [managersOpen, site.companyId, site.manager, canPickTeamProfiles]);

  const toggleProfile = useCallback((id: string) => {
    setSelectedProfileIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const saveName = () => {
    const next = nameDraft.trim();
    if (!next) {
      toast({ title: "Name required", description: "Enter a site name.", variant: "destructive" });
      return;
    }
    updateSite.mutate(
      { siteId: site.id, companyId: site.companyId, name: next },
      {
        onSuccess: () => {
          toast({ title: "Site updated", description: "Site name saved." });
          setNameOpen(false);
        },
        onError: (err) =>
          toast({
            title: "Could not save",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const saveManagers = () => {
    let managerValue: string;
    const fromPicker =
      canPickTeamProfiles && profiles.length > 0 && selectedProfileIds.size > 0
        ? profiles
            .filter((p) => selectedProfileIds.has(p.id))
            .map((p) => (p.full_name ?? "").trim() || p.email?.trim() || p.id)
            .join("; ")
            .trim()
        : "";

    if (fromPicker) {
      managerValue = fromPicker;
    } else {
      managerValue = managersTextDraft.trim();
      if (!managerValue) {
        toast({
          title: "Managers required",
          description: canPickTeamProfiles
            ? "Select team members or enter names in the text box."
            : "Enter at least one name, separated by commas.",
          variant: "destructive",
        });
        return;
      }
    }

    updateSite.mutate(
      { siteId: site.id, companyId: site.companyId, manager: managerValue },
      {
        onSuccess: () => {
          toast({ title: "Site updated", description: "Site managers saved." });
          setManagersOpen(false);
        },
        onError: (err) =>
          toast({
            title: "Could not save",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const resumeSite = () => {
    updateSite.mutate(
      { siteId: site.id, companyId: site.companyId, status: "active" },
      {
        onSuccess: () => {
          toast({ title: "Site resumed", description: `${site.name} is active again.` });
        },
        onError: (err) =>
          toast({
            title: "Could not update",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const confirmDelete = () => {
    deleteSite.mutate(
      { siteId: site.id, companyId: site.companyId, siteName: site.name },
      {
        onSuccess: () => {
          toast({ title: "Site deleted", description: `${site.name} was removed.` });
          setDeleteOpen(false);
        },
        onError: (err) =>
          toast({
            title: "Could not delete site",
            description: err instanceof Error ? err.message : "Check for linked data or permissions.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <>
      <div className="group relative rounded-xl border border-border/80 bg-card/95 shadow-card transition-all hover:-translate-y-0.5 hover:border-info/35 hover:shadow-elevated">
        {canUpdate && (
          <div className="absolute right-2 top-2 z-20">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-8 w-8 border border-border/80 bg-card/95 shadow-sm hover:bg-card"
                  aria-label={`Site actions for ${site.name}`}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[100] w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => {
                    setNameOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit site name
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => {
                    setManagersOpen(true);
                  }}
                >
                  <Users className="h-3.5 w-3.5" />
                  Edit site managers
                </DropdownMenuItem>
                {site.status === "completed" ? (
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => {
                      resumeSite();
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Resume site
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className="gap-2"
                    onSelect={() => {
                      setFinishOpen(true);
                    }}
                  >
                    <CheckCircle className="h-3.5 w-3.5" />
                    Site finished
                  </DropdownMenuItem>
                )}
                {canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-2 text-destructive focus:text-destructive"
                      onSelect={() => {
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete site
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <Link
          to={`/sites/${site.id}`}
          className="block p-4 pr-12 transition-colors group-hover:text-inherit"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{site.code}</div>
              <div className="mt-0.5 truncate font-display text-base font-semibold group-hover:text-info">{site.name}</div>
              <div className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" />
                {site.location}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
              <StatusBadge status={site.status} />
              <div className="leading-none">
                <div className="font-display text-3xl font-bold tabular-nums text-foreground">{displayUnits}</div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{unitsLabel}</div>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{metricLabel}</span>
              <span className="font-medium tabular-nums">{displayPct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-gradient-accent" style={{ width: `${displayPct}%` }} />
            </div>
            {isFinished && closureSummary && closureSummary.lost_damaged > 0 && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {closureSummary.lost_damaged} lost/damaged · {closureSummary.relocate} relocated · {closureSummary.maintenance} maintenance
              </p>
            )}
          </div>
          <div className="mt-3 border-t border-border/80 pt-3 text-xs font-medium text-muted-foreground group-hover:text-foreground">
            {footerLabel}
          </div>
        </Link>
      </div>

      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent className="z-[110] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit site name</DialogTitle>
            <DialogDescription>Update the display name for this deployment.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor={`site-name-${site.id}`}>Site name</Label>
            <Input
              id={`site-name-${site.id}`}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNameOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveName} disabled={updateSite.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={managersOpen} onOpenChange={setManagersOpen}>
        <DialogContent className="z-[110] max-h-[85vh] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit site managers</DialogTitle>
            <DialogDescription>
              {canPickTeamProfiles
                ? "Select one or more people from your company. Names are stored on the site record."
                : "Enter manager names separated by commas (e.g. Priya Sharma, Raj Patel)."}
            </DialogDescription>
          </DialogHeader>

          {canPickTeamProfiles && profiles.length > 0 ? (
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border border-border p-2">
              {profilesLoading ? (
                <p className="text-sm text-muted-foreground">Loading team…</p>
              ) : (
                profiles.map((p) => {
                  const label = (p.full_name ?? "").trim() || p.email || p.id;
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={selectedProfileIds.has(p.id)}
                        onCheckedChange={() => {
                          toggleProfile(p.id);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {p.email && p.full_name ? (
                        <span className="truncate text-xs text-muted-foreground">{p.email}</span>
                      ) : null}
                    </label>
                  );
                })
              )}
            </div>
          ) : null}

          {canPickTeamProfiles && profiles.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Use the checklist, or type names below. If the text box is filled and no one is checked, the text box is saved.
            </p>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor={`site-managers-text-${site.id}`}>
              {canPickTeamProfiles && profiles.length > 0 ? "Managers (free text)" : "Site managers"}
            </Label>
            <Textarea
              id={`site-managers-text-${site.id}`}
              rows={3}
              value={managersTextDraft}
              onChange={(e) => setManagersTextDraft(e.target.value)}
              placeholder="e.g. Anita Sharma, Vikram Patel"
              className="resize-none"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setManagersOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveManagers} disabled={updateSite.isPending}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SiteFinishWorkflowDialog
        site={site}
        machines={allMachines}
        sites={allSites}
        open={finishOpen}
        onOpenChange={setFinishOpen}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="z-[110] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete site?</DialogTitle>
            <DialogDescription>
              This removes <strong>{site.name}</strong> from the directory. Machinery on this site will be unassigned (pool).
              Related requests may be removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDelete} disabled={deleteSite.isPending}>
              Delete site
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
