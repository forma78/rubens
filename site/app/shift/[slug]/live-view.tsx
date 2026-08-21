"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { JUDGES, generatorById, judgeById, initial, vendorLabel } from "@/lib/roles";
import { statusLabel, formatCommentDate, narrowingSizes } from "@/lib/shift";
import { CastSidebar } from "@/components/cast-sidebar";

type Variant = {
  id: string;
  round: number;
  label: string;
  source: string;
  agent_id: string | null;
  render_url: string | null;
  rating: number;
  survived: boolean;
  created_at: string;
};

type Comparison = {
  id: string;
  round: number;
  judge_id: string;
  vendor: string;
  why: string | null;
  winner_id: string | null;
  left_id: string | null;
  right_id: string | null;
  created_at: string;
};

type Brief = {
  id: string;
  slug: string;
  instruction: string;
  canvas_format: string | null;
  rounds: number;
  status: string;
};

function Comment({ c }: { c: Comparison }) {
  const judge = judgeById(c.judge_id);
  return (
    <div className="comment-row" id={`comment-${c.id}`}>
      <div className="comment-avatar" style={{ background: judge?.color ?? "#888" }}>
        {initial(judge?.name ?? "?")}
      </div>
      <div className="comment-body">
        <div className="comment-meta">
          <span className="name">{judge?.name ?? c.judge_id}</span> ({vendorLabel(c.vendor)}) · round {c.round}
        </div>
        <p className="comment-text">{c.why}</p>
        <div className="comment-actions">
          {formatCommentDate(c.created_at)} <a href={`#comment-${c.id}`}>(Link)</a>
        </div>
      </div>
    </div>
  );
}

