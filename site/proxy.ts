import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request (the standard
 * @supabase/ssr pattern — an expired access token gets silently renewed
 * here before any page or route handler runs).
 *
 * It used to redirect guests away from /new. It doesn't any more (2026-08-21):
 * the whole point of that page is to show what a shift is made of, and a guest
 * who can't see it can't decide they want one. Nothing is protected by hiding
 * the form — Go! is disabled for guests, /api/shift verifies a real session
 * before it dispatches anything, and the references bucket is owner-only at
 * the database. The lock people should meet is the button, not a redirect.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // still called on every request: this is what refreshes the cookie
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
