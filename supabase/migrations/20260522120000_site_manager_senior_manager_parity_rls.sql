/*
  Site Manager: same operational access as Senior Manager (company-wide reads/writes),
  except Team/user management remains Firm Admin only (unchanged in profiles policies).
*/

/* ---- sites ---- */
DROP POLICY IF EXISTS "sites_select" ON public.sites;

CREATE POLICY "sites_select"
  ON public.sites FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN (
        'firm_admin',
        'senior_manager',
        'store_manager',
        'site_manager',
        'viewer'
      )
    )
  );

DROP POLICY IF EXISTS "sites_insert" ON public.sites;

CREATE POLICY "sites_insert"
  ON public.sites FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'site_manager')
    )
  );

DROP POLICY IF EXISTS "sites_update" ON public.sites;

CREATE POLICY "sites_update"
  ON public.sites FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'site_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'site_manager')
    )
  );

/* ---- machinery ---- */
DROP POLICY IF EXISTS "machinery_select" ON public.machinery;

CREATE POLICY "machinery_select"
  ON public.machinery FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() IN (
        'firm_admin',
        'senior_manager',
        'store_manager',
        'site_manager',
        'viewer'
      )
    )
  );

DROP POLICY IF EXISTS "machinery_insert" ON public.machinery;

CREATE POLICY "machinery_insert"
  ON public.machinery FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
    )
  );

DROP POLICY IF EXISTS "machinery_update" ON public.machinery;

CREATE POLICY "machinery_update"
  ON public.machinery FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
    )
  );

/* ---- machinery requests ---- */
DROP POLICY IF EXISTS "machinery_requests_select" ON public.machinery_requests;

CREATE POLICY "machinery_requests_select"
  ON public.machinery_requests FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND public.auth_my_role() IN (
        'firm_admin',
        'senior_manager',
        'store_manager',
        'site_manager',
        'viewer'
      )
    )
  );

DROP POLICY IF EXISTS "machinery_requests_update" ON public.machinery_requests;

CREATE POLICY "machinery_requests_update"
  ON public.machinery_requests FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
      AND machinery_requests.company_id IS NOT DISTINCT FROM public.auth_my_company_id()
    )
  );

/* ---- audit ledger ---- */
DROP POLICY IF EXISTS "audit_ledger_select" ON public.audit_ledger;

CREATE POLICY "audit_ledger_select"
  ON public.audit_ledger FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() IN (
        'firm_admin',
        'senior_manager',
        'store_manager',
        'site_manager',
        'viewer'
      )
    )
  );

DROP POLICY IF EXISTS "audit_ledger_insert" ON public.audit_ledger;

CREATE POLICY "audit_ledger_insert"
  ON public.audit_ledger FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
      AND audit_ledger.company_id IS NOT DISTINCT FROM public.auth_my_company_id()
    )
  );

DROP POLICY IF EXISTS "audit_ledger_update" ON public.audit_ledger;

CREATE POLICY "audit_ledger_update"
  ON public.audit_ledger FOR UPDATE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
      AND audit_ledger.company_id IS NOT DISTINCT FROM public.auth_my_company_id()
    )
  );

/* ---- custom machinery source statuses ---- */
DROP POLICY IF EXISTS "company_machinery_source_statuses_insert" ON public.company_machinery_source_statuses;

CREATE POLICY "company_machinery_source_statuses_insert"
  ON public.company_machinery_source_statuses FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = company_machinery_source_statuses.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
    )
  );
