import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client — for server components and route handlers
 * (app/new/page.tsx's session check, app/api/shift/route.ts). Reads the
 * session from the request's cookies (set by middleware.ts on every
 * request), not from anything passed in by the caller.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // called from a Server Component that can't set cookies —
            // middleware.ts already refreshes the session on every
            // request, so this is safe to ignore here
          }
        },
      },
    },
  );
}
