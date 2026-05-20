import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Minus, Plus } from "lucide-react";
import type { Machine, Site } from "@/domain/types";
import { cn } from "@/lib/utils";
import {
  CLOSURE_ACTION_SIMPLE,
  buildDispositionsFromQtyLines,
  groupSiteMachinery,
  initialSimpleClosureState,
  relocationSiteOptions,
  simpleClosureStateValid,
  simpleStateToQtyLines,
  summarizeSimpleClosure,
  type SimpleClosureGroupState,
  type SiteClosureAction,
} from "@/lib/site-closure";
import { useCompleteSiteClosureMutation } from "@/hooks/useOperationalData";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type Props = {
  site: Site;
  machines: Machine[];
  sites: Site[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function QtyStepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-10 shrink-0"
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        aria-label="Decrease"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span className="min-w-[3rem] text-center text-2xl font-semibold tabular-nums">{value}</span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-10 shrink-0"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase"
      >
        <Plus className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">of {max}</span>
    </div>
  );
}

function OtherActionExtras({
  state,
  onChange,
  relocateTargets,
}: {
  state: SimpleClosureGroupState;
  onChange: (patch: Partial<SimpleClosureGroupState>) => void;
  relocateTargets: Site[];
}) {
  if (state.otherAction === "relocate") {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm">Which site?</Label>
        <Select value={state.relocateSiteId} onValueChange={(v) => onChange({ relocateSiteId: v })}>
          <SelectTrigger className="h-10 bg-background">
            <SelectValue placeholder="Pick a site" />
          </SelectTrigger>
          <SelectContent>
            {relocateTargets.length === 0 && (
              <SelectItem value="__none" disabled>
                No other active sites
              </SelectItem>
            )}
            {relocateTargets.map((target) => (
              <SelectItem key={target.id} value={target.id}>
                {target.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (state.otherAction === "lost_damaged") {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm">Note (optional)</Label>
        <Textarea
          rows={2}
          className="resize-none bg-background text-sm"
          placeholder="e.g. missing, broken beyond repair…"
          value={state.remarks}
          onChange={(e) => onChange({ remarks: e.target.value })}
        />
      </div>
    );
  }
  return null;
}

function OtherActionPick({
  state,
  onChange,
  relocateTargets,
  restCount,
}: {
  state: SimpleClosureGroupState;
  onChange: (patch: Partial<SimpleClosureGroupState>) => void;
  relocateTargets: Site[];
  restCount: number;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/50 p-4">
      <p className="text-sm font-medium text-amber-950">
        The other {restCount} unit{restCount === 1 ? "" : "s"} — what happened?
      </p>
      <Select
        value={state.otherAction}
        onValueChange={(v) =>
          onChange({
            otherAction: v as SiteClosureAction,
            relocateSiteId: "",
            remarks: "",
          })
        }
      >
        <SelectTrigger className="h-10 bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(["maintenance", "relocate", "lost_damaged"] as SiteClosureAction[]).map((action) => (
            <SelectItem key={action} value={action}>
              {CLOSURE_ACTION_SIMPLE[action]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <OtherActionExtras state={state} onChange={onChange} relocateTargets={relocateTargets} />
    </div>
  );
}

export function SiteFinishWorkflowDialog({ site, machines, sites, open, onOpenChange }: Props) {
  const completeMutation = useCompleteSiteClosureMutation();
  const groups = useMemo(() => groupSiteMachinery(machines, site.id), [machines, site.id]);
  const relocateTargets = useMemo(() => relocationSiteOptions(sites, site.id), [sites, site.id]);
  const totalUnits = groups.reduce((s, g) => s + g.count, 0);

  const [groupState, setGroupState] = useState<Record<string, SimpleClosureGroupState>>({});

  useEffect(() => {
    if (!open) return;
    setGroupState(initialSimpleClosureState(groups));
  }, [open, groups]);

  const updateGroup = (key: string, patch: Partial<SimpleClosureGroupState>) => {
    setGroupState((prev) => ({
      ...prev,
      [key]: {
        availableCount: 0,
        otherAction: "lost_damaged",
        relocateSiteId: "",
        remarks: "",
        ...prev[key],
        ...patch,
      },
    }));
  };

  const allValid = groups.every((g) => simpleClosureStateValid(groupState[g.key] ?? initialSimpleClosureState([g])[g.key], g.count));

  const handleComplete = () => {
    if (!allValid) {
      toast({
        title: "Check machinery entries",
        description: "Pick a destination site where needed, then try again.",
        variant: "destructive",
      });
      return;
    }

    const dispositions = groups.flatMap((group) => {
      const state = groupState[group.key];
      const lines = simpleStateToQtyLines(group, state);
      return buildDispositionsFromQtyLines([group], { [group.key]: lines });
    });

    completeMutation.mutate(
      {
        siteId: site.id,
        siteName: site.name,
        companyId: site.companyId,
        dispositions,
      },
      {
        onSuccess: () => {
          toast({
            title: "Site finished",
            description: `${site.name} is completed. All machinery has been accounted for.`,
          });
          onOpenChange(false);
        },
        onError: (err) => {
          toast({
            title: "Could not finish site",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Finish site — {site.name}</DialogTitle>
          <DialogDescription>
            Say what happened to each machinery type. Usually everything goes back to the company pool — you only
            change it when something else happened.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-8 text-center text-sm text-muted-foreground">
              No machinery on this site. You can finish it now.
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {totalUnits} unit{totalUnits === 1 ? "" : "s"} across {groups.length} type
                {groups.length === 1 ? "" : "s"} — defaults are already set for you.
              </p>

              {groups.map((group) => {
                const state =
                  groupState[group.key] ??
                  initialSimpleClosureState([group])[group.key];
                const rest = group.count - state.availableCount;
                const summary = summarizeSimpleClosure(state, group.count);

                return (
                  <div
                    key={group.key}
                    className={cn(
                      "rounded-xl border border-border bg-card p-4 shadow-sm space-y-4",
                      rest === 0 && "border-success/30",
                    )}
                  >
                    <div>
                      <h4 className="font-medium leading-snug">{group.label}</h4>
                      <p className="text-xs text-muted-foreground">
                        {group.category} · {group.count} unit{group.count === 1 ? "" : "s"} at this site
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
                    </div>

                    {group.count === 1 ? (
                      <div className="space-y-2">
                        <Label className="text-sm">What happens to this unit?</Label>
                        <Select
                          value={state.availableCount === 1 ? "available" : state.otherAction}
                          onValueChange={(v) => {
                            if (v === "available") {
                              updateGroup(group.key, { availableCount: 1 });
                            } else {
                              updateGroup(group.key, {
                                availableCount: 0,
                                otherAction: v as SiteClosureAction,
                              });
                            }
                          }}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(CLOSURE_ACTION_SIMPLE) as SiteClosureAction[]).map((action) => (
                              <SelectItem key={action} value={action}>
                                {CLOSURE_ACTION_SIMPLE[action]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {state.availableCount === 0 && (
                          <OtherActionExtras
                            state={state}
                            onChange={(patch) => updateGroup(group.key, patch)}
                            relocateTargets={relocateTargets}
                          />
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label className="text-sm">How many came back to the company pool?</Label>
                          <p className="text-xs text-muted-foreground">Use − and + to adjust. Most of the time this is all of them.</p>
                          <QtyStepper
                            value={state.availableCount}
                            max={group.count}
                            onChange={(n) => updateGroup(group.key, { availableCount: n })}
                          />
                        </div>

                        {rest > 0 && (
                          <OtherActionPick
                            state={state}
                            onChange={(patch) => updateGroup(group.key, patch)}
                            relocateTargets={relocateTargets}
                            restCount={rest}
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleComplete}
            disabled={!allValid || completeMutation.isPending}
            className="gap-1.5"
          >
            <CheckCircle2 className="h-4 w-4" />
            {completeMutation.isPending ? "Finishing…" : "Finish site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
