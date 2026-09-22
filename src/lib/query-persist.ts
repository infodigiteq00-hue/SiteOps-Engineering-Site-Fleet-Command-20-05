import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "siteops.operational-cache.v1";
const SAVE_DEBOUNCE_MS = 400;

/** Restore operational/admin query cache after a tab refresh. */
export function restoreOperationalCache(qc: QueryClient) {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    hydrate(qc, JSON.parse(raw));
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

/** Keep a session copy so refresh can reuse the last page data instead of a full reload. */
export function persistOperationalCache(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (query) =>
          query.state.status === "success" &&
          (query.queryKey[0] === "operational" || query.queryKey[0] === "admin"),
      });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // quota / private mode — keep the app working without persistence
    }
  };

  return qc.getQueryCache().subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  });
}
