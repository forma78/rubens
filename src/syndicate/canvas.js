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

   Keyed by an explicit canvas-format string (brief.canvasFormat), not by
   the engine's RATIOS index — 120x90cm needs no new engine ratio at all
   (the owner's own fix: render the existing 3:4 portrait and rotate the
   physical canvas 90 degrees), but that means 60x80cm and 120x90cm share
   the *same* engine ratio (2) while wanting different nv/nh treatment,
   because rotation swaps which axis is "vertical" on the finished canvas.
   ratio index alone can no longer disambiguate them, hence the separate
   key. `ratio` below is which engine RATIOS index each format renders
   through; round.js still sets state.ratio from brief.ratio directly (the
   brief is the source of truth for that), this table only drives which
   nv/nh clamp and prompt guidance apply. */
const CANVAS_PROFILES = {
  '100x100': { // 1:1
    ratio: 0,
    range: { nv: [1, 3], nh: [0, 4] },
    guidance: 'This canvas is 100x100cm, square. Vertical ribbons: 1 to 3, never 4. Horizontal ribbons: up to 4.',
  },
  '60x80': { // 3:4, rendered upright, no rotation
    ratio: 2,
    range: { nv: [1, 1], nh: [2, 3] },
    guidance: 'This canvas is 60x80cm. Vertical ribbons: always exactly 1, never 2. Horizontal ribbons: 2 or 3.',
  },
  '70x100': { // 2:3
    ratio: 3,
    range: {},
    guidance: 'This canvas is 70x100cm. Vertical ribbon count is not fixed, but 2 reads best at this width.',
  },
  '120x90': { // same 3:4 render as 60x80, physical canvas rotated 90deg
    ratio: 2,
    range: {},
    guidance: 'This canvas is 120x90cm: the same 3:4 composition as the 60x80 format, painted rotated 90 degrees so it reads as landscape. What the engine calls the horizontal-ribbon count becomes the canvas\'s vertical count once rotated — 3 reads best there, and it is not fixed.',
  },
  '90x120': { // same 3:4 render and orientation as 60x80, just larger
    ratio: 2,
    range: {},
    guidance: 'This canvas is 90x120cm — the same upright 3:4 composition as 60x80, at 1.5x the physical size. A single brushstroke covers proportionally less of a larger canvas, so more vertical ribbons read better here than on 60x80: 3 is preferred, not fixed.',
  },
};

/* The physical framing every generator agent gets, regardless of vendor or
   which generator it is proposing for — both models draw the same cloth, so
   the same physics binds them. The hard numbers are enforced anyway by
   patch.js's RANGE (and, for nv/nh, canvasRangeOverrides); this text is so
   an agent understands *why* and can aim for the preferred zone instead of
   bouncing off the clamp.

   The squeeze/ribbon-width coupling is stated here rather than enforced as
   a rule because it already cannot happen: squeeze clamps at 20 and ribbon
   width floors at 30, so "squeeze above 20 with a ribbon under 30" is
   unreachable from either side — an agent asking for squeeze 35 and width
   12 gets 20 and 30. What the sentence adds is the reason, which is what
   stops an agent from sitting on the boundary and wondering why. */
const CLOTH_GUIDANCE = 'You are sketching a composition that will later be painted by hand, in oil or acrylic, on real stretched canvas — not a digital-only pattern. Real cloth does not fold at a shallow angle, does not overhang past a hair, and does not sit at zero drape. Squeeze and ribbon width are coupled: a narrow ribbon cannot also be hard-squeezed — thin cloth pulled tight tears instead of folding. Within the allowed ranges, ribbon width around 30-40, squeeze around 15%, swell between 15% and 50%, rounding around 60%, and a thread weight of 2.0px read as the most natural.';

/** canvasRangeOverrides(canvasFormat) -> partial RANGE table (possibly {})
 *  for the given format string (e.g. '60x80') — only nv/nh are ever
 *  overridden here. Undefined/unknown formats fall back to {} (SPEC 2.1's
 *  base RANGE applies unmodified). */
function canvasRangeOverrides(canvasFormat) {
  return CANVAS_PROFILES[canvasFormat]?.range ?? {};
}

/** canvasGuidance(canvasFormat) -> prompt text appended to every
 *  generator's role prompt, format-specific where a profile exists. */
function canvasGuidance(canvasFormat) {
  const profile = CANVAS_PROFILES[canvasFormat];
  return profile ? `${CLOTH_GUIDANCE} ${profile.guidance}` : CLOTH_GUIDANCE;
}

export { CANVAS_PROFILES, canvasRangeOverrides, canvasGuidance };