function WorkCard({ v, verdict }: { v: Variant; verdict: { text: string; cls: string } }) {
  const gen = generatorById(v.agent_id);
  return (
    <div className="work-card">
      {v.render_url ? <img src={v.render_url} alt={v.label} /> : <div className="placeholder">rendering…</div>}
      <div className="work-meta">
        <span className="work-model">{vendorLabel(v.source)}</span>
        <span className={`work-verdict ${verdict.cls}`}>{verdict.text}</span>
        {gen && (
          <div className="work-artist">
            <span className="swatch" style={{ background: gen.color }} />
            <span>{gen.name}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Live — design_handoff's key screen. Subscribes to the same three tables
// sync.js writes to incrementally (schema.sql's realtime publication,
// 2026-08-21): a variant's row lands the moment it renders, a comparison's
// the moment a judge answers, so this page fills in at reading speed
// exactly like the feed CLAUDE.md describes, not in a batch at the end.
export function LiveView({
  brief,
  initialVariants,
  initialComparisons,
}: {
  brief: Brief;
  initialVariants: Variant[];
  initialComparisons: Comparison[];
}) {
  const [variants, setVariants] = useState<Variant[]>(initialVariants);
  const [comparisons, setComparisons] = useState<Comparison[]>(initialComparisons);
  const [status, setStatus] = useState(brief.status);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`shift-${brief.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "variants", filter: `brief_id=eq.${brief.id}` },
        (payload) => {
          const row = payload.new as Variant;
          setVariants((prev) => (prev.some((v) => v.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "variants", filter: `brief_id=eq.${brief.id}` },
        (payload) => {
          const row = payload.new as Variant;
          setVariants((prev) => prev.map((v) => (v.id === row.id ? { ...v, ...row } : v)));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comparisons", filter: `brief_id=eq.${brief.id}` },
        (payload) => {
          const row = payload.new as Comparison;
          setComparisons((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "briefs", filter: `id=eq.${brief.id}` },
        (payload) => {
          setStatus((payload.new as { status: string }).status);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [brief.id]);

  // Rounds as they actually happened. A shift from before 2026-08-21 (see
  // schema.sql) really did propose and judge fresh variants every round —
  // those rows carry real, distinct `round` values and render exactly as
  // they always have, below. A shift from now on only ever has round 1.
  const rounds = useMemo(() => {
    const map = new Map<number, Variant[]>();
    for (const v of variants) {
      if (!map.has(v.round)) map.set(v.round, []);
      map.get(v.round)!.push(v);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [variants]);

  const commentsByRound = useMemo(() => {
    const map = new Map<number, Comparison[]>();
    for (const c of comparisons) {
      if (!c.why) continue;
      if (!map.has(c.round)) map.set(c.round, []);
      map.get(c.round)!.push(c);
    }
    return map;
  }, [comparisons]);

  const maxRound = rounds.length ? rounds[rounds.length - 1][0] : 0;
  const finished = status === "done" || status === "aborted";
  const roundClosed = (round: number) => round < maxRound || finished;
  const singleRealRound = new Set(variants.map((v) => v.round)).size <= 1;

  // Only meaningful once judging is over — syncVariantResults patches real
  // ratings onto variants once at the end of the (one, real) round, not
  // incrementally, so mid-shift every rating is still the 1500 default.
  const rankedRound1 = useMemo(
    () => (singleRealRound && finished ? [...variants].sort((a, b) => (b.rating ?? 1500) - (a.rating ?? 1500)) : []),
    [variants, singleRealRound, finished],
  );
  const rankIndex = useMemo(() => new Map(rankedRound1.map((v, i) => [v.id, i])), [rankedRound1]);
  const narrowSizes = singleRealRound && finished ? narrowingSizes(rankedRound1.length) : [];

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{brief.instruction}</h1>
      </div>
      <p className="tagline" style={{ marginBottom: 18, display: "block" }}>
        {statusLabel(status, maxRound || brief.rounds)} · canvas {brief.canvas_format ?? "—"} · {JUDGES.length}{" "}
        judges
      </p>

      <div className="layout-with-sidebar">
        <div>
          {rounds.length === 0 && (
            <div className="panel">
              <div className="panel-body">
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                  {status === "pending" ? "Queued — GitHub Actions hasn't picked this up yet." : "Rendering the first proposals now…"}
                </p>
              </div>
            </div>
          )}

          {rounds.map(([round, roundVariants]) => {
            const closed = roundClosed(round);
            const isFinalReal = round === maxRound && closed && !singleRealRound;
            return (
              <div className="round-block" key={round}>
                <div className="round-heading">
                  <span>
                    Round {round} — {roundVariants.length} image{roundVariants.length === 1 ? "" : "s"}
                  </span>
                  <Link href={`/shift/${brief.slug}/round/${round}`}>pairwise view →</Link>
                </div>
                <div className="work-grid">
                  {roundVariants.map((v) => {
                    let verdict: { text: string; cls: string };
                    if (!closed) {
                      verdict = { text: "judging…", cls: "pending" };
                    } else if (singleRealRound) {
                      const idx = rankIndex.get(v.id) ?? 0;
                      const cutoff = narrowSizes[1];
                      const advances = cutoff !== undefined ? idx < cutoff : idx === 0;
                      verdict = advances ? { text: "approved", cls: "approved" } : { text: "rejected", cls: "rejected" };
                    } else {
                      verdict = v.survived ? { text: "approved", cls: "approved" } : { text: "rejected", cls: "rejected" };
                    }
                    return <WorkCard v={v} verdict={verdict} key={v.id} />;
                  })}
                </div>

                {(commentsByRound.get(round)?.length ?? 0) > 0 && (
                  <div className="panel">
                    <div className="panel-head">
                      <span>{isFinalReal ? "FINAL VERDICTS" : "COMMENTS"}</span>
                    </div>
                    <div className="panel-body" style={{ padding: "6px 14px 4px" }}>
                      {commentsByRound.get(round)!.map((c) => (
                        <Comment c={c} key={c.id} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Rounds 2+ for a single-real-round shift: not fresh judging —
              round 1's own real ranking, cut in half each time (32 -> 16 ->
              8 -> 4 -> 2), same real images, same real comparisons filtered
              to the pair still standing. See lib/shift.ts's narrowingSizes. */}
          {singleRealRound &&
            narrowSizes.slice(1).map((size, i) => {
              const roundNum = i + 2;
              const shown = rankedRound1.slice(0, size);
              const shownIds = new Set(shown.map((v) => v.id));
              const nextSize = narrowSizes[i + 2];
              const isFinal = i === narrowSizes.length - 2;
              const relevant = comparisons.filter(
                (c) => c.why && c.left_id && c.right_id && shownIds.has(c.left_id) && shownIds.has(c.right_id),
              );
              return (
                <div className="round-block" key={`synthetic-${roundNum}`}>
                  <div className="round-heading">
                    <span>
                      Round {roundNum} — {shown.length} image{shown.length === 1 ? "" : "s"}
                    </span>
                    <Link href={`/shift/${brief.slug}/round/${roundNum}`}>pairwise view →</Link>
                  </div>
                  <div className="work-grid">
                    {shown.map((v, idx) => {
                      const advances = nextSize !== undefined ? idx < nextSize : idx === 0;
                      const verdict = advances ? { text: "approved", cls: "approved" } : { text: "rejected", cls: "rejected" };
                      return <WorkCard v={v} verdict={verdict} key={v.id} />;
                    })}
                  </div>
                  {relevant.length > 0 && (
                    <div className="panel">
                      <div className="panel-head">
                        <span>{isFinal ? "FINAL VERDICTS" : "COMMENTS"}</span>
                      </div>
                      <div className="panel-body" style={{ padding: "6px 14px 4px" }}>
                        {relevant.map((c) => (
                          <Comment c={c} key={c.id} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        <div>
          <CastSidebar />
        </div>
      </div>
    </>
  );
}
