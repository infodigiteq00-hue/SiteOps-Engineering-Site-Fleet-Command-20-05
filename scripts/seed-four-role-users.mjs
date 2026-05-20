/**
 * Creates 4 demo Auth users (Firm Admin, Senior Manager, Store Manager, Site Manager)
 * for Gujarat company. Requires SUPABASE_SERVICE_ROLE_KEY (Dashboard → Settings → API).
 *
 * Usage:
 *   Set in .env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, optional SEED_USER_PASSWORD
 *   npm run seed:users
 *
 * Default password (all 4): DemoSite2026!  (override with SEED_USER_PASSWORD)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break;
  }
}

loadDotEnv();

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.SEED_USER_PASSWORD || "DemoSite2026!";

/** Must match companies seed UUID in supabase/migrations *companies_roles_rls.sql */
const COMPANY_ID = "f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031";

const USERS = [
  {
    email: "firm.demo@sitemanager.local",
    role: "firm_admin",
    full_name: "Demo Firm Admin",
    contact_phone: "+91 98765 43210",
    assigned_site_ids: [],
  },
  { email: "senior.demo@sitemanager.local", role: "senior_manager", full_name: "Demo Senior Manager", assigned_site_ids: [] },
  { email: "store.demo@sitemanager.local", role: "store_manager", full_name: "Demo Store Manager", assigned_site_ids: [] },
  {
    email: "site.demo@sitemanager.local",
    role: "site_manager",
    full_name: "Demo Site Manager",
    assigned_site_ids: ["s1", "s4"],
  },
];

if (!url || !serviceRole) {
  console.error("Missing VITE_SUPABASE_URL (or SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function upsertProfile(userId, email, row) {
  const payload = {
    id: userId,
    email,
    full_name: row.full_name,
    role: row.role,
    company_id: COMPANY_ID,
    assigned_site_ids: row.assigned_site_ids,
  };
  if (row.contact_phone != null && row.contact_phone !== "") {
    payload.contact_phone = row.contact_phone;
  }
  const { error } = await admin.from("profiles").upsert(payload, { onConflict: "id" });
  if (error) throw error;
}

async function main() {
  console.log("Seeding 4 role users → company", COMPANY_ID);
  let created = 0;
  let updated = 0;

  for (const row of USERS) {
    const meta = {
      full_name: row.full_name,
      role: row.role,
      company_id: COMPANY_ID,
      assigned_site_ids: row.assigned_site_ids,
    };

    const { data: createdUser, error: createErr } = await admin.auth.admin.createUser({
      email: row.email,
      password,
      email_confirm: true,
      user_metadata: meta,
      app_metadata: { invited_by_company: true },
    });

    if (!createErr && createdUser?.user) {
      await upsertProfile(createdUser.user.id, row.email, row);
      console.log("  ✓ created:", row.email, `(${row.role})`);
      created++;
      continue;
    }

    const msg = createErr?.message || "";
    if (!msg.toLowerCase().includes("already") && !msg.toLowerCase().includes("registered")) {
      console.error("  ✗ create failed:", row.email, createErr);
      continue;
    }

    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) {
      console.error("  ✗ list users:", listErr.message);
      continue;
    }

    const u = list.users.find((x) => x.email?.toLowerCase() === row.email.toLowerCase());
    if (!u) {
      console.error("  ✗ user exists but not found in list:", row.email);
      continue;
    }

    await admin.auth.admin.updateUserById(u.id, {
      user_metadata: meta,
      app_metadata: { ...u.app_metadata, invited_by_company: true },
    });
    await upsertProfile(u.id, row.email, row);
    console.log("  ↻ updated profile:", row.email, `(${row.role})`);
    updated++;
  }

  console.log("\nDone. created:", created, "updated:", updated);
  console.log("Login password (all):", password);
  console.log("Emails:");
  USERS.forEach((u) => console.log("  •", u.email));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
