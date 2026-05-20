/*
  Starter rows for sites + machinery aligned to seeded companies in
  20260509140000_companies_roles_rls.sql. Uses ON CONFLICT DO NOTHING so reruns stay safe.

  Omit this migration in environments where all operational data comes from production imports.
*/

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
    's1',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'L&T Heavy Engineering — Hazira',
    'LNT-HZR',
    'Hazira, Gujarat',
    'Vikram Shetty',
    'active',
    '2024-11-10',
    '2026-09-30'
  ),
  (
    's2',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'UPL Limited — Panoli',
    'UPL-PNL',
    'Panoli, Gujarat',
    'Nirav Patel',
    'active',
    '2025-04-12',
    '2026-10-20'
  ),
  (
    's4',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'SRF Limited — Dahej',
    'SRF-DHJ',
    'Dahej, Gujarat',
    'Rahul Bhatt',
    'active',
    '2025-05-20',
    '2027-01-15'
  ),
  (
    's10',
    '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid,
    'Deepak Nitrite — Nandesari',
    'DNK-NDS',
    'Nandesari, Gujarat',
    'Rajesh Kumar',
    'active',
    '2025-05-10',
    '2027-01-20'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.machinery (
  id,
  company_id,
  code,
  name,
  category,
  status,
  assigned_site_id,
  project_name,
  project_location
) VALUES
  (
    'm1',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'GRD-001',
    'Grinding Machine Unit 1',
    'Grinding Machine',
    'assigned',
    's1',
    NULL,
    NULL
  ),
  (
    'm2',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'LTH-001',
    'Lathe Machine Unit 1',
    'Lathe Machine',
    'assigned',
    's2',
    NULL,
    NULL
  ),
  (
    'm3',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'WLD-001',
    'Welding Machine Unit 1',
    'Welding Machine',
    'available',
    NULL,
    NULL,
    NULL
  ),
  (
    'm4',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'HYP-001',
    'Hydraulic Press Unit 1',
    'Hydraulic Press',
    'available',
    NULL,
    NULL,
    NULL
  ),
  (
    'm5',
    'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid,
    'CNC-001',
    'CNC Machine Unit 1',
    'CNC Machine',
    'maintenance',
    NULL,
    NULL,
    NULL
  ),
  (
    'm6',
    '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid,
    'CMP-001',
    'Compressor Unit 1',
    'Compressor Unit',
    'assigned',
    's10',
    NULL,
    NULL
  ),
  (
    'm7',
    '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid,
    'GEN-001',
    'Industrial Generator Unit 1',
    'Industrial Generator',
    'available',
    NULL,
    NULL,
    NULL
  )
ON CONFLICT (id) DO NOTHING;
