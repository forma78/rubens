# Handoff: RubensJournal front-end (admin + guest)

## Overview
A front-end architecture prototype for **RubensJournal** (repo `forma78/rubens`, live at rubens-pearl.vercel.app). It answers the open question from the current `/new` page: what does the whole site look like, and who is allowed to spend tokens.

Four screens, one role switch:

| Screen | Route (suggested) | Who |
| --- | --- | --- |
| Archive | `/` | everyone |
| Live | `/shift/:slug` | everyone (read-only for guests) |
| Canon (pairwise + thread) | `/shift/:slug/round/:n` | everyone; commenting = admin |
| New brief | `/new` | admin only (guest sees it, cannot fire) |
| About | `/about` | everyone |

The single hard rule the prototype exists to express: **only an authenticated studio user can fire a shift.** Go! is the only action that spends money, so it must be gated server-side, not just visually.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing intended look and behaviour, not production code to copy. The task is to **recreate these designs in the target codebase's own environment** (the repo's static site + GitHub Actions + Supabase shape described in `docs/SPEC.md`), using its established patterns. Do not ship the prototype's markup; treat it as the visual and behavioural spec.

## Fidelity
**High fidelity.** Colours, type sizes, borders, spacing and copy are final-intent and can be lifted exactly. The deliberate visual reference is *Behance / early-2010s web*: light grey page ground, white bordered panels with 1px hairlines and a 1px soft shadow, dark gradient top bar, monospace metadata, no rounded-corner cards, no gradients-as-decoration.

Two things are stubs, clearly marked below: the two painting PNGs stand in for all 62 generated works, and comment/verdict text is representative sample copy.

---

## Screens / Views

### 1. Global chrome (all screens)

**Top bar** — height 46px, background `linear-gradient(#4a4a4a,#1c1c1c)`, `border-bottom:1px solid #000`, inset highlight `0 1px 0 rgba(255,255,255,.12)`. Inner container `max-width:980px; margin:0 auto; padding:0 14px`, flex, gap 22px.
- Wordmark: 18px bold, `#fff`, `text-shadow:0 -1px 0 #000`, letter-spacing -.3px. "Rubens" + "Journal" where "Journal" is `#5b9bd8`.
- Nav items: `Archive · Live · Canon · New brief · About`. 12px bold, `padding:6px 11px`, `border-radius:3px`, `white-space:nowrap`. Inactive `#c8c8c8`; active `#fff` on `rgba(255,255,255,.14)`.
- "New brief" carries a 🔒 suffix when the viewer is a guest.
- Right side: identity line 11px `#9a9a9a` — "signed in — studio" / "not signed in — visitor" — then a 26px square avatar, `border-radius:3px`, `1px solid #000`; admin `#a3123c` "T", guest `#6a6a6a` "G".

**Sub bar** — height 29px, `linear-gradient(#f4f4f4,#e2e2e2)`, `border-bottom:1px solid #b9b9b9`.
- Left: breadcrumb in monospace 11px `#666` — `rubens-pearl / archive`, `/ new`, `/ shift-07 / live`, `/ shift-06 / round-3`, `/ about`.
- Right: **prototype-only** Admin/Guest segmented control (1px `#a9a9a9`, radius 3px; selected = `linear-gradient(#5b9bd8,#2b6fb0)` + `#fff`, unselected = `linear-gradient(#fff,#e8e8e8)` + `#555`). **Do not ship this** — it exists so a reviewer can flip roles. In production the role comes from the session.

**Page container** — `max-width:980px; margin:0 auto; padding:18px 14px 60px`. Page ground `#d7d7d7`. Footer note 11px `#7d7d7d` above a `1px solid #c2c2c2` rule.

**Panel pattern (used everywhere)** — `background:#fff; border:1px solid #c4c4c4; box-shadow:0 1px 2px rgba(0,0,0,.14)`. Panel header strip: `linear-gradient(#fbfbfb,#ededed)`, `border-bottom:1px solid #d5d5d5`, `padding:8px 12px`, 11px bold `#444`.

**Section label pattern** — monospace 10px, `letter-spacing:1.4px`, `#8a8a8a`, `padding-bottom:6px`, `border-bottom:1px solid #e4e4e4` (e.g. CANVAS SIZE, INSTRUCTION, COMMENT THREAD, PAIRWISE VIEW).

