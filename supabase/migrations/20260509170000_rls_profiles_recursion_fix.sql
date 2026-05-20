/*
  RLS policies that subquery public.profiles from within profiles (or from other tables
  while evaluating a profiles read) cause PostgreSQL "infinite recursion detected in policy".

  SECURITY DEFINER helpers with row_security = off read the caller's profile once without
  re-entering policies. Re-create companies, profiles, and operational policies to use them.

  Company isolation: Non–super-users only see rows where row.company_id = auth_my_company_id().
  Super Admin sees all tenants.

  Role matrix (operational tables + visibility):
  - firm_admin: all company sites (create/update/delete), machinery CRUD with delete=machinery+firm_only,
               approve/reject requests (UPDATE), invite/manage team via profiles policies,
               full company visibility; delete machinery_requests governed by 180 as firm_admin only;
               audit_ledger INSERT with approvers; UPDATE ledger per 180 firm_admin only.

  - senior_manager: sites create/update only (no delete); machinery insert/update (no delete);
                   approve/reject requests; audit INSERT; sees all sites/machinery in company.
                   Cannot see team directory (profiles) except own row via profiles_select_own.

  - store_manager: no site writes; machinery insert/update (no delete); approve/reject requests;
                  audit INSERT; sees all sites/machinery in company. Cannot manage profiles.

  - site_manager: SELECT assigned sites only; SELECT machinery limited to warehouse pool +
                  assigned sites; INSERT machinery_requests only for assigned sites; SELECT requests
                  for assigned sites only; SELECT audit_ledger rows for assigned sites only;
                  no approve (no machinery_requests UPDATE), no machinery/site writes.
*/

CREATE OR REPLACE FUNCTION public.auth_is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
STABLE
AS $$
  SELECT p.role::text FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_my_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
STABLE
AS $$
  SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.auth_my_assigned_site_ids()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
STABLE
AS $$
  SELECT p.assigned_site_ids FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.auth_is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_my_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_my_assigned_site_ids() TO authenticated;

ALTER TABLE IF EXISTS public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.machinery ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.machinery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.audit_ledger ENABLE ROW LEVEL SECURITY;

/* ---- companies ---- */
DROP POLICY IF EXISTS "companies_select_member_or_sa" ON public.companies;
DROP POLICY IF EXISTS "companies_write_sa" ON public.companies;
DROP POLICY IF EXISTS "companies_update_sa" ON public.companies;
DROP POLICY IF EXISTS "companies_delete_sa" ON public.companies;

CREATE POLICY "companies_select_member_or_sa"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = companies.id
    )
  );

CREATE POLICY "companies_write_sa"
  ON public.companies FOR INSERT
  TO authenticated
  WITH CHECK (public.auth_is_super_admin());

CREATE POLICY "companies_update_sa"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (public.auth_is_super_admin())
  WITH CHECK (public.auth_is_super_admin());

CREATE POLICY "companies_delete_sa"
  ON public.companies FOR DELETE
  TO authenticated
  USING (public.auth_is_super_admin());

/* ---- profiles ---- */
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_super_admin_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_firm_team" ON public.profiles;
DROP POLICY IF EXISTS "profiles_super_admin_manage" ON public.profiles;
DROP POLICY IF EXISTS "profiles_delete_super_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_firm_admin_update_team" ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_select_super_admin_all"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.auth_is_super_admin());

CREATE POLICY "profiles_select_firm_team"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.auth_my_role() = 'firm_admin'
    AND public.auth_my_company_id() IS NOT NULL
    AND public.auth_my_company_id() = profiles.company_id
  );

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role::text IS NOT DISTINCT FROM public.auth_my_role()
    AND company_id IS NOT DISTINCT FROM public.auth_my_company_id()
    AND assigned_site_ids IS NOT DISTINCT FROM COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[])
  );

CREATE POLICY "profiles_super_admin_manage"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.auth_is_super_admin());

CREATE POLICY "profiles_delete_super_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.auth_is_super_admin());

CREATE POLICY "profiles_firm_admin_update_team"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    profiles.id <> auth.uid()
    AND profiles.role <> 'super_admin'::text
    AND public.auth_my_role() = 'firm_admin'
    AND public.auth_my_company_id() IS NOT NULL
    AND public.auth_my_company_id() = profiles.company_id
  )
  WITH CHECK (
    role <> 'super_admin'::text
    AND public.auth_my_role() = 'firm_admin'
    AND public.auth_my_company_id() IS NOT NULL
    AND company_id IS NOT DISTINCT FROM public.auth_my_company_id()
  );

