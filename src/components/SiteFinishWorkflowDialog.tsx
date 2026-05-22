import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Minus, Plus } from "lucide-react";
import type { Machine, Site } from "@/domain/types";
import { cn } from "@/lib/utils";
import {
  CLOSURE_ACTION_SIMPLE,
  buildDispositionsFromQtyLines,
  formatSiteClosureGroupQty,
  groupSiteMachinery,
  initialSimpleClosureState,
  remainderUnitsForGroup,
  relocationSiteOptions,
  simpleClosureStateValid,
  simpleStateToQtyLines,
  summarizeSimpleClosure,
  usesContinuousQuantity,
  usesDetailedRemainderClosure,
  type ClosureUnitState,
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
import { formatMutationError } from "@/lib/mutation-errors";

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

function UnitActionExtras({
  state,
  onChange,
  relocateTargets,
}: {
  state: ClosureUnitState;
  onChange: (patch: Partial<ClosureUnitState>) => void;
  relocateTargets: Site[];
}) {
  if (state.action === "relocate") {
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
  if (state.action === "lost_damaged") {
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

function OtherActionExtras({
  state,
  onChange,
  relocateTargets,
}: {
  state: SimpleClosureGroupState;
  onChange: (patch: Partial<SimpleClosureGroupState>) => void;
  relocateTargets: Site[];
}) {
  return (
    <UnitActionExtras
      state={{
        action: state.otherAction,
        relocateSiteId: state.relocateSiteId,
        remarks: state.remarks,
      }}
      onChange={(patch) => onChange(patch)}
      relocateTargets={relocateTargets}
    />
  );
}

function RemainderUnitRow({
  unitLabel,
  state,
  onChange,
  relocateTargets,
}: {
  unitLabel: string;
  state: ClosureUnitState;
  onChange: (patch: Partial<ClosureUnitState>) => void;
  relocateTargets: Site[];
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border/80 bg-secondary/20 p-3">
      <p className="text-xs font-medium text-foreground">{unitLabel}</p>
      <Select
        value={state.action}
        onValueChange={(v) =>
          onChange({
            action: v as SiteClosureAction,
            relocateSiteId: "",
            remarks: "",
          })
        }
      >
        <SelectTrigger className="h-9 bg-background text-sm">
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
      <UnitActionExtras state={state} onChange={onChange} relocateTargets={relocateTargets} />
    </div>
  );
}

function OtherActionPick({
  state,
  onChange,
  relocateTargets,
  restLabel,
}: {
  state: SimpleClosureGroupState;
  onChange: (patch: Partial<SimpleClosureGroupState>) => void;
  relocateTargets: Site[];
  restLabel: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/50 p-4">
      <p className="text-sm font-medium text-amber-950">The other {restLabel} — what happened?</p>
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
    setGroupState((prev) => {
      const group = groups.find((g) => g.key === key);
      const prior = prev[key] ?? (group ? initialSimpleClosureState([group])[key] : undefined);
      if (!prior) return prev;
      return {
        ...prev,
        [key]: {
          ...prior,
          ...patch,
          ...(patch.remainderByUnitId
            ? { remainderByUnitId: { ...prior.remainderByUnitId, ...patch.remainderByUnitId } }
            : {}),
        },
      };
    });
  };

  const updateRemainderUnit = (groupKey: string, unitId: string, patch: Partial<ClosureUnitState>) => {
    setGroupState((prev) => {
      const prior = prev[groupKey];
      if (!prior) return prev;
      return {
        ...prev,
        [groupKey]: {
          ...prior,
          remainderByUnitId: {
            ...prior.remainderByUnitId,
            [unitId]: {
              action: "lost_damaged",
              relocateSiteId: "",
              remarks: "",
              ...prior.remainderByUnitId[unitId],
              ...patch,
            },
          },
        },
      };
    });
  };

  const allValid = groups.every((g) => {
    const state = groupState[g.key] ?? initialSimpleClosureState([g])[g.key];
    return simpleClosureStateValid(state, g.count, g);
  });

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
      const state = groupState[group.key] ?? initialSimpleClosureState([group])[group.key];
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
            description: formatMutationError(err),
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
            Grouped by machinery type — set how many came back to the pool, then only fill in details for the rest.
            Usually everything returns; change it only when something else happened.
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
                const summary = summarizeSimpleClosure(state, group.count, group.unitType, group);
                const continuous = usesContinuousQuantity(group.unitType);
                const atSiteQty = formatSiteClosureGroupQty(group.count, group.unitType);
                const remainderUnits = remainderUnitsForGroup(group, state.availableCount);
                const detailedRemainder = usesDetailedRemainderClosure(rest);

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
                        {group.category} · {atSiteQty} at this site
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
                    </div>

                    {group.count === 1 ? (
                      <div className="space-y-2">
                        <Label className="text-sm">What happens to this {continuous ? group.unitType : "unit"}?</Label>
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
                          <Label className="text-sm">
                            {continuous
                              ? `How much came back to the company pool?`
                              : "How many came back to the company pool?"}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Use − and + (max {atSiteQty}). Most of the time this is all of them.
                          </p>
                          <QtyStepper
                            value={state.availableCount}
                            max={group.count}
                            onChange={(n) => updateGroup(group.key, { availableCount: n })}
                          />
                        </div>

                        {rest > 0 && detailedRemainder && (
                          <div className="space-y-3 rounded-lg border border-amber-200/80 bg-amber-50/50 p-4">
                            <p className="text-sm font-medium text-amber-950">
                              The other {formatSiteClosureGroupQty(rest, group.unitType)} — what happened?
                            </p>
                            <div className="space-y-2">
                              {remainderUnits.map((unit) => (
                                <RemainderUnitRow
                                  key={unit.id}
                                  unitLabel={unit.name}
                                  state={
                                    state.remainderByUnitId[unit.id] ?? {
                                      action: "lost_damaged",
                                      relocateSiteId: "",
                                      remarks: "",
                                    }
                                  }
                                  onChange={(patch) => updateRemainderUnit(group.key, unit.id, patch)}
                                  relocateTargets={relocateTargets}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {rest > 0 && !detailedRemainder && (
                          <OtherActionPick
                            state={state}
                            onChange={(patch) => updateGroup(group.key, patch)}
                            relocateTargets={relocateTargets}
                            restLabel={formatSiteClosureGroupQty(rest, group.unitType)}
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
