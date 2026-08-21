import { notFound } from "next/navigation";
import { Chrome } from "@/components/chrome";
import { createClient } from "@/lib/supabase/server";
import { shiftSeq, formatCommentDate } from "@/lib/shift";
import { CastSidebar } from "@/components/cast-sidebar";
import { judgeById, initial, vendorLabel } from "@/lib/roles";

function tagOf(label: string): string {
  return /(\d+)\s*$/.exec(label)?.[1] ?? label;
}

// Canon — "what a judge is actually shown" (design_handoff's Canon screen),
// for one round. A round has many pairwise comparisons (pairsPerVariantPerJudge
// x judges), not one — so this lists every real comparison.jsonl row for the
// round, each with its two real renders and its real `why`, never an
// invented one (docs/design-canon.md's rule survives the canon swap: a
// verdict shown here has to be a real one). No comment composer — nobody
// but the studio can write, and the studio only ever reads this page too.
export default async function CanonPage({ params }: { params: Promise<{ slug: string; n: string }> }) {
  const { slug, n } = await params;
  const round = Number(n);
  if (!Number.isInteger(round) || round < 1) notFound();

  const supabase = await createClient();
  const { data: brief } = await supabase
    .from("briefs")
    .select("id,slug,instruction")
    .eq("slug", slug)
    .maybeSingle();
  if (!brief) notFound();

  const { data: comparisons } = await supabase
    .from("comparisons")
    .select("id,round,judge_id,vendor,model,left_id,right_id,shown_first,winner_id,why,created_at")
    .eq("brief_id", brief.id)
    .eq("round", round)
    .order("created_at", { ascending: true });

  const variantIds = [...new Set((comparisons ?? []).flatMap((c) => [c.left_id, c.right_id]))];
  const { data: variants } =
    variantIds.length > 0
      ? await supabase.from("variants").select("id,label,render_url,source,agent_id").in("id", variantIds)
      : { data: [] };
  const variantById = new Map((variants ?? []).map((v) => [v.id, v]));

  return (
    <Chrome active="shift" crumb={`rubens-pearl / shift-${shiftSeq(slug)} / round-${round}`}>
      <div className="page-head">
        <h1 className="page-title">Round {round}</h1>
        <span className="tagline">What a judge is actually shown, A against B</span>
      </div>

      <div className="layout-with-sidebar">
        <div>
          {!comparisons?.length && (
            <div className="panel">
              <div className="panel-body">
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>No comparisons judged for this round yet.</p>
              </div>
            </div>
          )}
          {comparisons?.map((c) => {
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
