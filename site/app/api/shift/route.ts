import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GITHUB_REPO = "forma78/rubens";

/**
 * B3 — the site's one server-side function (docs/site-plan.md). Verifies
 * the caller is the signed-in owner and the brief is really pending, then
 * fires .github/workflows/shift.yml via workflow_dispatch. Does not run
 * the shift itself — Vercel has no function that stays alive for the
 * 60-180 minute batch path or even the several-minutes live path
 * (CLAUDE.md's "The live site").
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const briefId = body?.briefId;
  if (typeof briefId !== "string" || !briefId) {
    return NextResponse.json({ error: "briefId is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Fail fast on a stale/replayed request — the real, atomic guard against
  // a double dispatch is claimBrief()'s pending->running swap inside
  // run.js itself (sync.js), which this check does not replace.
  const { data: brief } = await supabase
    .from("briefs")
    .select("id,status")
    .eq("id", briefId)
    .eq("user_id", user.id)
    .single();
  if (!brief || brief.status !== "pending") {
    return NextResponse.json({ error: "brief is not pending" }, { status: 409 });
  }

  const token = process.env.GITHUB_TRIGGER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "GITHUB_TRIGGER_TOKEN is not configured" }, { status: 500 });
  }

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/shift.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { brief_id: briefId } }),
    },
  );

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text();
    return NextResponse.json({ error: `GitHub dispatch failed: ${text}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
