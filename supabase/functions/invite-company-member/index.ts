import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";

    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing bearer token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: jwtError,
    } = await admin.auth.getUser(jwt);

    if (jwtError || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await admin.from("profiles").select("role, company_id").eq("id", user.id).maybeSingle();

    if (profile?.role !== "firm_admin" || !profile.company_id) {
      return new Response(JSON.stringify({ error: "Only Firm Admins can invite company members" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));

    const email = String(body?.email ?? "")
      .trim()
      .toLowerCase();
    const full_name = String(body?.full_name ?? "").trim();
    const role = String(body?.role ?? "site_manager").toLowerCase();
    const assigned_site_ids: string[] = Array.isArray(body?.assigned_site_ids) ? body.assigned_site_ids.map(String) : [];
    const allowedRoles = ["senior_manager", "store_manager", "site_manager"];

    if (!email || !full_name || !allowedRoles.includes(role)) {
      return new Response(JSON.stringify({ error: "Provide email, full_name, and a valid role (senior_manager, store_manager, site_manager)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const redirectTo = typeof body?.redirect_to === "string" ? body.redirect_to : undefined;

    // inviteUserByEmail only sends `{ email, data }` to GoTrue — `app_metadata` is ignored by the JS client,
    // so DB trigger never sees invited_by_company. Patch profiles with service role after invite succeeds.
    const {
      data: inviteResult,
      error: inviteError,
    } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        full_name,
        role,
        company_id: profile.company_id,
        assigned_site_ids,
      },
    });

    if (inviteError) {
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const invitedUser = inviteResult?.user;
    if (!invitedUser?.id) {
      return new Response(JSON.stringify({ error: "Invite succeeded but user id missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profilePatch = {
      email: invitedUser.email ?? email,
      full_name: full_name || null,
      role,
      company_id: profile.company_id,
      assigned_site_ids,
    };

    const { error: profileError } = await admin.from("profiles").update(profilePatch).eq("id", invitedUser.id);

    if (profileError) {
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.auth.admin.updateUserById(invitedUser.id, {
      app_metadata: { invited_by_company: true },
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
