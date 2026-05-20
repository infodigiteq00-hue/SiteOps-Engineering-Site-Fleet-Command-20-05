/** Human-readable label when company name is unknown (e.g. still loading). */
export function formatCompanyLabel(id: string | null | undefined, nameById?: Record<string, string>): string {
  if (!id) return "—";
  const name = nameById?.[id];
  return name ?? id.slice(0, 8);
}
