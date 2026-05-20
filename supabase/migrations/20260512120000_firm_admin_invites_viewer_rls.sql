/* Firm-admin invites (super admin), viewer role, read-only RLS for viewer, invite trigger fixes. */

/* ---- profiles.role includes viewer ---- */
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (
    role IN (
      'super_admin',
      'firm_admin',
      'senior_manager',
      'store_manager',
      'site_manager',
      'viewer'
    )
  );

/* ---- company_invites: contact + firm_admin role ---- */
ALTER TABLE public.company_invites
  ADD COLUMN IF NOT EXISTS contact_phone text;

ALTER TABLE public.company_invites DROP CONSTRAINT IF EXISTS company_invites_role_check;

ALTER TABLE public.company_invites
  ADD CONSTRAINT company_invites_role_check CHECK (
    role IN (
      'firm_admin',
      'senior_manager',
      'store_manager',
      'site_manager'
    )
  );

/* ---- Invite RLS: super admin can create firm_admin invites; firm admin only operational roles ---- */
DROP POLICY IF EXISTS "company_invites_insert" ON public.company_invites;

CREATE POLICY "company_invites_insert"
  ON public.company_invites FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.auth_is_super_admin()
      AND company_invites.role = 'firm_admin'
    )
    OR (
      public.auth_my_role() = 'firm_admin'
      AND public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = company_invites.company_id
      AND company_invites.role IN ('senior_manager', 'store_manager', 'site_manager')
    )
  );

DROP POLICY IF EXISTS "company_invites_update_cancel" ON public.company_invites;

CREATE POLICY "company_invites_update_cancel"
  ON public.company_invites FOR UPDATE TO authenticated
  USING (
    (
      public.auth_is_super_admin()
      AND company_invites.status = 'pending'
    )
    OR (
      public.auth_my_role() = 'firm_admin'
      AND public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = company_invites.company_id
      AND company_invites.status = 'pending'
    )
  )
  WITH CHECK (
    company_invites.status = 'cancelled'
    AND (
      public.auth_is_super_admin()
      OR (
        public.auth_my_role() = 'firm_admin'
        AND public.auth_my_company_id() IS NOT NULL
        AND public.auth_my_company_id() = company_invites.company_id
      )
    )
  );

/* Firm admin cannot escalate members to firm_admin / super_admin */
DROP POLICY IF EXISTS "profiles_firm_admin_update_team" ON public.profiles;

CREATE POLICY "profiles_firm_admin_update_team"
  ON public.profiles FOR UPDATE TO authenticated
  USING (
    profiles.id <> auth.uid()
    AND profiles.role <> 'super_admin'::text
    AND public.auth_my_role() = 'firm_admin'
    AND public.auth_my_company_id() IS NOT NULL
    AND public.auth_my_company_id() = profiles.company_id
  )
  WITH CHECK (
    role IN ('senior_manager', 'store_manager', 'site_manager', 'viewer')
    AND role <> 'super_admin'::text
    AND public.auth_my_role() = 'firm_admin'
    AND public.auth_my_company_id() IS NOT NULL
    AND company_id IS NOT DISTINCT FROM public.auth_my_company_id()
  );

/* ---- Viewer: SELECT-only across company (same breadth as store_manager for reads) ---- */
DROP POLICY IF EXISTS "sites_select" ON public.sites;

CREATE POLICY "sites_select"
  ON public.sites FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = sites.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'viewer')
        OR (
          public.auth_my_role() = 'site_manager'
          AND sites.id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
        )
      )
    )
  );

DROP POLICY IF EXISTS "machinery_select" ON public.machinery;

CREATE POLICY "machinery_select"
  ON public.machinery FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'viewer')
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

DROP POLICY IF EXISTS "machinery_requests_select" ON public.machinery_requests;

CREATE POLICY "machinery_requests_select"
  ON public.machinery_requests FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = machinery_requests.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'viewer')
        OR (
          public.auth_my_role() = 'site_manager'
          AND machinery_requests.site_id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
        )
      )
    )
  );

DROP POLICY IF EXISTS "audit_ledger_select" ON public.audit_ledger;

