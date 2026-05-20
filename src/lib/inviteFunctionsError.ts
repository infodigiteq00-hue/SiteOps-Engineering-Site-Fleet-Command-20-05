/** Human-readable explanation for Supabase.functions.invoke failures (Team invite). */

const DEPLOY_HINT =
  "Deploy it to your project: npm run deploy:invite-fn (Supabase CLI, project linked). In Dashboard: Edge Functions → create/deploy invite-company-member. Confirm VITE_SUPABASE_URL matches that project.";

export async function describeInviteInvokeError(error: Error): Promise<string> {
  const anyErr = error as Error & { name?: string; context?: unknown };

  if (anyErr.name === "FunctionsHttpError" && anyErr.context instanceof Response) {
    const res = anyErr.context;
    try {
      const json = (await res.clone().json()) as { error?: string };
      if (typeof json?.error === "string") return json.error;
    } catch {
      /* try text */
    }
    try {
      const text = (await res.clone().text()).trim();
      if (text) return text.length > 400 ? `${text.slice(0, 400)}…` : text;
    } catch {
      /* noop */
    }
    return `The invite function replied with HTTP ${res.status}. Check Edge Function logs. ${DEPLOY_HINT}`;
  }

  if (anyErr.name === "FunctionsRelayError") {
    return `Supabase could not run the Edge Function. ${DEPLOY_HINT}`;
  }

  if (anyErr.name === "FunctionsFetchError") {
    const cause = anyErr.context instanceof Error ? ` (${anyErr.context.message})` : "";
    return `Could not reach the invite Edge Function${cause}. ${DEPLOY_HINT}`;
  }

  return error.message;
}
