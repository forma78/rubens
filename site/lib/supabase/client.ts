import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client — used from client components (the brief
 * form's file uploads, the login form's sign-in call). Reads the anon key,
 * same as every other surface in this project (src/syndicate/sync.js,
 * run.js) — RLS in schema.sql is what actually restricts what it can do.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