CREATE POLICY "audit_ledger_select"
  ON public.audit_ledger FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = audit_ledger.company_id
      AND (
        public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager', 'viewer')
        OR (
          public.auth_my_role() = 'site_manager'
          AND audit_ledger.site_id = ANY (COALESCE(public.auth_my_assigned_site_ids(), '{}'::text[]))
        )
      )
    )
  );

/* ---- Auth trigger: pending invite drives role; invalid → viewer; firm_admin from super-admin invite ---- */
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.company_invites%ROWTYPE;
  invite_role text;
  invite_company uuid;
  fname text;
  arr text[];
  invited_from_company boolean;
BEGIN
  invited_from_company := coalesce((NEW.raw_app_meta_data ->> 'invited_by_company')::boolean, false);

  SELECT *
    INTO inv
  FROM public.company_invites
  WHERE status = 'pending'
    AND lower(trim(email)) = lower(trim(NEW.email))
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    invite_role := lower(trim(inv.role));

    IF invite_role = 'firm_admin' THEN
      fname := COALESCE(
        NULLIF(trim(inv.full_name), ''),
        NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), '')
      );

      INSERT INTO public.profiles(id, email, full_name, role, assigned_site_ids, company_id)
      VALUES (
        NEW.id,
        NEW.email,
        fname,
        'firm_admin',
        '{}'::text[],
        inv.company_id
      )
      ON CONFLICT (id) DO NOTHING;

      UPDATE public.company_invites
        SET status = 'accepted',
            accepted_at = now(),
            accepted_user_id = NEW.id,
            updated_at = now()
      WHERE id = inv.id;

      UPDATE public.company_invites
        SET status = 'superseded',
            updated_at = now()
      WHERE status = 'pending'
        AND lower(trim(email)) = lower(trim(NEW.email))
        AND id <> inv.id;

      RETURN NEW;
    END IF;

    IF invite_role IN ('senior_manager', 'store_manager', 'site_manager') THEN
      NULL;
    ELSE
      invite_role := 'viewer';
    END IF;

    fname := COALESCE(
      NULLIF(trim(inv.full_name), ''),
      NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), '')
    );

    INSERT INTO public.profiles(id, email, full_name, role, assigned_site_ids, company_id)
    VALUES (
      NEW.id,
      NEW.email,
      fname,
      invite_role,
      coalesce(inv.assigned_site_ids, '{}'::text[]),
      inv.company_id
    )
    ON CONFLICT (id) DO NOTHING;

    UPDATE public.company_invites
      SET status = 'accepted',
          accepted_at = now(),
          accepted_user_id = NEW.id,
          updated_at = now()
    WHERE id = inv.id;

    UPDATE public.company_invites
      SET status = 'superseded',
          updated_at = now()
    WHERE status = 'pending'
      AND lower(trim(email)) = lower(trim(NEW.email))
      AND id <> inv.id;

    RETURN NEW;
  END IF;

  IF invited_from_company THEN
    invite_role := lower(trim(COALESCE(NEW.raw_user_meta_data ->> 'role', 'firm_admin')));
    IF invite_role NOT IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager', 'viewer') THEN
      invite_role := 'viewer';
    END IF;
    BEGIN
      invite_company := (NEW.raw_user_meta_data ->> 'company_id')::uuid;
    EXCEPTION
      WHEN others THEN invite_company := NULL;
    END;
  ELSE
    invite_role := 'firm_admin';
    invite_company := NULL;
  END IF;

  fname := NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), '');
  BEGIN
    SELECT coalesce(array_agg(value), '{}')
      INTO arr
    FROM jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(COALESCE(NEW.raw_user_meta_data -> 'assigned_site_ids', '[]'::jsonb)) = 'array' THEN NEW.raw_user_meta_data -> 'assigned_site_ids'
        ELSE '[]'::jsonb
      END
    ) AS value;
  EXCEPTION
    WHEN others THEN arr := '{}';
  END;

  IF NOT invited_from_company THEN
    arr := '{}';
  END IF;

  INSERT INTO public.profiles(id, email, full_name, role, assigned_site_ids, company_id)
  VALUES (
    NEW.id,
    NEW.email,
    fname,
    invite_role,
    coalesce(arr, '{}'::text[]),
    invite_company
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;
