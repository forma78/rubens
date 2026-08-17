/* Real-canvas constraints, added after round 1 of the first real shift
   produced compositions the owner can't actually paint: cloth that folds at
   a shallow angle, overhangs into nothing, or sits at zero drape doesn't
   read as real cloth. These are on top of SPEC 2.1's RANGE table, not a
   replacement for it — patch.js still owns the base clamp.

   Ribbon count (nv/nh) is the one dimension that's genuinely tied to a
   specific physical canvas, not cloth physics in general — a wider canvas
   plausibly carries more vertical ribbons. Everything else in
   CLOTH_GUIDANCE is size-independent, which is why it lives in patch.js's
   global RANGE rather than here.

   Keyed by the engine's own RATIOS index (src/engine/state.js) — ratio 2
   (3:4) is exactly 60x80cm; ratio 3 (2:3) is the owner's own shorthand for
   70x100cm (0.667 vs the true 0.7 — close enough that a second ratio entry
   isn't worth it); ratio 0 (1:1) is 100x100cm. 120x90cm (4:3, landscape)
   has NO existing RATIOS entry — engine/state.js only has portrait/square
   ratios — so it isn't in this table yet; see the note where round.js
   calls canvasGuidance(). */
const CANVAS_PROFILES = {
  0: { // 1:1 — 100x100cm
    label: '100x100cm',
    range: { nv: [1, 3], nh: [0, 4] },
    guidance: 'This canvas is 100x100cm, square. Vertical ribbons: 1 to 3, never 4. Horizontal ribbons: up to 4.',
  },
  2: { // 3:4 — 60x80cm
    label: '60x80cm',
    range: { nv: [1, 1], nh: [2, 3] },
    guidance: 'This canvas is 60x80cm. Vertical ribbons: always exactly 1, never 2. Horizontal ribbons: 2 or 3.',
  },
  3: { // 2:3 — 70x100cm
    label: '70x100cm',
    range: {},
    guidance: 'This canvas is 70x100cm. Vertical ribbon count is not fixed, but 2 reads best at this width.',
  },
};

/* the physical framing every generator agent gets, regardless of vendor —
   the hard numbers below are enforced anyway by patch.js's RANGE (and, for
   nv/nh, canvasRangeOverrides); this text is so an agent understands *why*
   and can aim for the preferred zone instead of bouncing off the clamp. */
const CLOTH_GUIDANCE = 'You are sketching a composition that will later be painted by hand, in oil or acrylic, on real stretched canvas — not a digital-only pattern. Real cloth does not fold at a shallow angle, does not overhang past a hair, and does not sit at zero drape. Within the allowed ranges, ribbon width around 30-40, squeeze around 15%, and rounding around 60% read as the most natural.';

/** canvasRangeOverrides(ratio) -> partial RANGE table (possibly {}) for the
 *  given engine ratio index — only nv/nh are ever overridden here. */
function canvasRangeOverrides(ratio) {
  return CANVAS_PROFILES[ratio]?.range ?? {};
}

/** canvasGuidance(ratio) -> prompt text appended to every generator's role
 *  prompt, format-specific where a profile exists for this ratio. */
function canvasGuidance(ratio) {
  const profile = CANVAS_PROFILES[ratio];
  return profile ? `${CLOTH_GUIDANCE} ${profile.guidance}` : CLOTH_GUIDANCE;
}

export { CANVAS_PROFILES, canvasRangeOverrides, canvasGuidance };
