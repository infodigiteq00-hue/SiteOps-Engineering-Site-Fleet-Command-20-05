/*
  Persist custom machinery source/status labels per company (Manage Machinery dropdown).
*/

CREATE TABLE IF NOT EXISTS public.company_machinery_source_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_machinery_source_statuses_label_nonempty CHECK (char_length(trim(label)) >= 1)
);

CREATE INDEX IF NOT EXISTS company_machinery_source_statuses_company_id_idx
  ON public.company_machinery_source_statuses (company_id);

CREATE UNIQUE INDEX IF NOT EXISTS company_machinery_source_statuses_company_label_uidx
  ON public.company_machinery_source_statuses (company_id, lower(trim(label)));

ALTER TABLE public.company_machinery_source_statuses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_machinery_source_statuses_select" ON public.company_machinery_source_statuses;
DROP POLICY IF EXISTS "company_machinery_source_statuses_insert" ON public.company_machinery_source_statuses;

CREATE POLICY "company_machinery_source_statuses_select"
  ON public.company_machinery_source_statuses FOR SELECT
  TO authenticated
  USING (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = company_machinery_source_statuses.company_id
    )
  );

CREATE POLICY "company_machinery_source_statuses_insert"
  ON public.company_machinery_source_statuses FOR INSERT
  TO authenticated
  WITH CHECK (
    public.auth_is_super_admin()
    OR (
      public.auth_my_company_id() IS NOT NULL
      AND public.auth_my_company_id() = company_machinery_source_statuses.company_id
      AND public.auth_my_role() IN ('firm_admin', 'senior_manager', 'store_manager')
    )
  );

/* Backfill custom pool names already used in movement ledger summaries */
INSERT INTO public.company_machinery_source_statuses (company_id, label)
SELECT DISTINCT
  al.company_id,
  trim(m[1])
FROM public.audit_ledger al,
LATERAL regexp_match(al.summary, '\(([^)]+) pool\)', 'i') AS m
WHERE al.summary ~* '\([^)]+\) pool\)'
  AND trim(m[1]) <> ''
  AND lower(trim(m[1])) NOT IN ('available', 'assigned', 'maintenance', 'lost/damaged', 'lost_damaged')
  AND NOT EXISTS (
    SELECT 1
    FROM public.company_machinery_source_statuses existing
    WHERE existing.company_id = al.company_id
      AND lower(trim(existing.label)) = lower(trim(m[1]))
  );
