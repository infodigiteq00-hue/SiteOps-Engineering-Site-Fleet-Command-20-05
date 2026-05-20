/* Optional site row for bulk CSV / legacy samples that reference PI Industries — Panoli (Gujarat tenant). */
INSERT INTO public.sites (
  id,
  company_id,
  name,
  code,
  location,
  manager,
  status,
  start_date,
  end_date
) VALUES
  (
    's3',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'PI Industries — Panoli',
    'PII-PNL',
    'Panoli, Gujarat',
    'Kavita Joshi',
    'active',
    '2025-07-08',
    '2026-11-30'
  )
ON CONFLICT (id) DO NOTHING;
