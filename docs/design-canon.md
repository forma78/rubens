# RubensJournal — design canon

The durable reference site-plan.md's A4 was waiting on. See it rendered
with real project data at the artifact linked from the 2026-08-19 session
(ask the owner for the link if it's not at hand — this file is the
source of truth for the tokens either way, the artifact is the preview).

Five rules first, because they're the ones that actually drift if unwritten:

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
5. **Square corners everywhere.** No `border-radius` on cards, tiles,
   badges, or the comment blocks — flat rectangles throughout. Circles
   are reserved for a portrait standing in for a person: the monogram
   avatar (an AI persona) and the Go button (Rubens's own self-portrait)
   — the only two exceptions in the whole canon, and the same category
   as rule 2's one icon-like exception.

## Colour

The palette is the four hand-painted studies — `studies/color_01.jpg`
through `color_04.jpg`, the same four `PRESETS` `src/engine/colour.js`
ships with and the generator's own "Reference library" opens on. That is
the whole colour system of this project. Nothing else gets invented
alongside them: no accent swatch, no second brand colour, no seasonal
variant. Each study lives in its own frame in the canon; a 5th slot is
the real **Add image** control (a dashed square, `+ Add image` in
accent colour, filling with `--accent-soft` on hover) — same copy as
`generator/index.html`'s own "Reference library" panel (`Add image`,
its `#uplabel`), not an invented label. This is where the eventual
brief-creation form's reference upload actually lives.

## Start a shift

The canvas-format picker gets its own section, **"Canvas size,"** at
the very top of the page, above Colour — it's the first real decision
in a brief, the seed of the
round, not a footnote. The 5 `CANVAS_PROFILES` keys from `canvas.js`
(`60x80`, `70x100`, `90x120`, `100x100`, `120x90`) as plain rectangular
chips, the selected one in accent colour and weight, no dropdown.

**Go** lives at the far right of the studies row (`margin-left: auto`
in that flex row) — after the four studies and the Add image control,
so the reading order is genuinely format → references → Go. It's
Peter Paul Rubens's own self-portrait (`studies/rubens.jpeg`), circular,
150px — the same size as a study card, `background-position: center
30%` to keep the face rather than crop into the hat. This is a second,
deliberate exception to rule 5's "square corners everywhere," alongside
the monogram avatar — both are portraits standing in for a person (an
AI persona there, the project's own namesake here), and a circle is
what marks that category on this page. `generator/index.html` has no
precedent for a submit control at all (it's live and reactive, no
submit step), so Go is this canon's own design, not a copy of anything.

A short note underneath — "A real shift, real spend — not a preview.
Confirms before it fires." — keeps the button from implying it's free
to press; CLAUDE.md's "costs are real" applies to the UI too, not just
the runner.

`studies/rubens.jpeg` sits alongside `color_01.jpg`–`color_04.jpg` in
the repo but isn't one of them — it never feeds `analyseFile()` or
`PRESETS`, it's a design asset for this one control. Worth a folder of
its own if `studies/` ever needs to stay strictly "what the engine
reads photographically."

Today, before A4 is built, a shift actually starts from the CLI
(`node src/syndicate/run.js --brief <path> --publish`, or `--brief-id
<uuid> --publish` for a site-created brief) or via the GitHub Actions
`workflow_dispatch` the site will eventually trigger — this Go button
is the target UI for that same action, not a new mechanism.

Everything below is UI plumbing, not palette — it exists so text is
legible and structure is visible, and stays out of the way of the actual
colour, which is always whichever study a layer is showing.

## Tokens

```css
:root {
  --bg: #ffffff;
  --surface: #f6f6f8;      /* note boxes, nested replies */
  --surface-2: #eeeef1;
  --ink: #14141a;          /* body text, headings */
  --ink-dim: #55565f;      /* secondary text */
  --ink-faint: #8b8c96;    /* meta, timestamps, ids */
  --accent: #2451c9;       /* "Journal" wordmark + live links — UI only, not part of the palette above */
  --accent-soft: #eaf0ff;
  --line: #e4e4ea;         /* card borders, dividers */
  --line-strong: #cfd0d8;
  --badge-bg: #14141a;     /* image-number pill */
  --badge-ink: #ffffff;
  --comment-bg: #f0f0f2;         /* a top-level comment block */
  --comment-bg-nested: #e7e7eb;  /* a reply — darker, not just indented */
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

Every rendered variant is 525×700px, exactly 3:4 — fixed by the engine
(`canvasFormat`/`ratio`), not something a layout should guess at. Size
both the `<img>` and its frame with **explicit matching pixel
width/height** (e.g. 150×200 for a gallery tile, 300×400 for a pairwise
tile — any multiple of 3:4), never a fluid `width: 100%` paired with an
HTML `height` attribute left to apply on its own. That combination is
exactly how the gallery grid distorted during this session: CSS `width:
100%` overrode the `width` attribute, nothing overrode `height`, so a
narrow flex/grid column squeezed the image horizontally while its height
stayed pinned to the attribute's px value.

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

**Comment thread** — built off the reference LiveJournal thread the
owner supplied (2026-08-19), adapted where it fought this system's own
canon. A comment is a flat, square-cornered block — `--comment-bg`, no
border, no radius — never a bordered card; the whole thread is a plain
stack of these, not a card wrapping cards. The monogram avatar stays
**circular**, matching "The cast" (LJ's own avatars are square, but one
avatar shape across the whole canon won by consistency). It sits left of
two stacked lines, `From: Name (role, vendor)` and `Date: ...`, both in
body type, `Name` in accent weight and colour, never the id. The verdict
text follows, then one bottom-left actions row of parenthesised text
links — `(Reply) (Thread) (Link)`, or `(Reply) (Parent) (Thread)
(Link)` on a reply — all four kept together rather than splitting
`(Link)` off to float top-right the way the LJ reference does. A reply
doesn't just indent (`margin-left`) — it also sits on
`--comment-bg-nested`, visibly darker, so depth reads even in a quick
scan, exactly like the reference's own darker "opera78" reply block.

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
