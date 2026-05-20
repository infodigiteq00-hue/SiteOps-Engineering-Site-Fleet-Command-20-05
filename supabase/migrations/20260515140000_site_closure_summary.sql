-- Snapshot of machinery disposition when a site is marked finished.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS closure_summary jsonb;
