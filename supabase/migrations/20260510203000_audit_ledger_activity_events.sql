/*
  Generalize audit_ledger for operational activity events (nullable request/site/dates)
  and expose append_audit_ledger() so any company member (including site_manager) can
  record actions without hitting restrictive INSERT RLS on the table.
*/

BEGIN;

ALTER TABLE public.audit_ledger ADD COLUMN IF NOT EXISTS event_kind text;
ALTER TABLE public.audit_ledger ADD COLUMN IF NOT EXISTS summary text;

UPDATE public.audit_ledger
SET event_kind = 'request_approved'
WHERE event_kind IS NULL OR trim(event_kind) = '';

ALTER TABLE public.audit_ledger ALTER COLUMN event_kind SET DEFAULT 'request_approved';
ALTER TABLE public.audit_ledger ALTER COLUMN event_kind SET NOT NULL;

ALTER TABLE public.audit_ledger ALTER COLUMN request_id DROP NOT NULL;
ALTER TABLE public.audit_ledger ALTER COLUMN site_id DROP NOT NULL;
ALTER TABLE public.audit_ledger ALTER COLUMN from_date DROP NOT NULL;
ALTER TABLE public.audit_ledger ALTER COLUMN until_date DROP NOT NULL;

CREATE INDEX IF NOT EXISTS audit_ledger_company_time_idx ON public.audit_ledger (company_id, approved_at DESC);
CREATE INDEX IF NOT EXISTS audit_ledger_event_kind_idx ON public.audit_ledger (company_id, event_kind);

CREATE OR REPLACE FUNCTION public.append_audit_ledger(
  p_company_id uuid,
  p_event_kind text,
  p_summary text,
  p_site_id text DEFAULT NULL,
  p_machine_ids jsonb DEFAULT '[]'::jsonb,
  p_request_id text DEFAULT NULL,
  p_requester text DEFAULT 'System',
  p_approved_by text DEFAULT 'System',
  p_approver_role text DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_until_date date DEFAULT NULL,
  p_total_units integer DEFAULT 0,
  p_approved_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'append_audit_ledger: not authenticated';
  END IF;

  IF NOT (
    COALESCE(public.auth_is_super_admin(), FALSE)
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() IS NOT DISTINCT FROM p_company_id
    )
  ) THEN
    RAISE EXCEPTION 'append_audit_ledger: company not allowed';
  END IF;

  v_id := 'l-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.audit_ledger (
    id,
    company_id,
    event_kind,
    summary,
    request_id,
    site_id,
    machine_ids,
    requester,
    approved_by,
    approver_role,
    approved_at,
    from_date,
    until_date,
    total_units
  )
  VALUES (
    v_id,
    p_company_id,
    COALESCE(NULLIF(trim(p_event_kind), ''), 'request_approved'),
    NULLIF(trim(p_summary), ''),
    NULLIF(trim(p_request_id), ''),
    NULLIF(trim(p_site_id), ''),
    COALESCE(p_machine_ids, '[]'::jsonb),
    COALESCE(NULLIF(trim(p_requester), ''), 'System'),
    COALESCE(NULLIF(trim(p_approved_by), ''), 'System'),
    NULLIF(trim(p_approver_role), ''),
    COALESCE(p_approved_at, now()),
    p_from_date,
    p_until_date,
    COALESCE(p_total_units, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_audit_ledger(
  uuid,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  date,
  date,
  integer,
  timestamptz
) TO authenticated;

COMMIT;
