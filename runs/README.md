# `runs/` — reading old shifts

Every shift here is kept whole, unedited, exactly as it happened — see
CLAUDE.md's "never invent numbers into the record." This file adds context
that wasn't true yet when some of them ran; it doesn't change anything in
them.

## Single-palette era (before the 2026-08-18 multireference fix)

`smoke-test-1787012814672/` and `smoke-test-3-1787051432623/` both ran
before `L[i].ref` was patchable (see `docs/SPEC.md` 3.1/3.2 and
`src/syndicate/patch.js`). Every layer in these runs was locked to the one
analysed reference photo — `base-state.json`'s `refs` has a single entry,
and every `L[i].ref` in `S.L` points at index 0 — so what reads as
monochrome variation in these two runs is that constraint, not a choice
any generator agent made. `config/roles.json`'s Akane ("how the four
palettes share the sheet") and Akecheta ("one or two palettes... instead
of all four") describe a machine that didn't exist yet for these shifts;
their `proposals.jsonl` intents from this era should be read with that in
mind.

Nothing here was corrupted or wrong for what it was — it's real evidence of
a real constraint, kept as it happened.