### 2. Archive
Purpose: browse every shift, paid and unpaid.
- H1 "Archive" 22px bold `#222`, letter-spacing -.3px; tagline beside it 11px `#777`: "Every shift is a real spend. The syndicate runs five rounds and 32 proposals per shift."
- Grid: `repeat(5, 1fr)`, gap 12px, 10 cards.
- Card: panel + `padding:5px`. Image `display:block; width:100%; height:auto` (see Assets). Below: title 13px bold, link colour `#0d5aa7`; meta monospace 10px `#8a8a8a` (`date · canvas · rounds`); stats row 11px `#777` above a `1px solid #ededed` rule — `▲ appreciations ◉ views ❑ comments`.
- The running shift carries a LIVE badge: absolute `top:6px;left:6px`, `#c8103c` on `#fff`, monospace 9px bold, letter-spacing .9px, `padding:3px 6px`, radius 2px, 1.6s opacity pulse (1 → .35 → 1).
- No comment thread on this screen (deliberate — threads live in Live).

### 3. Live — the key screen
Purpose: watch a shift narrow 32 → 2, with the jury arguing in between.
- H1 = shift title, 22px bold. Sub-line 11px `#777`: "Round 1. canvas 70x100 · 4 judges · 32 generators".
- Body layout: `grid-template-columns: 1fr 240px; gap:18px; align-items:start`.
- **Rounds column** — five round blocks, `margin-bottom:30px` each:
  - Round heading 13px bold `#333`, `padding-bottom:6px`, `border-bottom:1px solid #c9c9c9`: "Round N — C images".
  - Image grid, gap 12px, columns **must** be `repeat(n, minmax(0,1fr))` — plain `1fr` resolves unequal tracks because the captions differ in min-content width. Column counts by round: **R1 32 imgs / 8 cols · R2 16 / 8 · R3 8 / 4 · R4 4 / 2 · R5 2 / 2.** Every count divides evenly, so no ragged last row, and the works grow as the field narrows.
  - Work card: panel + `padding:5px`, image `width:100%;height:auto`, then `padding:7px 3px 3px` holding — model name (monospace 10px `#8a8a8a`: "Grok 4.6" / "GPT-2" / "Opus 5"), verdict (monospace 10px bold — approved `#1f8a5a`, rejected `#a3123c`), artist row (12px square swatch radius 2px in the generator's colour + monospace 9px `#666` name).
  - Comments panel after every round: header strip with monospace 10px label "COMMENTS" (last round: "FINAL VERDICTS"); body `padding:6px 14px 4px`. **No input box on Live** — only the bots comment here.
  - Comment row: flex, gap 9px, `padding:12px 0`, `border-top:1px solid #f0f0f0` (first row none). 36px avatar square radius 3px in the judge's colour, white 14px bold initial. Meta line 11px `#8a8a8a` with name 12px bold `#0d5aa7`, then `(role, vendor) · round N`. Body 12px `#333`, line-height 1.6. Action line 11px `#9a9a9a`: `(Reply) (Thread) (Link)`. Replies are indented `margin-left:44px` on `#f7f7f7` with `padding-left:10px`.
- **Sidebar** — two panels, "Judges" (Ford/architect rounds 1-5, Arnold/old-master 3-5, Maeve/gallerist 1-5, Angela/child 4-5) and "Generators" (Bernard gen-tight anthropic, Dolores gen-loose xai, Akecheta gen-quiet anthropic, Akane gen-colour xai, Clementine gen-soften openai, Felix gen-grain openai). Row: 26px avatar, name 12px bold, tag monospace 9px `#9a9a9a`, right-aligned monospace 9px `#a8a8a8` (rounds / vendor), `border-bottom:1px solid #f2f2f2`.

**Streaming requirement (from the brief, not visible in a static screenshot):** works must appear **one at a time, a few seconds apart**, and each judge's verdict must land under its round as the vendor returns it — never a batch of 32 dropped at once. New items should animate in: `opacity 0 → 1` with `translateY(10px) → 0`, .45s ease-out.

### 4. Canon (pairwise + thread)
Purpose: show what a judge is actually shown, and hold the human conversation.
- Layout `1fr 240px`, gap 18px.
- PAIRWISE VIEW panel: two framed images (`1px solid #d5d5d5`, `padding:6px`) side by side with a monospace 11px `#9a9a9a` "vs" between, gap 18px. Each carries a corner tag `A · 01` / `B · 02`: absolute 11px inset, `#1c1c1c` bg, `#fff`, monospace 9px, `padding:2px 5px`.
- COMMENT THREAD panel: composer (38px avatar + textarea, `min-height:66px`, `1px solid #bdbdbd` with `border-top-color:#a8a8a8`, radius 3px) then the thread using the same comment row spec as Live, with indented replies. Guest state: textarea `readOnly`, background `#f4f4f4`, placeholder "Sign in to leave a comment — reading is open to everyone.", Post button greyed (`linear-gradient(#f4f4f4,#e4e4e4)` / `#a0a0a0`) and opens the sign-in dialog.
- Sidebar: Appreciate button (full-width, `linear-gradient(#5b9bd8,#2b6fb0)`, 1px `#1e4f80`; toggled state `linear-gradient(#2f7f55,#1f6040)` with "✓ Appreciated") + count line monospace 10px "N appreciations · anyone may"; then the Judges and Generators panels.

### 5. New brief (admin only)
Layout `1fr 260px`, gap 18px.
- Panel header "Compose a shift" + right-aligned monospace 10px "draft · v1".
- **CANVAS SIZE** — chips `60x80, 70x100, 90x120, 100x100, 120x160`, monospace 12px, `padding:7px 13px`, radius 3px. Unselected: 1px `#c4c4c4`, `linear-gradient(#fff,#f2f2f2)`, `#555`. Selected: 1px `#2b6fb0`, `#eaf2fb`, `#0d5aa7`. (Note 120x160 replaced the earlier 120x90.)
- **COLOUR — four hand-painted studies** — 4-up grid, gap 10px; each `1px solid #d0d0d0`, `padding:5px`, image + monospace 10px name (`color_01`…) + monospace 9px `#9a9a9a` slot (`L[0] default`, `L[3], L[4] default`). These are the generator's own studies; nothing invented beside them.
- **Attach your own study** — dashed 1px `#9a9a9a` button "＋ Attach your own study", note "PNG or JPG — enters the run as a fifth study." On attach, a row appears: 34px thumb, monospace filename + "uploaded · slot L[5]", Remove link `#a3123c`. Maps to the repo's `references` array (1–4 overrides per colour layer, plus this custom slot). Guest: dashed `#cfcfcf`, text `#aaa`, note "Studio only."
- **INSTRUCTION** — textarea, Georgia 13px, `min-height:92px`. Sample copy: "Anxious. The ribbons pulled tight, the cloth crowded under them."
- **Go!** — 88px circle, `radial-gradient(circle at 40% 30%, #6b5a48, #2a211a)` under the Rubens self-portrait (`background-size:cover; background-position:50% 22%`), `border:2px solid #2a2a2a`, `box-shadow:0 2px 4px rgba(0,0,0,.3), 0 0 0 4px rgba(255,255,255,.6)`. Label "Go!" 20px bold `#fff` on `rgba(20,14,10,.55)` chip. Hover `filter:brightness(1.12)`. Beside it: "A real shift, real spend — not a preview." / "Confirms before it fires."
  - Guest: grey radial, `opacity:.55`, label 🔒, copy "Go! is disabled for visitors." / "You can still read the brief and watch the run." Clicking opens the sign-in dialog.
- Sidebar: "Estimated spend" (rounds 5, proposals 32, studies 4|5, judges 4, tokens ~1.9M) and "Who can fire a shift" (admin composes/fires/pauses/aborts; guest reads, watches, no spend).

### 6. About
Editorial page built from the repository README: lede, "The loop", Updates 1–5, the repository map table, "Method, honestly stated", "Uccle, Belgium. 2026."
- Body copy Georgia 13px, `line-height:1.75`, `text-align:justify`, `text-wrap:pretty`, `#333`. H1 Georgia 26px normal weight. Section headings 13px bold `#222`. Hairline dividers `#e0e0e0`.
- Repository map: rows with monospace 11px `#0d5aa7` path (width 118px) + Georgia 12px description.
- Sidebar: repo facts (repo, branch, commits, licence, links) and a "Running a shift" note on Live vs Night shift (`judging.useBatchApi`).

---

## Interactions & Behavior
1. **Role switch (prototype only)** — flips every gated affordance at once: Go!, the New brief lock icon, the comment composer, the identity line and avatar.
2. **Go! → confirm dialog** (admin) — 430px, `1px solid #8f8f8f`, `box-shadow:0 8px 26px rgba(0,0,0,.4)`, dark gradient title bar "Fire the shift?". Body 13px: real spend, five rounds, 32 proposals, four judges, ~1.9M tokens. Monospace summary strip on `#f6f6f6`: `canvas 70x100 · studies 4 · instruction N chars`. Cancel (outlined) / "Go! — spend it" (blue). Confirm navigates to Live and starts the run.
3. **Go! → sign-in dialog** (guest) — 340px, same chrome, title "Studio only", email + password, "Keep watching" / "Sign in". Explains guests read everything, spend nothing.
4. **Appreciate** — optimistic toggle, ±1, available to guests.
5. **Post a comment** — admin appends immediately; guest click opens the sign-in dialog.
6. **Run controls** (admin, when a run is in flight) — Pause / Continue / Abort. Guests see "You are watching. Controls belong to the studio."
7. **Animations** — `rjIn` .45s ease-out (opacity + 10px rise) for arriving works and verdicts; `rjPulse` 1.6s infinite for the LIVE badge. No other motion.
8. **Links** — default `#0d5aa7`, hover `#0a3f78` + underline.

## State Management
- `role`: 'admin' | 'guest' — **server-derived in production.**
- `page` / route.
- Brief draft: `size`, `instruction`, `attachedStudy`.
- Run: `running`, `paused`, `rounds[]` (each: number, count, images[], comments[]), progress, spend estimate.
- Work item: `{ id, src, model, verdict: 'approved'|'rejected', artist, round }`.
- Comment: `{ id, author, role, vendor, round, text, parentId }`.
- UI: `showConfirm`, `showSignin`, `appreciated`, `draft`.

Data flow in the real app: site dispatches a GitHub Actions run, the run writes to Supabase, the site subscribes and appends works/verdicts as rows land. The page must render correctly at any partial state (0 works, mid-round, aborted).

## Security requirements (non-negotiable)
- Dispatching a shift must be authorised **on the server**. Hiding the button is presentation only.
- No vendor keys in the client; the site never calls a model API directly.
- Guests: read all shifts, works, verdicts, comments. Cannot dispatch, pause, abort, upload a study, or comment.
- Rate-limit dispatch per account regardless of role.

## Design Tokens
**Colour**
```
page ground        #d7d7d7      panel bg           #ffffff
panel border       #c4c4c4      panel shadow       0 1px 2px rgba(0,0,0,.14)
header strip       #fbfbfb → #ededed, border #d5d5d5
top bar            #4a4a4a → #1c1c1c, border #000
sub bar            #f4f4f4 → #e2e2e2, border #b9b9b9
text               #222 / #333      secondary #666 / #777
muted              #8a8a8a / #9a9a9a / #a8a8a8
hairline           #e4e4e4 / #ededed / #f0f0f0 / #f2f2f2
link               #0d5aa7   hover #0a3f78
accent blue        #5b9bd8 → #2b6fb0, border #1e4f80
approved / ok      #1f8a5a       rejected / danger  #a3123c
danger button      #c8506a → #a3123c, border #8e2b2b
admin avatar       #a3123c       guest avatar       #6a6a6a
live badge         #c8103c
judges             Ford #1a4fd0 · Arnold #7a5aa8 · Maeve #c2265a · Angela #1f8a5a
generators         Bernard #1c2a4a · Dolores #b8461c · Akecheta #4a4238 ·
                   Akane #c9902e · Clementine #d68aa8 · Felix #6b5230
```
**Type** — UI: Arial/Helvetica 11 / 12 / 13 / 16 / 18 / 22px. Metadata + code: Menlo/Consolas 9 / 10 / 11px. Editorial + instruction: Georgia 12 / 13 / 14 / 26px, line-height 1.75.
**Spacing** — 4 / 5 / 6 / 8 / 10 / 12 / 14 / 18 / 22 / 26 / 30 / 34px. Grid gaps 12px (works) and 18px (columns). Container 980px, sidebar 240px (260px on New brief).
**Radius** — 2px (tiny tags), 3px (buttons, avatars, inputs), 50% (Go!).
**Shadow** — panels `0 1px 2px rgba(0,0,0,.14)`; dialogs `0 8px 26px rgba(0,0,0,.4)`; Go! `0 2px 4px rgba(0,0,0,.3), 0 0 0 4px rgba(255,255,255,.6)`.

## Assets
- `assets/Unknown.png`, `assets/Unknown-1.png` — two **real** generator outputs, 525×700 (3:4). They stand in for all 62 works shown across the five rounds.
  **Hard constraint from the client:** never distort or crop them. Always `display:block; width:100%; height:auto` inside a fluid track — no fixed heights, no `object-fit:cover`, no forced 100% height. Production images are 3:4 as well; keep the aspect from the record rather than assuming.
- `assets/rubens.jpeg` — Rubens self-portrait used as the Go! button face (public-domain painting).
- Icons are text glyphs on purpose (▲ ◉ ❑ ＋ ✓ 🔒 ✓) to match the period styling. If the codebase has an icon set, keep them this quiet.

## Files
- `Rubens Prototype.dc.html` — the full prototype (all five screens, both roles, both dialogs). Open it in a browser; use the Admin/Guest switch in the sub bar.
- `assets/` — the images above.
- Source of truth for behaviour and vocabulary: repo `forma78/rubens` — `README.md`, `docs/SPEC.md`, `config/syndicate.json`, `runs/`.

## Open questions for the studio
1. Can guests comment once signed in with a non-studio account, or is commenting studio-only forever? (Prototype: studio-only.)
2. Should an aborted shift stay public in Archive with its partial rounds? (Prototype assumes yes — Shift 03 shows "aborted r2".)
3. Does Live need a shareable per-round anchor URL for linking a specific verdict?
