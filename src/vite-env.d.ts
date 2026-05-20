/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** When "true", attach seed company in browser if profile.company_id is null (demo only; not for production). */
  readonly VITE_DEMO_ATTACH_COMPANY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
