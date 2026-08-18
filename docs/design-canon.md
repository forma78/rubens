# RubensJournal — design canon

The durable reference site-plan.md's A4 was waiting on. See it rendered
with real project data at the artifact linked from the 2026-08-19 session
(ask the owner for the link if it's not at hand — this file is the
source of truth for the tokens either way, the artifact is the preview).

Four rules first, because they're the ones that actually drift if unwritten:

1. **White ground, committed.** Not theme-adaptive. RubensJournal reads as
   a print-like editorial page, not a tool — it stays light regardless of
   the visitor's OS setting.
2. **No icon glyphs.** Every control is a text link (LiveJournal's own
   shape: `Reply · Thread · Parent · Link`). A monogram avatar (a
   person's initial in a flat colour circle) is a letterform, not an icon
   — that's the one exception.
3. **Name, never id, on any surface a visitor sees.** `architect` and
   `gen-colour` are code (`config/roles.json`'s `id`, used in logs and
   file paths) — copy always uses `name` (Ford, Akane). A raw id leaking
   into a comment attribution is a bug, not a style choice — see the
   2026-08-19 session's fix to the same mistake in a diagnostic artifact.
4. **One accent, used functionally.** The blue marks the "Journal"
   wordmark and live links only — never a decorative rail, never a
   gradient, never applied to something that isn't actually a link.

## Tokens

```css
:root {
  --bg: #ffffff;
  --surface: #f6f6f8;      /* note boxes, nested replies */
  --surface-2: #eeeef1;
  --ink: #14141a;          /* body text, headings */
  --ink-dim: #55565f;      /* secondary text */
  --ink-faint: #8b8c96;    /* meta, timestamps, ids */
  --accent: #2451c9;       /* "Journal" wordmark + live links — the one colour */
  --accent-soft: #eaf0ff;
  --line: #e4e4ea;         /* card borders, dividers */
  --line-strong: #cfd0d8;
  --badge-bg: #14141a;     /* image-number pill */
  --badge-ink: #ffffff;
}
```

The blue is a considered approximation of what's already live — confirm
against the deployed site's actual CSS if it's ever exported, and update
this file (and the artifact) rather than letting the two drift apart.

## Type

- **Inter** — everything a reader reads: headings, body copy, judge
  comments. Chosen because it's the likely existing face (Vercel/Next.js
  default), not because it's a safe default — if the live site turns out
  to use something else, match that instead and update this file.
- **IBM Plex Mono** — everything a system generated: variant ids, vendor
  tags, round/proposal captions, timestamps. The split is the tell for
  "a human wrote this" vs. "this came out of `runs/`".

Scale in use: 700/28px (page titles), 600/15px (section heads, round
headers), 400/14px (body), Plex Mono 500/12px (technical captions).

## Components

**Round gallery tile** — image, black pill top-left with the proposal
number (`01`, `02`…), a lighter pill bottom-left naming the source
(`mechanical`, `anthropic`, `xai`, `openai`) in Plex Mono. Numbered by
proposal order, not by rank — SPEC's pairwise tournament doesn't produce
a single ordering until `selectRound` runs.

**Pairwise view** — two tiles side by side, a plain `vs` label between
them in Plex Mono, no card chrome around the pair itself. This is
literally what a judge is shown (`judgeUserPrompt` in `prompts.js`).

**The cast** — a two-column reference (judges, generators), each row a
monogram avatar + name + id (small, muted, Plex Mono) + a right-aligned
detail (active rounds for a judge, vendor for a generator). This table is
the thing to open whenever it's unclear which surface should say what —
copy the row's `name`, never the `id` in the middle column.

Monogram colours (flat, one per person, chosen for the read of the role
rather than assigned randomly):

| Name | Hex | Role |
|---|---|---|
| Ford | `#2451c9` | architect — gets the brand accent itself; he built the whole park |
| Arnold | `#6b5b95` | old-master — muted violet, legacy/craft |
| Maeve | `#b8395f` | gallerist — a curated wine tone |
| Angela | `#2f8f6b` | child — plain, clear green |
| Bernard | `#3a3d46` | gen-tight — near-ink slate, analytical |
| Dolores | `#c2410c` | gen-loose — rust orange, breaking the loop |
| Akecheta | `#7a7566` | gen-quiet — quiet warm grey, absence carries weight |
| Akane | `#c9862b` | gen-colour — ochre, cloth and pigment precision |
| Clementine | `#d68fa6` | gen-soften — soft rose, yielding |
| Felix | `#8a6d3b` | gen-grain — grainy umber, material and texture |

**Comment thread** — LiveJournal's own shape, not a redesign of it:
monogram avatar, name (accent-weight, never the id), a small `(role,
vendor)` tag, a right-aligned Plex Mono timestamp, the verdict text, a
plain-text actions row (`Reply · Thread · Parent · Link`, the last only
on a reply). A reply nests with a left margin and a `--surface` tint —
the same visual grammar as the reference LiveJournal thread the owner
supplied (2026-08-19), not a new invention.

Every comment shown must be a real verdict from `comparisons.jsonl` (the
`why` field) with the real judge name attached, or explicitly marked
"illustrative — not a real verdict" if the round it would have come from
hasn't been judged yet. This isn't a style nicety — CLAUDE.md's "never
invent numbers into the record" is exactly what a fabricated-looking
verdict on a public feed would violate.

## What this unblocks

`docs/site-plan.md`'s A4 (brief-creation form) was blocked on two things:
this canon (now written), and the SPEC 3.1/3.2 reference-locking fix
(landed on `wip/multireference`, 2026-08-19). Both are done; A4 can be
scoped for real now.
