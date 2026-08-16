/* SPEC 2 — what an agent is allowed to say.
   An agent returns a flat JSON object of parameter changes: keys like
   "cols" or "L[2].cover", merged onto the parent state. validate() is the
   only gate a patch passes through before it touches a state — nothing
   downstream should trust an unvalidated patch. */

/* range, per SPEC 2.1. Granularity (integer vs one-decimal float) is taken
   from the generator's own sliders (step="1" vs step="0.1"), since the
   table only calls out "integer" explicitly for a few keys. */
const RANGE = {
  cols:    [2, 40],
  rows:    [2, 48],
  weave:   [0.4, 20],
  edge:    [0.4, 20],
  nv:      [0, 4],
  nh:      [0, 6],
  rw:      [1, 60],
  angle:   [45, 90],
  scatter: [0, 100],
  over:    [-10, 30],
  squeeze: [0, 80],
  swell:   [0, 80],
  round:   [0, 100],
  drape:   [0, 100],
  hand:    [0, 100],
  seed:    [1, 99999],
  pitch:   [2, 40],
  ilock:   [0, 100],
  grain:   [0, 100],
  load:    [0, 60],
  cseed:   [1, 99999],
  wover:   [0, 1],
};
const FLOAT_KEYS = new Set(['weave', 'edge']);

/* never patchable, brief or no brief */
const LOCKED_TOP = new Set(['ratio', 'pattern']);
const LOCKED_LAYER_RE = /^L\[([0-4])\]\.ref$/;

/* locked unless the brief explicitly names them in opts.unlockedColours */
const COLOUR_KEYS = new Set(['thread', 'cell', 'ribbon', 'bg']);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const LAYER_KEY_RE = /^L\[([0-4])\]\.(bands|dir|span|cover|on)$/;
const LAYER_ENUM = { dir: ['v', 'h'], span: ['cell', 'auto', 'sheet'] };
const LAYER_RANGE = { bands: [2, 8], cover: [0, 100], on: [0, 1] };
const LAYER_DIR_SPAN_COVER_MAX_I = 3; // dir/span/cover only exist on layers 0-3; layer 4 is the ribbons

function clampNum(v, lo, hi, isFloat) {
  const n = Math.min(hi, Math.max(lo, v));
  return isFloat ? Math.round(n * 10) / 10 : Math.round(n);
}

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * validate(patch, opts) -> { ok, patch, errors }
 *
 * `patch` is checked key by key. A key with an out-of-range number is
 * clamped into range and kept. A key that is unknown or the wrong type is
 * dropped and logged in `errors`, but the rest of the patch survives. A key
 * that names a locked field (ratio, pattern, L[i].ref, or a colour picker
 * the brief did not explicitly unlock) rejects the whole patch — `patch`
 * comes back empty.
 *
 * The two rejections are not the same kind of failure, which is why they
 * get different blast radii. An unknown key or a wrong type is noise: the
 * model misspelled a field, sent a string where a number belongs, hallucinated
 * a parameter that doesn't exist — an isolated slip in an otherwise
 * good-faith patch, so only that key is dropped and the rest is still
 * usable. A locked key is a different kind of wrong: the agent is not
 * mistaken about a value, it is mistaken about its own authority — it
 * thinks it may change something the brief withheld from it (the ratio, the
 * pattern, which palette a layer holds, a colour nobody unlocked). That
 * isn't a typo to route around; it's grounds to distrust the whole patch,
 * so nothing from it survives, not even the keys that were otherwise fine.
 *
 * opts.unlockedColours: array of 'thread'|'cell'|'ribbon'|'bg' the brief
 * has explicitly unlocked (SPEC 2.1). Defaults to none.
 */
function validate(patch, opts = {}) {
  const unlockedColours = new Set(opts.unlockedColours || []);

  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, patch: {}, errors: [{ key: null, reason: 'patch must be a flat object' }] };
  }

  const errors = [];
  const out = {};
  let lockedViolation = false;

  for (const [key, value] of Object.entries(patch)) {
    if (LOCKED_TOP.has(key)) {
      errors.push({ key, reason: 'locked: never patchable' });
      lockedViolation = true;
      continue;
    }

    const refMatch = key.match(LOCKED_LAYER_RE);
    if (refMatch) {
      errors.push({ key, reason: 'locked: which palette a layer holds is never patchable' });
      lockedViolation = true;
      continue;
    }

    if (COLOUR_KEYS.has(key)) {
      if (!unlockedColours.has(key)) {
        errors.push({ key, reason: 'locked: colour pickers are locked unless the brief unlocks them' });
        lockedViolation = true;
        continue;
      }
      if (typeof value !== 'string' || !HEX_RE.test(value)) {
        errors.push({ key, reason: 'wrong type: expected a #rrggbb colour string' });
        continue;
      }
      out[key] = value;
      continue;
    }

    const layerMatch = key.match(LAYER_KEY_RE);
    if (layerMatch) {
      const i = Number(layerMatch[1]);
      const field = layerMatch[2];

      if ((field === 'dir' || field === 'span' || field === 'cover') && i > LAYER_DIR_SPAN_COVER_MAX_I) {
        errors.push({ key, reason: `unknown key: L[${i}].${field} does not exist (${field} only applies to layers 0-3)` });
        continue;
      }

      if (field === 'dir' || field === 'span') {
        const allowed = LAYER_ENUM[field];
        if (typeof value !== 'string' || !allowed.includes(value)) {
          errors.push({ key, reason: `wrong type: expected one of ${allowed.join('|')}` });
          continue;
        }
        out[key] = value;
        continue;
      }

      // bands, cover, on — all numeric
      if (!isNumber(value)) {
        errors.push({ key, reason: 'wrong type: expected a number' });
        continue;
      }
      const [lo, hi] = LAYER_RANGE[field];
      out[key] = clampNum(value, lo, hi, false);
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(RANGE, key)) {
      if (!isNumber(value)) {
        errors.push({ key, reason: 'wrong type: expected a number' });
        continue;
      }
      const [lo, hi] = RANGE[key];
      out[key] = clampNum(value, lo, hi, FLOAT_KEYS.has(key));
      continue;
    }

    errors.push({ key, reason: 'unknown key' });
  }

  if (lockedViolation) {
    return { ok: false, patch: {}, errors };
  }
  return { ok: errors.length === 0, patch: out, errors };
}

export { validate, RANGE, FLOAT_KEYS, LAYER_RANGE, LAYER_DIR_SPAN_COVER_MAX_I };
