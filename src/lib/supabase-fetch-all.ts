/** PostgREST / Supabase default page size — queries without pagination cap at this many rows. */
export const SUPABASE_PAGE_SIZE = 1000;

type PageResult<TRow> = {
  data: TRow[] | null;
  error: { message: string } | null;
};

/**
 * Fetch every row from a Supabase query by paging with `.range()`.
 * Use for operational lists (machinery, sites, ledger) that can exceed 1000 rows.
 */
export async function fetchAllSupabasePages<TRow>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<TRow>>,
): Promise<TRow[]> {
  const rows: TRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await fetchPage(offset, offset + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return rows;
}
