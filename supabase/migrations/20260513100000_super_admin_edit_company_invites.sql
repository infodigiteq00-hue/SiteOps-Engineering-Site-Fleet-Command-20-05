/* Super Admin must be able to edit pending company_invites (not only cancel). */

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_phone text;

DROP POLICY IF EXISTS "company_invites_update_cancel" ON public.company_invites;

/* Firm Admin: pending → cancelled only */
CREATE POLICY "company_invites_firm_admin_cancel"
  ON public.company_invites FOR UPDATE TO authenticated
  USING (
    public.auth_my_role() = 'firm_admin'
    AND public.auth_my_company_id() IS NOT NULL
    AND public.auth_my_company_id() = company_invites.company_id
    AND company_invites.status = 'pending'
  )
  WITH CHECK (
    company_invites.status = 'cancelled'
    AND public.auth_my_role() = 'firm_admin'
    AND public.auth_my_company_id() IS NOT NULL
    AND public.auth_my_company_id() = company_invites.company_id
  );

/* Super Admin: edit pending row (keep pending) or cancel */
CREATE POLICY "company_invites_super_admin_update"
  ON public.company_invites FOR UPDATE TO authenticated
  USING (public.auth_is_super_admin() AND company_invites.status = 'pending')
  WITH CHECK (
    public.auth_is_super_admin()
    AND company_invites.status IN ('pending', 'cancelled')
  );
