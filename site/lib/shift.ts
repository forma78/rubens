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

export function statusLabel(status: string, rounds: number): string {
  if (status === "pending") return "pending";
  if (status === "running") return `round ${rounds || 1} — running`;
  if (status === "aborted") return `aborted — ${rounds} round${rounds === 1 ? "" : "s"}`;
  if (status === "done") return `${rounds} round${rounds === 1 ? "" : "s"}`;
  return status;
}
