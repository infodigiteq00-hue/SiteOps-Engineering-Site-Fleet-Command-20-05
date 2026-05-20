-- Paste in Supabase → SQL Editor → Run once.
-- Fixes: "column company_invites.contact_phone does not exist" / profile phone not saving.
-- Why: the app stores invite + admin phone in these columns; your remote DB never got the migration.

ALTER TABLE public.company_invites ADD COLUMN IF NOT EXISTS contact_phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_phone text;
