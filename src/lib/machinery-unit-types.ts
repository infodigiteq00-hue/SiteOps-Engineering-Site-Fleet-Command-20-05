/** Built-in unit options in the add-machinery dropdown. */
export type PresetMachineryUnitType =
  | "nos"
  | "metre"
  | "kg"
  | "litre"
  | "set"
  | "roll"
  | "box"
  | "pair";

/** Stored on machinery — preset or custom (e.g. tonne, sqm). */
export type MachineryUnitType = PresetMachineryUnitType | (string & {});

export const CUSTOM_MACHINERY_UNIT_VALUE = "__custom__" as const;

export const DEFAULT_MACHINERY_UNIT_TYPE: PresetMachineryUnitType = "nos";

export const MACHINERY_UNIT_TYPE_OPTIONS: { value: PresetMachineryUnitType; label: string }[] = [
  { value: "nos", label: "nos" },
  { value: "metre", label: "metre" },
  { value: "kg", label: "kg" },
  { value: "litre", label: "litre" },
  { value: "set", label: "set" },
  { value: "roll", label: "roll" },
  { value: "box", label: "box" },
  { value: "pair", label: "pair" },
];

const PRESET_VALUES = new Set<string>(MACHINERY_UNIT_TYPE_OPTIONS.map((o) => o.value));

export function isPresetMachineryUnitType(value: string): value is PresetMachineryUnitType {
  return PRESET_VALUES.has(value);
}

export function sanitizeCustomUnitType(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 24);
}

/** Resolve form selection + optional custom text to a value for DB storage. */
export function resolveMachineryUnitType(
  unitType: string,
  customUnitType?: string,
): MachineryUnitType | null {
  if (unitType === CUSTOM_MACHINERY_UNIT_VALUE) {
    const custom = sanitizeCustomUnitType(customUnitType ?? "");
    return custom.length > 0 ? custom : null;
  }
  if (isPresetMachineryUnitType(unitType)) return unitType;
  const custom = sanitizeCustomUnitType(unitType);
  return custom.length > 0 ? custom : null;
}

export function normalizeMachineryUnitType(raw: unknown): MachineryUnitType {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return DEFAULT_MACHINERY_UNIT_TYPE;
  if (PRESET_VALUES.has(v)) return v as PresetMachineryUnitType;
  const custom = sanitizeCustomUnitType(v);
  return custom.length > 0 ? custom : DEFAULT_MACHINERY_UNIT_TYPE;
}

/** e.g. "3 nos" for reports and displays */
export function formatQtyWithUnit(qty: number | string, unitType?: MachineryUnitType | string | null): string {
  const n = typeof qty === "number" ? qty : Number(qty);
  const unit = normalizeMachineryUnitType(unitType ?? DEFAULT_MACHINERY_UNIT_TYPE);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n} ${unit}`;
}

/** Metre, kg, litre, and other non-piece units are one machinery row per line (qty lives on movements). */
export function usesContinuousQuantity(unitType: MachineryUnitType | string): boolean {
  const unit = normalizeMachineryUnitType(unitType);
  return unit !== "nos" && unit !== "set" && unit !== "pair" && unit !== "box";
}

/** How many DB machinery rows to create for a given qty + unit (20 metre → 1 row, 20 nos → 20 rows). */
export function machineryRecordsForQuantity(quantity: number, unitType: MachineryUnitType | string): number {
  const qty = Math.max(0, quantity);
  if (qty === 0) return 0;
  return usesContinuousQuantity(unitType) ? 1 : qty;
}

export function movementMachineIdsMatchQuantity(
  machineIds: string[],
  quantity: number,
  unitType?: MachineryUnitType | string | null,
): boolean {
  if (quantity < 1 || machineIds.length === 0) return false;
  if (unitType && usesContinuousQuantity(unitType)) {
    return machineIds.length === 1;
  }
  return machineIds.length === quantity;
}
