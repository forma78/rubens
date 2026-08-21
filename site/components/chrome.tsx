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
  active: "archive" | "shift" | "new" | "about" | "login";
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
            {user && (
              <Link href="/new" aria-current={active === "new" ? "page" : undefined}>
                New brief
              </Link>
            )}
            <Link href="/about" aria-current={active === "about" ? "page" : undefined}>
              About
            </Link>
          </nav>
          <div className="identity">
            <span className="identity-line">{user ? "signed in — studio" : "not signed in — visitor"}</span>
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
