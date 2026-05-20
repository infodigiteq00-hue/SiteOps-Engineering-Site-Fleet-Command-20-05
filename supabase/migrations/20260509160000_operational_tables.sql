/*
  Domain tables for sites, machinery, machinery requests, and audit ledger.
  The current React UI still reads/writes Zustand (src/lib/store.ts); these tables
  are the Supabase mirror for when you wire real-time sync or server-side writes.

  Prerequisites: companies + profiles migrations applied.
*/

/* ---- sites ---- */
CREATE TABLE IF NOT EXISTS public.sites (
  id text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  location text NOT NULL,
  manager text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'planning', 'completed', 'on-hold')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sites_company_id_idx ON public.sites (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS sites_company_code_uidx ON public.sites (company_id, code);

/* ---- machinery (matches store Machine) ---- */
CREATE TABLE IF NOT EXISTS public.machinery (
  id text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'assigned', 'maintenance')),
  assigned_site_id text REFERENCES public.sites (id) ON DELETE SET NULL,
  project_name text,
  project_location text,
  assigned_to text,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS machinery_company_id_idx ON public.machinery (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS machinery_company_code_uidx ON public.machinery (company_id, code);
CREATE INDEX IF NOT EXISTS machinery_assigned_site_id_idx ON public.machinery (assigned_site_id);

/* ---- machinery requests (matches store Request) ---- */
CREATE TABLE IF NOT EXISTS public.machinery_requests (
  id text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  site_id text NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  machine_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_type text NOT NULL
    CHECK (source_type IN ('available', 'transfer', 'purchase')),
  source_site_id text REFERENCES public.sites (id) ON DELETE SET NULL,
  requested_category text,
  requested_quantity integer,
  requester text NOT NULL,
  reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  needed_from date NOT NULL,
  needed_until date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  decided_by text,
  decider_role text,
  decision_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS machinery_requests_company_id_idx ON public.machinery_requests (company_id);
CREATE INDEX IF NOT EXISTS machinery_requests_site_id_idx ON public.machinery_requests (site_id);
CREATE INDEX IF NOT EXISTS machinery_requests_status_idx ON public.machinery_requests (status);

/* ---- audit ledger (matches store LedgerEntry) ---- */
CREATE TABLE IF NOT EXISTS public.audit_ledger (
  id text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  request_id text NOT NULL,
  site_id text NOT NULL REFERENCES public.sites (id) ON DELETE CASCADE,
  machine_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  requester text NOT NULL,
  approved_by text NOT NULL,
  approver_role text,
  approved_at timestamptz NOT NULL,
  from_date date NOT NULL,
  until_date date NOT NULL,
  total_units integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_ledger_company_id_idx ON public.audit_ledger (company_id);
CREATE INDEX IF NOT EXISTS audit_ledger_site_id_idx ON public.audit_ledger (site_id);
CREATE INDEX IF NOT EXISTS audit_ledger_request_id_idx ON public.audit_ledger (request_id);

/*
  Row-level policies for these tables live in migrations:
  - 20260509170000_rls_profiles_recursion_fix.sql (SECURITY DEFINER helpers + tenancy + RBAC)
  - 20260509180000_rbac_hardening.sql (additional lockdown where applicable)

  Enabling RLS is done next to policies so subquery-on-profiles policies never ship without helpers.
*/
