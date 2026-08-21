import { Chrome } from "@/components/chrome";
import { createClient } from "@/lib/supabase/server";
import { shiftDate, shiftTitle, statusLabel } from "@/lib/shift";

// C1 (docs/site-plan.md) — the public feed, and now the site's actual
// landing page. Every brief is published the moment Go! is pressed
// (schema.sql, 2026-08-21), so this reads everything, newest first.
export default async function ArchivePage() {
  const supabase = await createClient();

  const { data: briefs } = await supabase
    .from("briefs")
    .select("id,slug,instruction,canvas_format,rounds,status,created_at")
    .order("created_at", { ascending: false })
    .limit(60);

  const briefIds = (briefs ?? []).map((b) => b.id);
  const { data: variants } =
    briefIds.length > 0
      ? await supabase
          .from("variants")
          .select("brief_id,render_url,rating,survived")
          .in("brief_id", briefIds)
          .order("survived", { ascending: false })
          .order("rating", { ascending: false })
      : { data: [] };

  const coverByBrief = new Map<string, string>();
  for (const v of variants ?? []) {
    if (!coverByBrief.has(v.brief_id) && v.render_url) coverByBrief.set(v.brief_id, v.render_url);
  }

  return (
    <Chrome active="archive" crumb="rubens-pearl / archive">
      <div className="page-head">
        <h1 className="page-title">Archive</h1>
        <span className="tagline">Every shift is a real spend.</span>
      </div>

      {!briefs?.length && (
        <div className="panel">
          <div className="panel-body">
            <p style={{ margin: 0, color: "var(--text-secondary)" }}>
              No shifts yet — the first one appears here the moment Go! is pressed.
            </p>
          </div>
        </div>
      )}

      <div className="archive-grid">
        {briefs?.map((b) => {
          const cover = coverByBrief.get(b.id);
          return (
            <a key={b.id} href={`/shift/${b.slug}`} className="card">
              {b.status === "running" && <span className="live-badge">LIVE</span>}
              {cover ? (
                <img src={cover} alt="" />
              ) : (
                <div className="placeholder">{b.status === "pending" ? "queued" : "rendering…"}</div>
              )}
              <div className="card-title">{shiftTitle(b.slug, b.instruction)}</div>
              <div className="card-meta">
                {shiftDate(b.slug, b.created_at)} · {b.canvas_format ?? "—"} · {statusLabel(b.status, b.rounds)}
              </div>
            </a>
          );
        })}
      </div>
    </Chrome>
  );
}
