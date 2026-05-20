import type { MachineryStatus } from "@/domain/types";

export const MACHINERY_STATUS_LABELS: Record<MachineryStatus, string> = {
  available: "Available",
  assigned: "Assigned",
  maintenance: "Maintenance",
  lost_damaged: "Lost / damaged",
};

/** All statuses available when editing machinery from site detail or catalog. */
export const MACHINERY_EDIT_STATUSES: MachineryStatus[] = [
  "assigned",
  "available",
  "maintenance",
  "lost_damaged",
];
