import { notFound } from "next/navigation";
import { Chrome } from "@/components/chrome";
import { createClient } from "@/lib/supabase/server";
import { shiftSeq, formatCommentDate, narrowingSizes } from "@/lib/shift";
import { CastSidebar } from "@/components/cast-sidebar";
import { judgeById, initial, vendorLabel } from "@/lib/roles";

function tagOf(label: string): string {
  return /(\d+)\s*$/.exec(label)?.[1] ?? label;
}

// Canon — "what a judge is actually shown" (design_handoff's Canon screen),
// for one round. A shift from before 2026-08-21 really judged fresh
// variants every round (schema.sql), so round N there means exactly what
// it says. A shift from now on only ever runs one real round — round N>1
// here means "the real round-1 comparisons between the pair still standing
// after halving to lib/shift.ts's narrowingSizes", same real `why` text,
// just filtered to the field that round represents. Never an invented
// verdict either way. No comment composer — nobody but the studio can
// write, and the studio only ever reads this page too.
export default async function CanonPage({ params }: { params: Promise<{ slug: string; n: string }> }) {
  const { slug, n } = await params;
  const round = Number(n);
  if (!Number.isInteger(round) || round < 1) notFound();

  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("briefs")
    .select("id,slug,instruction,status")
    .eq("slug", slug)
    .maybeSingle();
  if (!brief) notFound();

  const { data: allVariants } = await supabase
    .from("variants")
    .select("id,label,render_url,source,agent_id,round,rating")
    .eq("brief_id", brief.id);
  const variantById = new Map((allVariants ?? []).map((v) => [v.id, v]));

  const singleRealRound = new Set((allVariants ?? []).map((v) => v.round)).size <= 1;
  const finished = brief.status === "done" || brief.status === "aborted";

  let comparisons: {
    id: string;
    round: number;
    judge_id: string;
    vendor: string;
    left_id: string;
    right_id: string;
    shown_first: string;
    winner_id: string | null;
    why: string | null;
    created_at: string;
  }[] = [];
  let notNarrowedYet = false;

  if (round === 1 || !singleRealRound) {
    // Real per-round data — either round 1 of any shift, or a genuine
    // pre-2026-08-21 round with its own real judging.
    const { data } = await supabase
      .from("comparisons")
      .select("id,round,judge_id,vendor,left_id,right_id,shown_first,winner_id,why,created_at")
      .eq("brief_id", brief.id)
      .eq("round", round)
      .order("created_at", { ascending: true });
    comparisons = data ?? [];
  } else if (!finished) {
    notNarrowedYet = true;
  } else {
    const ranked = [...(allVariants ?? [])].sort((a, b) => (b.rating ?? 1500) - (a.rating ?? 1500));
    const sizes = narrowingSizes(ranked.length);
    const size = sizes[round - 1];
    if (size === undefined) notFound();
    const shownIds = new Set(ranked.slice(0, size).map((v) => v.id));

    const { data } = await supabase
      .from("comparisons")
      .select("id,round,judge_id,vendor,left_id,right_id,shown_first,winner_id,why,created_at")
      .eq("brief_id", brief.id)
      .order("created_at", { ascending: true });
    comparisons = (data ?? []).filter((c) => shownIds.has(c.left_id) && shownIds.has(c.right_id));
  }

  return (
    <Chrome active="shift" crumb={`rubens-pearl / shift-${shiftSeq(slug)} / round-${round}`}>
      <div className="page-head">
        <h1 className="page-title">Round {round}</h1>
        <span className="tagline">What a judge is actually shown, A against B</span>
      </div>

      <div className="layout-with-sidebar">
        <div>
          {notNarrowedYet && (
            <div className="panel">
              <div className="panel-body">
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                  This round narrows once judging finishes — it&apos;s round 1&apos;s own real ranking, cut in
                  half, not a fresh judging pass.
                </p>
              </div>
            </div>
          )}
          {!notNarrowedYet && !comparisons.length && (
            <div className="panel">
              <div className="panel-body">
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>No comparisons for this round.</p>
              </div>
            </div>
          )}
          {comparisons.map((c) => {
            const slotA = variantById.get(c.shown_first);
            const otherId = c.shown_first === c.left_id ? c.right_id : c.left_id;
            const slotB = variantById.get(otherId);
            const judge = judgeById(c.judge_id);
            const winnerLabel = c.winner_id === c.shown_first ? "A" : c.winner_id === otherId ? "B" : null;

            return (
              <div className="panel" key={c.id}>
                <div className="panel-head">
                  <span>PAIRWISE VIEW</span>
                  <span className="mono" style={{ fontWeight: 400, color: "var(--muted)" }}>
                    {judge?.name ?? c.judge_id} · {vendorLabel(c.vendor)}
                  </span>
                </div>
                <div className="panel-body">
                  <div className="pairwise">
                    <div className="pairwise-tile">
                      <span className="pairwise-tag">A · {slotA ? tagOf(slotA.label) : "—"}</span>
                      {slotA?.render_url ? <img src={slotA.render_url} alt="A" /> : <div className="placeholder">—</div>}
                    </div>
                    <span className="pairwise-vs">vs</span>
                    <div className="pairwise-tile">
                      <span className="pairwise-tag">B · {slotB ? tagOf(slotB.label) : "—"}</span>
                      {slotB?.render_url ? <img src={slotB.render_url} alt="B" /> : <div className="placeholder">—</div>}
                    </div>
                  </div>
                  {c.why && (
                    <div className="comment-row" id={`comment-${c.id}`} style={{ marginTop: 14 }}>
                      <div className="comment-avatar" style={{ background: judge?.color ?? "#888" }}>
                        {initial(judge?.name ?? "?")}
                      </div>
                      <div className="comment-body">
                        <div className="comment-meta">
                          <span className="name">{judge?.name ?? c.judge_id}</span> ({vendorLabel(c.vendor)})
                          {winnerLabel && <> · chose {winnerLabel}</>}
                        </div>
                        <p className="comment-text">{c.why}</p>
                        <div className="comment-actions">
                          {formatCommentDate(c.created_at)} <a href={`#comment-${c.id}`}>(Link)</a>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <CastSidebar />
        </div>
      </div>
    </Chrome>
  );
}
