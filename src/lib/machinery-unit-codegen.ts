import type { Machine, MachineryCategory } from "@/domain/types";
import { MACHINERY_CATEGORIES, categoryCodePrefix, toCodeChunk } from "@/domain/types";

export type MachineryCodegenCursor = {
  codePrefix: string;
  codeSeparator: string;
  codeWidth: number;
  nextCodeNumber: number;
  nameBase: string;
  nextNameNumber: number;
};

function codePatternMatch(code: string): RegExpMatchArray | null {
  return code.match(/^([A-Za-z]+)([-_]?)(\d+)$/);
}

export function formatMachineryCode(
  cursor: Pick<MachineryCodegenCursor, "codePrefix" | "codeSeparator" | "codeWidth">,
  codeNumber: number,
): string {
  return `${cursor.codePrefix}${cursor.codeSeparator}${String(codeNumber).padStart(cursor.codeWidth, "0")}`;
}

/** Next free code for a cursor that is not already in reservedCodes (company-wide). */
export function allocateNextFreeCode(
  cursor: MachineryCodegenCursor,
  reservedCodes: Set<string>,
): string {
  let code = formatMachineryCode(cursor, cursor.nextCodeNumber);
  while (reservedCodes.has(code.toUpperCase())) {
    cursor.nextCodeNumber += 1;
    code = formatMachineryCode(cursor, cursor.nextCodeNumber);
  }
  reservedCodes.add(code.toUpperCase());
  cursor.nextCodeNumber += 1;
  return code;
}

/** Seed auto code/name counters for a category (existing DB + codes reserved in this import). */
export function seedCategoryCodegen(
  category: string,
  machines: Machine[],
  reservedCodes: Set<string>,
): MachineryCodegenCursor {
  const categoryMachines = machines.filter((m) => m.category.toLowerCase() === category.toLowerCase());

  const codeMatchesFromDb = categoryMachines
    .map((machine) => codePatternMatch(machine.code))
    .filter((match): match is RegExpMatchArray => Boolean(match));

  const maxFromDb = codeMatchesFromDb.reduce(
    (max, match) => Math.max(max, Number.parseInt(match[3], 10)),
    0,
  );
  const lastDbMatch = codeMatchesFromDb.find((match) => Number.parseInt(match[3], 10) === maxFromDb);

  const knownCategory = (MACHINERY_CATEGORIES as readonly string[]).find(
    (c) => c.toLowerCase() === category.toLowerCase(),
  ) as MachineryCategory | undefined;
  const standardPrefix = knownCategory ? categoryCodePrefix[knownCategory] : toCodeChunk(category);
  const codePrefix = lastDbMatch?.[1] ?? standardPrefix;
  const codeSeparator = lastDbMatch?.[2] ?? "-";
  const codeWidth = lastDbMatch?.[3]?.length ?? 3;

  const reservedMatches = Array.from(reservedCodes)
    .map((code) => codePatternMatch(code))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .filter((match) => match[1].toUpperCase() === codePrefix.toUpperCase());

  const maxFromReserved = reservedMatches.reduce(
    (max, match) => Math.max(max, Number.parseInt(match[3], 10)),
    0,
  );

  const nameMatches = categoryMachines
    .map((machine) => machine.name.match(/^(.*?)(\d+)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  const maxNameNumber = nameMatches.reduce(
    (max, match) => Math.max(max, Number.parseInt(match[2], 10)),
    0,
  );
  const lastNameMatch = nameMatches.find((match) => Number.parseInt(match[2], 10) === maxNameNumber);
  const nameBase = lastNameMatch?.[1] ?? `${category} `;

  const startCodeNumber = Math.max(maxFromDb, maxFromReserved) + 1;

  return {
    codePrefix,
    codeSeparator,
    codeWidth,
    nextCodeNumber: startCodeNumber,
    nameBase,
    nextNameNumber: maxNameNumber + 1,
  };
}

/** Generate the next N machinery codes/names and advance the cursor. Skips codes already reserved. */
export function takeMachineryUnitsFromCursor(
  cursor: MachineryCodegenCursor,
  quantity: number,
  reservedCodes: Set<string>,
): Array<{ code: string; name: string }> {
  const safeQty = Math.max(0, quantity);
  const units: Array<{ code: string; name: string }> = [];

  for (let i = 0; i < safeQty; i += 1) {
    const code = allocateNextFreeCode(cursor, reservedCodes);
    const name = `${cursor.nameBase}${cursor.nextNameNumber}`;
    units.push({ code, name });
    cursor.nextNameNumber += 1;
  }

  return units;
}

/** Suggest codes/names for single-add UI using company-wide uniqueness. */
export function suggestMachineryUnits(
  category: string,
  machines: Machine[],
  quantity: number,
): Array<{ code: string; name: string }> {
  const reservedCodes = new Set(machines.map((machine) => machine.code.toUpperCase()));
  const cursor = seedCategoryCodegen(category, machines, reservedCodes);
  return takeMachineryUnitsFromCursor(cursor, quantity, reservedCodes);
}

/**
 * Resolve unit codes for create: blank codes get the next free auto code;
 * provided codes are kept as-is (caller validates uniqueness).
 */
export function resolveMachineryUnitCodes(
  category: string,
  machines: Machine[],
  units: Array<{ code: string; name: string }>,
): Array<{ code: string; name: string }> {
  const reservedCodes = new Set(machines.map((machine) => machine.code.toUpperCase()));
  const cursor = seedCategoryCodegen(category, machines, reservedCodes);

  return units.map((unit) => {
    const name = unit.name.trim();
    const code = unit.code.trim();
    if (code) {
      reservedCodes.add(code.toUpperCase());
      return { code, name };
    }
    return { code: allocateNextFreeCode(cursor, reservedCodes), name };
  });
}
