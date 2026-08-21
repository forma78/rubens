import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// Global chrome (top bar + sub bar + page container), design_handoff's
// section 1. One nav item per real, always-valid destination — "Canon"
// and a global "Live" only exist per-shift in this app (there's no
// standalone Live/Canon section), so "Live" resolves to the most recently
// created shift instead of a fixed route, and "Canon" isn't in the top
// nav at all; it's reached from a Live page's own round links.
export async function Chrome({
  active,
  crumb,
  children,
}: {
  active: "archive" | "shift" | "generator" | "new" | "about" | "login";
  crumb: string;
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: latest } = await supabase
    .from("briefs")
    .select("slug")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="wordmark">
            Rubens<span className="accent">Journal</span>
          </Link>
          <nav className="topnav">
            <Link href="/" aria-current={active === "archive" ? "page" : undefined}>
              Archive
            </Link>
            {latest?.slug && (
              <Link href={`/shift/${latest.slug}`} aria-current={active === "shift" ? "page" : undefined}>
                Live
              </Link>
            )}
            {/* open to everyone — the canon's own nav carries it with a lock
                for guests (briefLock). Reading the brief costs nothing; only
                Go! is studio-only, and /api/shift checks the session itself. */}
            <Link href="/new" aria-current={active === "new" ? "page" : undefined}>
              New brief{user ? "" : " 🔒"}
            </Link>
            <Link href="/about" aria-current={active === "about" ? "page" : undefined}>
              About
            </Link>
            <Link href="/generator" aria-current={active === "generator" ? "page" : undefined}>
              Generator
            </Link>
          </nav>
          <div className="identity">
            <span className="identity-line">{user ? "signed in — studio" : "not signed in — guest"}</span>
            <span className={`avatar ${user ? "admin" : "guest"}`}>
              {user ? (user.email?.charAt(0).toUpperCase() ?? "A") : "G"}
            </span>
          </div>
        </div>
      </div>
      <div className="subbar">
        <div className="subbar-inner">
          <span className="crumb">{crumb}</span>
        </div>
      </div>
      <div className="page">
        {children}
        <div className="page-footer">
          RubensJournal — a syndicate of agents searching the space a hand-derived generator opens.
        </div>
      </div>
    </>
  );
}
