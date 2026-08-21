"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { JUDGES, generatorById, vendorLabel } from "@/lib/roles";
import {
  canonColumns,
  canonRounds,
  canonThread,
  fullyJudged,
  generatedField,
  rankVariants,
  shiftTitle,
  statusLabel,
} from "@/lib/shift";
import { CommentRow } from "@/components/comment";
import { CastSidebar } from "@/components/cast-sidebar";

export type Variant = {
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

export type Comparison = {
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

// Live — the canon's key screen. Subscribes to the same three tables
// sync.js writes to incrementally (schema.sql's realtime publication,
// 2026-08-21): a variant's row lands the moment it renders, a comparison's
// the moment a judge answers, so this page fills in at reading speed
// exactly like the feed CLAUDE.md describes, not in a batch at the end.
//
// The shape is the canon's, and it is the same shape for every shift:
// 32 images generated once, then the shift's own real ranking cut in half
// four times — 32 / 16 / 8 / 4 / 2 at 8 / 8 / 4 / 2 / 2 to a row. Nothing
// is regenerated to fill a later round and nothing is invented to rank it;
// see lib/shift.ts's rankVariants for where the order comes from.
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

  // The 32 that were actually generated, and the comparisons that judged
  // them. A pre-2026-08-21 shift also has rounds 2-5 of freshly proposed
  // variants in the database; they stay in the record and on the round's
  // own pairwise view — the feed reads the shift the way it reads now.
  const field = useMemo(() => generatedField(variants), [variants]);
  const fieldComparisons = useMemo(() => {
    const ids = new Set(field.map((v) => v.id));
    return comparisons.filter((c) => (c.left_id && ids.has(c.left_id)) || (c.right_id && ids.has(c.right_id)));
  }, [comparisons, field]);

  const judged = useMemo(() => fullyJudged(field, fieldComparisons), [field, fieldComparisons]);
  const ranked = useMemo(
    () => (judged ? rankVariants(field, fieldComparisons) : field),
    [judged, field, fieldComparisons],
  );

  // Until every image has a real verdict behind it there is one round, the
  // one that is happening.
  const rounds = useMemo(
    () =>
      judged
        ? canonRounds(ranked)
        : [{ num: 1, columns: canonColumns(1), variants: field, advancing: 0 }],
    [judged, ranked, field],
  );

  const realRounds = new Set(variants.map((v) => v.round)).size;

  return (
    <>
      <h1 className="page-title">{shiftTitle(brief.slug, brief.instruction)}</h1>
      <div className="run-meta">
        {statusLabel(status, realRounds || brief.rounds)} · canvas {brief.canvas_format ?? "—"} · {JUDGES.length}{" "}
        judges · {field.length} proposals
      </div>

      <div className="layout-with-sidebar">
        <div>
          {!field.length && (
            <div className="panel">
              <div className="panel-body">
                <p style={{ margin: 0, color: "var(--text-secondary)" }}>
                  {status === "pending"
                    ? "Queued — GitHub Actions hasn't picked this up yet."
                    : "Rendering the first proposals now…"}
                </p>
              </div>
            </div>
          )}

          {rounds.map((round) => {
            const shownIds = new Set(round.variants.map((v) => v.id));
            const { thread, headToHead } = canonThread(fieldComparisons, shownIds);
            const final = judged && round.num === rounds.length;
            return (
              <div className="round-block" key={round.num}>
                <div className="round-heading">
                  <span>
                    Round {round.num} — {round.variants.length} image{round.variants.length === 1 ? "" : "s"}
                  </span>
                  <Link href={`/shift/${brief.slug}/round/${round.num}`}>pairwise view →</Link>
                </div>
                <div className="work-grid" data-cols={round.columns}>
                  {round.variants.map((v, i) => {
                    const verdict = !judged
                      ? { text: "judging…", cls: "pending" }
                      : i < round.advancing
                        ? { text: "approved", cls: "approved" }
                        : { text: "rejected", cls: "rejected" };
                    return <WorkCard v={v} verdict={verdict} key={v.id} />;
                  })}
                </div>

                {thread.length > 0 && (
                  <div className="panel">
                    <div className="panel-head">
                      <span>{final ? "FINAL VERDICTS" : "COMMENTS"}</span>
                      <span className="panel-note">
                        {headToHead ? "judged head to head" : "on the images still standing"}
                      </span>
                    </div>
                    <div className="comment-list">
                      {thread.map((c, i) => (
                        <CommentRow
                          key={c.id}
                          id={c.id}
                          judgeId={c.judge_id}
                          vendor={c.vendor}
                          why={c.why}
                          tail={`round ${round.num}`}
                          index={i}
                          threadHref={`/shift/${brief.slug}/round/${round.num}#comment-${c.id}`}
                        />
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
