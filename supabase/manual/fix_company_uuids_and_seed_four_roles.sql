/*
  STEP 1 = same IDs as src/lib/companyTenancy.ts
  Gujarat:  f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031
  Southern: 2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71
  (Pehli file 01_fix_company_ids_only.sql bhi OK — duplicate mat chalao dono ek saath blindly.)
*/

BEGIN;

INSERT INTO public.companies (id, name)
VALUES
  ('f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid, 'Gujarat Industrial Partners'),
  ('2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid, 'Southern Zone Operations')
ON CONFLICT (id) DO UPDATE SET name = excluded.name;

UPDATE public.profiles
SET company_id = 'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid
WHERE company_id IN (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
);

UPDATE public.profiles
SET company_id = '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid
WHERE company_id IN (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
);

DO $$
BEGIN
  IF to_regclass('public.sites') IS NOT NULL THEN
    UPDATE public.sites SET company_id = 'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid
    WHERE company_id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    );
    UPDATE public.sites SET company_id = '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid
    WHERE company_id IN (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    );
  END IF;
  IF to_regclass('public.machinery') IS NOT NULL THEN
    UPDATE public.machinery SET company_id = 'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid
    WHERE company_id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    );
    UPDATE public.machinery SET company_id = '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid
    WHERE company_id IN (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    );
  END IF;
  IF to_regclass('public.machinery_requests') IS NOT NULL THEN
    UPDATE public.machinery_requests SET company_id = 'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid
    WHERE company_id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    );
    UPDATE public.machinery_requests SET company_id = '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid
    WHERE company_id IN (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    );
  END IF;
  IF to_regclass('public.audit_ledger') IS NOT NULL THEN
    UPDATE public.audit_ledger SET company_id = 'f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid
    WHERE company_id IN (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
    );
    UPDATE public.audit_ledger SET company_id = '2a9e5d1c-86b4-4ec8-b73f-6b2c9d104e71'::uuid
    WHERE company_id IN (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    );
  END IF;
END $$;

DELETE FROM public.companies
WHERE id IN (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
);

COMMIT;

/* STEP 2 — roles: company = f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031 (Gujarat) */
-- SELECT id, email FROM auth.users ORDER BY created_at DESC;
-- UPDATE public.profiles SET role='firm_admin', company_id='f7c2a8e4-3b91-4a6d-9c2d-1a8e4f7b9031'::uuid, full_name='Demo Firm Admin', assigned_site_ids='{}' WHERE id='USER_UUID'::uuid;
-- … (same as before)