CREATE OR REPLACE FUNCTION public.assign_profile_company(target_id uuid, new_company uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_is_super_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE public.profiles SET company_id = new_company WHERE id = target_id;
END;
$$;

/* ---- operational tables (sites, machinery, requests, ledger) ---- */
DROP POLICY IF EXISTS "sites_select" ON public.sites;
DROP POLICY IF EXISTS "sites_insert" ON public.sites;
DROP POLICY IF EXISTS "sites_update" ON public.sites;
DROP POLICY IF EXISTS "sites_delete" ON public.sites;

CREATE POLICY "sites_select"
  ON public.sites FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
        OR (
          public.auth_my_role() = 'site_manager'
          AND sites.id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
        )
      )
    )
  );

CREATE POLICY "sites_insert"
  ON public.sites FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager')
    )
  );

CREATE POLICY "sites_update"
  ON public.sites FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager')
    )
  );

CREATE POLICY "sites_delete"
  ON public.sites FOR DELETE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() = 'firm_admin'
    )
  );

DROP POLICY IF EXISTS "machinery_select" ON public.machinery;
DROP POLICY IF EXISTS "machinery_insert" ON public.machinery;
DROP POLICY IF EXISTS "machinery_update" ON public.machinery;
DROP POLICY IF EXISTS "machinery_delete" ON public.machinery;

CREATE POLICY "machinery_select"
  ON public.machinery FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
        OR (
          public.auth_my_role() = 'site_manager'
          AND (
            machinery.assigned_site_id IS NULL
            OR machinery.assigned_site_id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
          )
        )
      )
    )
  );

CREATE POLICY "machinery_insert"
  ON public.machinery FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
    )
  );

CREATE POLICY "machinery_update"
  ON public.machinery FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
    )
  );

CREATE POLICY "machinery_delete"
  ON public.machinery FOR DELETE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() = 'firm_admin'
    )
  );

DROP POLICY IF EXISTS "machinery_requests_select" ON public.machinery_requests;
DROP POLICY IF EXISTS "machinery_requests_insert" ON public.machinery_requests;
DROP POLICY IF EXISTS "machinery_requests_update" ON public.machinery_requests;
DROP POLICY IF EXISTS "machinery_requests_delete" ON public.machinery_requests;

CREATE POLICY "machinery_requests_select"
  ON public.machinery_requests FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
        OR (
          public.auth_my_role() = 'site_manager'
          AND machinery_requests.site_id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
        )
      )
    )
  );

CREATE POLICY "machinery_requests_insert"
  ON public.machinery_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_role() = 'site_manager'
      AND public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND machinery_requests.site_id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
    )
  );

CREATE POLICY "machinery_requests_update"
  ON public.machinery_requests FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
      AND machinery_requests.company_id IS NOT DISTINCT FROM public.auth_my_company_id()
    )
  );

CREATE POLICY "machinery_requests_delete"
  ON public.machinery_requests FOR DELETE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
    )
  );

DROP POLICY IF EXISTS "audit_ledger_select" ON public.audit_ledger;
DROP POLICY IF EXISTS "audit_ledger_insert" ON public.audit_ledger;
DROP POLICY IF EXISTS "audit_ledger_update" ON public.audit_ledger;
DROP POLICY IF EXISTS "audit_ledger_delete" ON public.audit_ledger;

CREATE POLICY "audit_ledger_select"
  ON public.audit_ledger FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
        OR (
          public.auth_my_role() = 'site_manager'
          AND audit_ledger.site_id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
        )
      )
    )
  );

CREATE POLICY "audit_ledger_insert"
  ON public.audit_ledger FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
      AND audit_ledger.company_id IS NOT DISTINCT FROM public.auth_my_company_id()
    )
  );

CREATE POLICY "audit_ledger_update"
  ON public.audit_ledger FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
      AND audit_ledger.company_id IS NOT DISTINCT FROM public.auth_my_company_id()
    )
  );

CREATE POLICY "audit_ledger_delete"
  ON public.audit_ledger FOR DELETE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() = 'firm_admin'
    )
  );
