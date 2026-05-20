import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useScopedSites, useScopedMachines } from "@/hooks/useCompanyScope";
import { useApproveRequestMutation, useRejectRequestMutation } from "@/hooks/useOperationalData";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { Plus, Check, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useScopedRequests } from "@/hooks/useCompanyScope";
import { useCurrentUser, ROLE_LABELS } from "@/lib/session";
import { canApproveRequests, canCreateMachineryRequest } from "@/lib/rbac";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const Requests = () => {
  const sites = useScopedSites();
  const machines = useScopedMachines();
  const approveMutation = useApproveRequestMutation();
  const rejectMutation = useRejectRequestMutation();
  const scopedRequests = useScopedRequests();
  const user = useCurrentUser();
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [decision, setDecision] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");

  const list = useMemo(() => scopedRequests.filter((r) => r.status === tab), [scopedRequests, tab]);
  const canAct = canApproveRequests(user.role);
  const showNewRequest = canCreateMachineryRequest(user.role);

  const submitDecision = () => {
    if (!decision) return;
    const payload = {
      actorName: user.name,
      actorRole: ROLE_LABELS[user.role],
      notes: decisionNotes.trim() || undefined,
    };
    const done = () => {
      setDecision(null);
      setDecisionNotes("");
    };
    if (decision.action === "approve") {
      void approveMutation
        .mutateAsync({ id: decision.id, decision: payload })
        .then(() => {
          toast({ title: "Request approved", description: "Machinery allocated and ledger updated." });
          done();
        })
        .catch((err) =>
          toast({
            title: "Approval failed",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          }),
        );
    } else {
      void rejectMutation
        .mutateAsync({ id: decision.id, decision: payload })
        .then(() => {
          toast({ title: "Request rejected" });
          done();
        })
        .catch((err) =>
          toast({
            title: "Rejection failed",
            description: err instanceof Error ? err.message : "Try again.",
            variant: "destructive",
          }),
        );
    }
  };

  const openDecision = (id: string, action: "approve" | "reject") => {
    setDecisionNotes("");
    setDecision({ id, action });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1 shadow-card">
          {(["pending", "approved", "rejected"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}{" "}
              <span className="ml-1 text-xs opacity-70">{scopedRequests.filter((r) => r.status === t).length}</span>
            </button>
          ))}
        </div>
        {showNewRequest ? (
          <Link
            to="/requests/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-card transition-colors hover:bg-blue-500"
          >
            <Plus className="h-4 w-4" /> New request
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">
            Machinery requests are raised by Site Managers (and Super Admin when auditing).
          </span>
        )}
      </div>

      <Dialog
        open={Boolean(decision)}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.action === "approve" ? "Approve request" : "Reject request"}</DialogTitle>
            <DialogDescription>
              Decision is recorded under <span className="font-medium text-foreground">{user.name}</span> (
              {ROLE_LABELS[user.role]}) with a timestamp. Optional notes support operational accountability.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={decisionNotes}
            onChange={(e) => setDecisionNotes(e.target.value)}
            placeholder="Optional notes for the audit trail..."
            rows={3}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button type="button" variant={decision?.action === "reject" ? "destructive" : "default"} onClick={submitDecision}>
              Confirm {decision?.action === "approve" ? "approval" : "rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-3">
        {list.map((r) => {
          const site = sites.find((s) => s.id === r.siteId);
          const sourceSite = r.sourceSiteId ? sites.find((s) => s.id === r.sourceSiteId) : null;
          const reqMachines = machines.filter((m) => r.machineIds.includes(m.id));
          const totalUnits = r.sourceType === "purchase" ? r.requestedQuantity ?? 0 : r.machineIds.length;
          const sourceLabel =
            r.sourceType === "available"
              ? "From available stock"
              : r.sourceType === "transfer"
                ? `Transfer from ${sourceSite?.name ?? "another site"}`
                : "Buy new machinery";
          return (
            <div key={r.id} className="rounded-xl border border-border bg-card p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-base font-semibold">{site?.name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Requested by <span className="font-medium text-foreground">{r.requester}</span> ·{" "}
                    {format(new Date(r.requestedAt), "dd MMM yyyy, HH:mm")}
                  </div>
                </div>
                {r.status === "pending" && canAct && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openDecision(r.id, "reject")}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => openDecision(r.id, "approve")}
                      className="inline-flex items-center gap-1 rounded-md bg-success px-3 py-1.5 text-sm font-semibold text-success-foreground hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{r.reason}</p>

              {(r.status === "approved" || r.status === "rejected") && r.decidedAt && r.decidedBy && (
                <div className="mt-4 rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  <div className="font-semibold text-foreground">
                    {r.status === "approved" ? "Approved" : "Rejected"} by {r.decidedBy}
                    {r.deciderRole ? <span className="font-normal text-muted-foreground"> · {r.deciderRole}</span> : null}
                  </div>
                  <div className="mt-1 tabular-nums">{format(new Date(r.decidedAt), "dd MMM yyyy, HH:mm")}</div>
                  {r.decisionNotes ? (
                    <div className="mt-2 whitespace-pre-wrap text-foreground">{r.decisionNotes}</div>
                  ) : null}
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Period</div>
                  <div className="text-sm font-medium">
                    {format(new Date(r.neededFrom), "dd MMM")} – {format(new Date(r.neededUntil), "dd MMM yyyy")}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Request type</div>
                  <div className="text-sm font-medium">{sourceLabel}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total units</div>
                  <div className="text-sm font-semibold tabular-nums">{totalUnits}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Equipment</div>
                  <div className="flex flex-wrap gap-1">
                    {r.sourceType === "purchase" ? (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
                        {r.requestedCategory ?? "Category TBD"}
                      </span>
                    ) : (
                      reqMachines.map((m) => (
                        <span key={m.id} className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
                          {m.category}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No {tab} requests.
          </div>
        )}
      </div>
    </div>
  );
};

export default Requests;
