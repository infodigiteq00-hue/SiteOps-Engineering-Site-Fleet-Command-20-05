/* Companies + tenancy RLS. Safe to run after profiles migration (adds FK, policies, trigger updates).

   If SQL Editor fails with "relation public.profiles does not exist", you ran this file BEFORE the base
   migration — either run supabase/migrations/20260509120000_profiles_and_auth_trigger.sql first, OR rely on
   the block below which creates profiles when missing. */

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name text,
  role text NOT NULL DEFAULT 'firm_admin'
    CHECK (role IN ('super_admin', 'firm_admin', 'senior_manager', 'store_manager', 'site_manager')),
  assigned_site_ids text[] NOT NULL DEFAULT '{}',
  company_id uuid
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.companies (id, name) VALUES
  ('f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid, 'Gujarat Industrial Partners'),
  ('2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid, 'Southern Zone Operations')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_company_id_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_company_id_fkey
    FOREIGN KEY (company_id)
    REFERENCES public.companies (id)
    ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.profiles ADD COLUMN email text;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies_select_member_or_sa" ON public.companies;
DROP POLICY IF EXISTS "companies_write_sa" ON public.companies;
DROP POLICY IF EXISTS "companies_update_sa" ON public.companies;
DROP POLICY IF EXISTS "companies_delete_sa" ON public.companies;

CREATE POLICY "companies_select_member_or_sa"
  ON public.companies FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.company_id IS NOT NULL
        AND p.company_id = companies.id
    )
  );

CREATE POLICY "companies_write_sa"
  ON public.companies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

CREATE POLICY "companies_update_sa"
  ON public.companies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

CREATE POLICY "companies_delete_sa"
  ON public.companies FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin')
  );

/* --- Profiles RLS (drop all names this file creates — safe to re-run) --- */

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
  USING (
    EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'super_admin')
  );

CREATE POLICY "profiles_select_firm_team"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND me.role = 'firm_admin'
        AND me.company_id IS NOT NULL
        AND me.company_id = profiles.company_id
    )
  );

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_super_admin_manage"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'super_admin')
  );

CREATE POLICY "profiles_delete_super_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'super_admin')
  );

CREATE POLICY "profiles_firm_admin_update_team"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND me.role = 'firm_admin'
        AND me.company_id IS NOT NULL
        AND me.company_id = profiles.company_id
        AND profiles.id <> me.id
        AND profiles.role <> 'super_admin'
    )
  )
  WITH CHECK (
    role <> 'super_admin'::text
    AND EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid()
        AND me.role = 'firm_admin'
        AND me.company_id IS NOT NULL
        AND me.company_id = profiles.company_id
    )
  );

CREATE OR REPLACE FUNCTION public.assign_profile_company(target_id uuid, new_company uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE public.profiles SET company_id = new_company WHERE id = target_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_profile_company(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_role text;
  invite_company uuid;
  fname text;
  arr text[];
  invited_from_company boolean;
BEGIN
  invited_from_company := coalesce((NEW.raw_app_meta_data ->> 'invited_by_company')::boolean, false);

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
    SELECT coalesce(array_agg(value::text), '{}')
      INTO arr
    FROM jsonb_array_elements_text(COALESCE(NEW.raw_user_meta_data -> 'assigned_site_ids', '[]'::jsonb)) AS value;
  EXCEPTION
    WHEN others THEN arr := '{}';
  END;

  IF NOT invited_from_company THEN
    arr := '{}';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, assigned_site_ids, company_id)
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();
