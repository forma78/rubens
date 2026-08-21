import { notFound } from "next/navigation";
import { Chrome } from "@/components/chrome";
import { createClient } from "@/lib/supabase/server";
import { shiftSeq, canonRounds, fullyJudged, generatedField, rankVariants, roundVerdicts } from "@/lib/shift";
import { CastSidebar } from "@/components/cast-sidebar";
import { CommentRow } from "@/components/comment";
import { judgeById, vendorLabel } from "@/lib/roles";
import { fetchAllRows } from "@/lib/rows";

type CanonVariant = {
  id: string;
  label: string;
  render_url: string | null;
  source: string;
  agent_id: string | null;
  round: number;
  rating: number;
  created_at: string;
};

type CanonComparison = {
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
};

function tagOf(label: string): string {
  return /(\d+)\s*$/.exec(label)?.[1] ?? label;
}

// Canon — "what a judge is actually shown, A against B", for one round.
// Live narrows the same field the same way (lib/shift.ts's canonRounds):
// round 1 is the 32 that were generated, round N is the top of the shift's
// own real ranking. This page is the record behind that — every real
// comparison between the images round N still shows, in the order the
// judges answered, never an invented verdict. No comment composer: nobody
// but the studio can write, and the studio only ever reads this page too.
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

  // Paged — see lib/rows.ts; a plain select stops at 1000 rows and this
  // shift alone holds nearly three thousand real comparisons.
  const [allVariants, allComparisons] = await Promise.all([
    fetchAllRows<CanonVariant>((from, to) =>
      supabase
        .from("variants")
        .select("id,label,render_url,source,agent_id,round,rating,created_at")
        .eq("brief_id", brief.id)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    fetchAllRows<CanonComparison>((from, to) =>
      supabase
        .from("comparisons")
        .select("id,round,judge_id,vendor,left_id,right_id,shown_first,winner_id,why,created_at")
        .eq("brief_id", brief.id)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
  ]);

  const variantById = new Map(allVariants.map((v) => [v.id, v]));
  const field = generatedField(allVariants);
  const fieldIds = new Set(field.map((v) => v.id));
  const fieldComparisons = allComparisons.filter(
    (c) => (c.left_id && fieldIds.has(c.left_id)) || (c.right_id && fieldIds.has(c.right_id)),
  );

  const judged = fullyJudged(field, fieldComparisons);
  const rounds = judged ? canonRounds(rankVariants(field, fieldComparisons)) : [];
  const shown = rounds[round - 1];
  if (judged && !shown) notFound();

  const notNarrowedYet = !judged && round > 1;
  const shownIds = new Set((shown?.variants ?? field).map((v) => v.id));
  // Same cut Live makes, and the same honesty about what it is: from the
  // top 8 down these images were never shown against each other, so this
  // is every real verdict they were part of, not a head-to-head that
  // never happened.
  const { list: comparisons, headToHead } = notNarrowedYet
    ? { list: [], headToHead: true }
    : roundVerdicts(fieldComparisons, shownIds);

  return (
    <Chrome active="shift" crumb={`rubens-pearl / shift-${shiftSeq(slug)} / round-${round}`}>
      <h1 className="page-title">Round {round}</h1>
      <div className="run-meta">
        What a judge is actually shown, A against B · {shownIds.size} image{shownIds.size === 1 ? "" : "s"} ·{" "}
        {comparisons.length} real verdict{comparisons.length === 1 ? "" : "s"}
        {comparisons.length > 0 && !headToHead && " these images were part of"}
      </div>

      <div className="layout-with-sidebar">
        <div>
          {notNarrowedYet && (
            <div className="panel">
              <div className="panel-body">
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                  This round narrows once every image has been judged — it&apos;s the shift&apos;s own real ranking,
                  cut in half, not a fresh judging pass.
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
                  <div className="comment-list" style={{ padding: "6px 0 0" }}>
                    <CommentRow
                      id={c.id}
                      judgeId={c.judge_id}
                      vendor={c.vendor}
                      why={c.why}
                      tail={winnerLabel ? `chose ${winnerLabel}` : `round ${round}`}
                    />
                  </div>
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
