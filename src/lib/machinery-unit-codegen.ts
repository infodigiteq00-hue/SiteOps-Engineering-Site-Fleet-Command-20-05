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

/** Generate the next N machinery codes/names and advance the cursor. */
export function takeMachineryUnitsFromCursor(
  cursor: MachineryCodegenCursor,
  quantity: number,
  reservedCodes: Set<string>,
): Array<{ code: string; name: string }> {
  const safeQty = Math.max(0, quantity);
  const units: Array<{ code: string; name: string }> = [];

  for (let i = 0; i < safeQty; i += 1) {
    const code = `${cursor.codePrefix}${cursor.codeSeparator}${String(cursor.nextCodeNumber).padStart(cursor.codeWidth, "0")}`;
    const name = `${cursor.nameBase}${cursor.nextNameNumber}`;
    units.push({ code, name });
    reservedCodes.add(code.toUpperCase());
    cursor.nextCodeNumber += 1;
    cursor.nextNameNumber += 1;
  }

  return units;
}
