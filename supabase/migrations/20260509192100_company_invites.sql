/*
  Persisted invitations: firm admins record who to invite + role + site assignments.
  On first auth.users insert (sign-up / invite accepts), handle_new_user() consumes the newest
  matching pending invite and fills public.profiles accordingly.
*/

CREATE TABLE IF NOT EXISTS public.company_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL
    CHECK (role IN ('senior_manager', 'store_manager', 'site_manager')),
  assigned_site_ids text[] NOT NULL DEFAULT '{}'::text[],
  invited_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (
      status IN ('pending', 'accepted', 'cancelled', 'superseded')
    ),
  expires_at timestamptz NOT NULL DEFAULT (now () + INTERVAL '30 days'),
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  updated_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX IF NOT EXISTS company_invites_company_id_idx ON public.company_invites (company_id);
CREATE INDEX IF NOT EXISTS company_invites_email_lower_idx ON public.company_invites (lower(trim(email)));
CREATE INDEX IF NOT EXISTS company_invites_status_idx ON public.company_invites (status);

/* One pending invite per email globally (avoids ambiguous signup routing). */
CREATE UNIQUE INDEX IF NOT EXISTS company_invites_one_pending_email
  ON public.company_invites ((lower(trim(email))))
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.company_invites_validate_sites()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_site_ids IS NOT NULL AND cardinality(NEW.assigned_site_ids) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM unnest(NEW.assigned_site_ids) AS sid (site_id)
      LEFT JOIN public.sites s
        ON s.id = sid.site_id
        AND s.company_id = NEW.company_id
      WHERE s.id IS NULL
    ) THEN
      RAISE EXCEPTION 'assigned_site_ids must reference sites belonging to the invite company';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_invites_validate_sites_trg ON public.company_invites;
CREATE TRIGGER company_invites_validate_sites_trg
  BEFORE INSERT OR UPDATE ON public.company_invites
  FOR EACH ROW EXECUTE PROCEDURE public.company_invites_validate_sites();

CREATE OR REPLACE FUNCTION public.touch_company_invites_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now ();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_invites_touch_updated ON public.company_invites;
CREATE TRIGGER company_invites_touch_updated
  BEFORE UPDATE ON public.company_invites
  FOR EACH ROW EXECUTE PROCEDURE public.touch_company_invites_updated();

ALTER TABLE public.company_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_invites_select" ON public.company_invites;
DROP POLICY IF EXISTS "company_invites_insert" ON public.company_invites;
DROP POLICY IF EXISTS "company_invites_update_cancel" ON public.company_invites;

CREATE POLICY "company_invites_select"
  ON public.company_invites FOR SELECT TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_role () = 'firm_admin'
      AND public.auth_my_company_id () IS NOT NULL
      AND public.auth_my_company_id () = company_invites.company_id
    )
  );

CREATE POLICY "company_invites_insert"
  ON public.company_invites FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_my_role () = 'firm_admin'
    AND public.auth_my_company_id () IS NOT NULL
    AND public.auth_my_company_id () = company_invites.company_id
  );

CREATE POLICY "company_invites_update_cancel"
  ON public.company_invites FOR UPDATE TO authenticated
  USING (
    public.auth_my_role () = 'firm_admin'
    AND public.auth_my_company_id () IS NOT NULL
    AND public.auth_my_company_id () = company_invites.company_id
    AND status = 'pending'
  )
  WITH CHECK (
    public.auth_my_role () = 'firm_admin'
    AND public.auth_my_company_id () IS NOT NULL
    AND public.auth_my_company_id () = company_invites.company_id
    AND status = 'cancelled'
  );

/* ---- Consume pending invite inside auth trigger ---- */

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

  /* 1) Self-serve signup: pending row saved by Firm Admin in company_invites. */
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
    IF invite_role NOT IN ('senior_manager', 'store_manager', 'site_manager') THEN
      invite_role := 'site_manager';
    END IF;

    fname := COALESCE(NULLIF(trim(inv.full_name), ''), NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), ''));

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
          accepted_at = now (),
          accepted_user_id = NEW.id,
          updated_at = now ()
    WHERE id = inv.id;

    UPDATE public.company_invites
      SET status = 'superseded',
          updated_at = now ()
    WHERE status = 'pending'
      AND lower(trim(email)) = lower(trim(NEW.email))
      AND id <> inv.id;

    RETURN NEW;
  END IF;

  /* 2) Legacy: GoTrue/admin invite payloads (user_meta + app_meta). */
  IF invited_from_company THEN
    invite_role := lower(trim(COALESCE(NEW.raw_user_meta_data ->> 'role', 'firm_admin')));
    IF invite_role NOT IN ('firm_admin', 'senior_manager', 'store_manager', 'site_manager') THEN
      invite_role := 'firm_admin';
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
