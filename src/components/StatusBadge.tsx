import { cn } from "@/lib/utils";

type Variant =
  | "active"
  | "planning"
  | "completed"
  | "on-hold"
  | "available"
  | "assigned"
  | "maintenance"
  | "lost_damaged"
  | "pending"
  | "approved"
  | "rejected";

const styles: Record<Variant, string> = {
  active: "bg-success/10 text-success border-success/20",
  planning: "bg-info/10 text-info border-info/20",
  completed: "bg-muted text-muted-foreground border-border",
  "on-hold": "bg-destructive/10 text-destructive border-destructive/20",
  available: "bg-success/10 text-success border-success/20",
  assigned: "bg-info/10 text-info border-info/20",
  maintenance: "bg-warning/15 text-warning-foreground border-warning/30",
  lost_damaged: "bg-destructive/10 text-destructive border-destructive/20",
  pending: "bg-warning/15 text-warning-foreground border-warning/30",
  approved: "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
};

export const StatusBadge = ({ status }: { status: Variant }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
      styles[status]
    )}
  >
    <span className="h-1.5 w-1.5 rounded-full bg-current" />
    {status === "lost_damaged" ? "lost / damaged" : status.replace("-", " ")}
  </span>
);
