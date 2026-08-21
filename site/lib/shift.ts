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

// "Shift 07 — ribbons pulled tight", the canon's own title. A pre-migration
// slug (brief-<timestamp>-<uuid>, smoke-test-...) has no sequence number to
// put there, so it goes by its instruction alone rather than printing a
// uuid where the canon prints 07.
export function shiftTitle(slug: string, instruction: string): string {
  const snippet = instruction.split(/[.!?]/)[0]?.trim() ?? instruction;
  const words = snippet.split(/\s+/).slice(0, 6).join(" ");
  const parsed = parseSlug(slug);
  if (!parsed) return words || slug;
  return `Shift ${parsed.seq}${words ? ` — ${words}` : ""}`;
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

/* ------------------------------------------------------------------ canon

   rubens-claude-design/Rubens Prototype.dc.html's Live screen is the
   layout contract, and the screens Theo sent on 2026-08-21 are the single
   truth for how it reads: five rounds narrowing 32 -> 16 -> 8 -> 4 -> 2,
   laid out 8 / 8 / 4 / 2 / 2 images to a row so no round ever ends on a
   half-empty row. Shared by Live and Canon so both cut the same field the
   same way — the bug Theo caught was the two pages disagreeing.            */

export const CANON_COLUMNS = [8, 8, 4, 2, 2];

export function canonColumns(round: number): number {
  return CANON_COLUMNS[round - 1] ?? CANON_COLUMNS[CANON_COLUMNS.length - 1];
}

type Rankable = { id: string; rating?: number | null; created_at: string };
type Judged = { left_id: string | null; right_id: string | null; winner_id: string | null };

// The order this shift's own judging actually arrived at. `rating` is the
// real Elo eloRound() computed; a shift synced before syncVariantResults
// patched those ratings back — which is every shift in the database right
// now — leaves all 32 on the 1500 default, so fall back to net wins (wins
// minus losses) counted off the real comparisons. That is not a substitute
// ranking invented to fill a gap: with a uniform K-factor and equal
// appearances it reproduces the Elo order exactly (checked against
// runs/brief-1787183860194-0c4f3666/round-1/ratings.json — same order,
// same top 16). If nothing has been judged there is no order and the
// variants stay in the order they were rendered.
export function rankVariants<V extends Rankable>(variants: V[], comparisons: Judged[]): V[] {
  const distinct = new Set(variants.map((v) => v.rating ?? 1500));
  const useRating = distinct.size > 1;

  const net = new Map<string, number>();
  if (!useRating) {
    for (const c of comparisons) {
      for (const side of [c.left_id, c.right_id]) if (side) net.set(side, (net.get(side) ?? 0) - 1);
      if (c.winner_id) net.set(c.winner_id, (net.get(c.winner_id) ?? 0) + 2);
    }
  }

  const score = (v: V) => (useRating ? v.rating ?? 1500 : net.get(v.id) ?? 0);
  return [...variants].sort((a, b) => score(b) - score(a) || a.created_at.localeCompare(b.created_at));
}

// Has the field actually been judged? Not brief.status — a shift whose job
// was killed keeps `running` for ever, and two real shifts in the database
// are stuck exactly like that — but whether every image on screen has been
// in at least one real comparison. Until it has, the shift is still round
// 1 and nothing is narrowed: a "Round 2 — 16 images" built on half the
// verdicts would be a claim the run has not earned.
export function fullyJudged(variants: { id: string }[], comparisons: Judged[]): boolean {
  if (!variants.length) return false;
  const seen = new Set<string>();
  for (const c of comparisons) {
    if (c.left_id) seen.add(c.left_id);
    if (c.right_id) seen.add(c.right_id);
  }
  return variants.every((v) => seen.has(v.id));
}

// The variants a shift really generated. One real round of generation is
// all a shift runs now (schema.sql's briefs.rounds default), and the
// pre-2026-08-21 shift that really proposed fresh variants every round
// still narrows from its own round 1 — 32 images generated once, then cut
// in half four times, exactly as the canon reads.
export function generatedField<V extends { round: number }>(variants: V[]): V[] {
  if (!variants.length) return [];
  const first = Math.min(...variants.map((v) => v.round));
  return variants.filter((v) => v.round === first);
}

export type CanonRound<V> = {
  num: number;
  columns: number;
  variants: V[];
  /** how many of this round's images go on to the next one */
  advancing: number;
};

export function canonRounds<V>(ranked: V[]): CanonRound<V>[] {
  const sizes = narrowingSizes(ranked.length);
  return sizes.map((size, i) => ({
    num: i + 1,
    columns: canonColumns(i + 1),
    variants: ranked.slice(0, size),
    advancing: sizes[i + 1] ?? 1,
  }));
}

type Threadable = { left_id: string | null; right_id: string | null; why: string | null };

const pairKey = (c: Threadable) => [c.left_id, c.right_id].sort().join("|");

// The real verdicts that belong to a round. Judging is a sparse
// round-robin, not a bracket: in the shifts that have actually run, two
// images only ever met head to head in rounds 1 and 2 — by the top 8 the
// leaders had never been shown against each other at all. So a narrowed
// round has real verdicts *about* the images still standing, not between
// them, and the page has to say which of the two it is rather than let a
// verdict about some other pair read as the final call. `headToHead` is
// that flag; nothing here invents a verdict either way.
export function roundVerdicts<C extends Threadable>(
  comparisons: C[],
  shown: Set<string>,
): { list: C[]; headToHead: boolean } {
  const withText = comparisons.filter((c) => c.why && c.left_id && c.right_id);
  const both = withText.filter((c) => shown.has(c.left_id!) && shown.has(c.right_id!));
  if (both.length) return { list: both, headToHead: true };
  return { list: withText.filter((c) => shown.has(c.left_id!) || shown.has(c.right_id!)), headToHead: false };
}

// The canon shows one thread under a round, not a transcript: a judge's
// verdict and the other judges' verdicts on the *same pair*. That thread
// is real — the database holds 6 to 18 verdicts per pair — so the replies
// are replies to something, not filler. The whole set stays one click away
// on the round's own pairwise view.
export function canonThread<C extends Threadable>(comparisons: C[], shown: Set<string>, limit = 3) {
  const { list, headToHead } = roundVerdicts(comparisons, shown);
  if (!list.length) return { thread: [] as C[], headToHead };
  const key = pairKey(list[0]);
  return { thread: list.filter((c) => pairKey(c) === key).slice(0, limit), headToHead };
}
