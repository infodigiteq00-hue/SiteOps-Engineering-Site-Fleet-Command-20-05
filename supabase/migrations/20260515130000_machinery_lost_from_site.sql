-- Remember which site machinery was lost or damaged at (site closure / write-off).
ALTER TABLE public.machinery
  ADD COLUMN IF NOT EXISTS lost_from_site_id text REFERENCES public.sites (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS machinery_lost_from_site_id_idx ON public.machinery (lost_from_site_id);

-- Backfill from site-closure ledger rows where possible.
UPDATE public.machinery m
SET lost_from_site_id = al.site_id
FROM public.audit_ledger al
WHERE m.status = 'lost_damaged'
  AND m.lost_from_site_id IS NULL
  AND al.site_id IS NOT NULL
  AND al.event_kind = 'machinery_site_closure'
  AND al.summary ILIKE '%lost/damaged%'
  AND al.machine_ids @> to_jsonb(ARRAY[m.id]::text[]);
