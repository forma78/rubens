"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { JUDGES, generatorById, judgeById, initial, vendorLabel } from "@/lib/roles";
import { statusLabel, formatCommentDate } from "@/lib/shift";
import { CastSidebar } from "@/components/cast-sidebar";

type Variant = {
  id: string;
  round: number;
  label: string;
  source: string;
  agent_id: string | null;
  render_url: string | null;
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
  const roundClosed = (round: number) => round < maxRound || status === "done" || status === "aborted";

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

          {rounds.map(([round, roundVariants]) => (
            <div className="round-block" key={round}>
              <div className="round-heading">
                <span>
                  Round {round} — {roundVariants.length} image{roundVariants.length === 1 ? "" : "s"}
                </span>
                <Link href={`/shift/${brief.slug}/round/${round}`}>pairwise view →</Link>
              </div>
              <div className="work-grid">
                {roundVariants.map((v) => {
                  const gen = generatorById(v.agent_id);
                  const closed = roundClosed(round);
                  const verdict = !closed ? { text: "judging…", cls: "pending" } : v.survived ? { text: "approved", cls: "approved" } : { text: "rejected", cls: "rejected" };
                  return (
                    <div className="work-card" key={v.id}>
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
                })}
              </div>

              {(commentsByRound.get(round)?.length ?? 0) > 0 && (
                <div className="panel">
                  <div className="panel-head">
                    <span>{round === Math.max(...rounds.map(([r]) => r)) && roundClosed(round) ? "FINAL VERDICTS" : "COMMENTS"}</span>
                  </div>
                  <div className="panel-body" style={{ padding: "6px 14px 4px" }}>
                    {commentsByRound.get(round)!.map((c) => {
                      const judge = judgeById(c.judge_id);
                      return (
                        <div className="comment-row" id={`comment-${c.id}`} key={c.id}>
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
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div>
          <CastSidebar />
        </div>
      </div>
    </>
  );
}
