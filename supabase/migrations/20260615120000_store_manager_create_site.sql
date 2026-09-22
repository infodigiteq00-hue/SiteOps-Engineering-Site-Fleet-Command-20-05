/*
  Allow Store Manager to create sites (sites_insert only).
  Site update/delete permissions are unchanged.
*/

DROP POLICY IF EXISTS "sites_insert" ON public.sites;

CREATE POLICY "sites_insert"
  ON public.sites FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager')
    )
  );
