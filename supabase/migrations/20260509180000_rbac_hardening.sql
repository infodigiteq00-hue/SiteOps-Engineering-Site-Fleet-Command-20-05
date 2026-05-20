/*
  Tightens operational RLS beyond 20260509170000:

  - machinery_requests DELETE: Firm Admin (+ Super Admin) only.
    Seniors / Stores approve or reject via UPDATE; deleting rows is a governance action.

  - audit_ledger UPDATE: Firm Admin (+ Super Admin) only.
    Approval flow inserts ledger rows via Firm / Senior / Store; only Firm Admin (or SA) revises corrections.

  - audit_ledger INSERT: unchanged in 170 (Firm Admin, Senior Manager, Store Manager).

  Matches product rules: Site Manager never deletes requests or edits ledger rows.
*/

DROP POLICY IF EXISTS "machinery_requests_delete" ON public.machinery_requests;

CREATE POLICY "machinery_requests_delete"
  ON public.machinery_requests FOR DELETE
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND public.auth_my_role() = 'firm_admin'
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
      AND public.auth_my_role() = 'firm_admin'
    )
  )
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND public.auth_my_role() = 'firm_admin'
    )
  );
