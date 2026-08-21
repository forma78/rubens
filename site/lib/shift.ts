// Shared by Archive/Live/Canon — none of these invent data, they only
// format what's already in a briefs row.

export function parseSlug(slug: string): { date: string; seq: string } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(slug);
  if (!m) return null;
  const [, y, mo, d, seq] = m;
  return { date: `${y}-${mo}-${d}`, seq };
}

// Old pre-migration slugs (brief-<timestamp>-<uuid>, smoke-test-...) don't
// match next_shift_slug()'s YYYYMMDDNN shape — schema.sql's default only
// applies going forward, existing rows keep what they had. Falls back to
// created_at so those rows still render a real date, not a blank.
export function shiftDate(slug: string, createdAt: string): string {
  return parseSlug(slug)?.date ?? createdAt.slice(0, 10);
}

export function shiftSeq(slug: string): string {
  return parseSlug(slug)?.seq ?? slug;
}

export function shiftTitle(slug: string, instruction: string): string {
  const seq = shiftSeq(slug);
  const snippet = instruction.split(/[.!?]/)[0]?.trim() ?? instruction;
  const words = snippet.split(/\s+/).slice(0, 6).join(" ");
  return `Shift ${seq}${words ? ` — ${words}` : ""}`;
}

export function formatCommentDate(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date} · ${time}`;
}

// 2026-08-21: a shift is one real round of generation+judging now (see
// schema.sql's `briefs.rounds` default and its comment) — "Round 2/3/4/5"
// on Live/Canon are not fresh judging, they're a real, honest halving of
// round 1's own final ranking (top 16, top 8, top 4, top 2 of the SAME
// real variants and the SAME real ratings), so a shift still reads as
// narrowing 32 -> 2 without a second round of paid API calls. Shared by
// Live and Canon so both cut the same field the same way.
export function narrowingSizes(total: number): number[] {
  if (total <= 0) return [];
  const sizes = [total];
  while (sizes.length < 5) {
    const next = Math.max(1, Math.floor(sizes[sizes.length - 1] / 2));
    if (next === sizes[sizes.length - 1]) break;
    sizes.push(next);
  }
  return sizes;
}

export function statusLabel(status: string, rounds: number): string {
  if (status === "pending") return "pending";
  if (status === "running") return `round ${rounds || 1} — running`;
  if (status === "aborted") return `aborted — ${rounds} round${rounds === 1 ? "" : "s"}`;
  if (status === "done") return `${rounds} round${rounds === 1 ? "" : "s"}`;
  return status;
}
