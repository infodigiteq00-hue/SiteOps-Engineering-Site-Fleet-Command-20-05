/*
  Enable Supabase Realtime on operational and admin tables so the client
  useOperationalRealtime hook receives postgres_changes and auto-refreshes UI data.
*/

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sites',
    'machinery',
    'machinery_requests',
    'audit_ledger',
    'profiles',
    'companies',
    'company_invites',
    'company_machinery_source_statuses'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;
