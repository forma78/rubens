/* The validator both models share.
 *
 * SPEC 2 says what an agent is allowed to say; the two generators disagree
 * about the vocabulary but not about the grammar. Model 1 lays dyed colour
 * fields and its layers name a palette; model 2 rules ink bars and its
 * layers name their inks. What must never differ is what happens when an
 * agent oversteps — that is a contract with the agent, and two copies of it
 * would be two contracts, drifting.
 *
 * The two rejections have deliberately different blast radii, and this is
 * the whole reason the core is shared rather than copied:
 *
 *   An unknown key or a wrong type is noise. The model misspelled a field,
 *   sent a string where a number belongs, hallucinated a parameter. That is
 *   an isolated slip inside an otherwise good-faith patch, so the key is
 *   dropped, the error is recorded, and the rest of the patch survives.
 *
 *   A locked key is a different kind of wrong. The agent is not mistaken
 *   about a value, it is mistaken about its own authority — it thinks it
 *   may change something the brief withheld from it. That is not a typo to
 *   route around; it is grounds to distrust the whole patch, so nothing
 *   from it survives, not even the keys that were otherwise fine.
 *
 * An out-of-range number is neither: it is clamped into range and kept.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clampNum(v, lo, hi, isFloat) {
  const n = Math.min(hi, Math.max(lo, v));
  return isFloat ? Math.round(n * 10) / 10 : Math.round(n);
}

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * validateWith(schema, patch, opts) -> { ok, patch, errors }
 *
 * schema.range          flat numeric keys -> [lo, hi]
 * schema.floatKeys      Set of those that keep one decimal instead of rounding
 * schema.lockedTop      Set of keys no brief can ever unlock
 * schema.colourKeys     Set of colour pickers, locked unless opts.unlockedColours says otherwise
 * schema.enums          flat string keys -> allowed values
 * schema.layerFields    L[i].<field> -> { kind, values?, range?, maxLayer }
 * schema.maxLayerIndex  highest L[i] that exists at all
 * schema.rangeOverrides (opts) -> partial range map, applied over schema.range
 *
 * opts.unlockedColours  colour keys the brief explicitly unlocked (SPEC 2.1)
 * opts.canvasFormat     the brief's physical canvas, for schema.rangeOverrides
 */
function validateWith(schema, patch, opts = {}) {
  const unlockedColours = new Set(opts.unlockedColours || []);
  const rangeOverrides = schema.rangeOverrides ? schema.rangeOverrides(opts.canvasFormat) : {};

  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, patch: {}, errors: [{ key: null, reason: 'patch must be a flat object' }] };
  }

  const layerRe = new RegExp(`^L\\[([0-${schema.maxLayerIndex}])\\]\\.(${Object.keys(schema.layerFields).join('|')})$`);
  const errors = [];
  const out = {};
  let lockedViolation = false;

  for (const [key, value] of Object.entries(patch)) {
    if (schema.lockedTop.has(key)) {
      errors.push({ key, reason: 'locked: never patchable' });
      lockedViolation = true;
      continue;
    }

    if (schema.colourKeys.has(key)) {
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

    const layerMatch = key.match(layerRe);
    if (layerMatch) {
      const i = Number(layerMatch[1]);
      const field = layerMatch[2];
      const spec = schema.layerFields[field];

      if (i > spec.maxLayer) {
        errors.push({
          key,
          reason: `unknown key: L[${i}].${field} does not exist (${field} only applies to layers 0-${spec.maxLayer})`,
        });
        continue;
      }

      if (spec.kind === 'enum') {
        if (typeof value !== 'string' || !spec.values.includes(value)) {
          errors.push({ key, reason: `wrong type: expected one of ${spec.values.join('|')}` });
          continue;
        }
        out[key] = value;
        continue;
      }

      if (spec.kind === 'inks') {
        const bad = validateInks(value, spec);
        if (bad) {
          errors.push({ key, reason: bad });
          continue;
        }
        out[key] = value.slice();
        continue;
      }

      if (!isNumber(value)) {
        errors.push({ key, reason: 'wrong type: expected a number' });
        continue;
      }
      out[key] = clampNum(value, spec.range[0], spec.range[1], false);
      continue;
    }

    if (schema.enums && Object.prototype.hasOwnProperty.call(schema.enums, key)) {
      const allowed = schema.enums[key];
      if (typeof value !== 'string' || !allowed.includes(value)) {
        errors.push({ key, reason: `wrong type: expected one of ${allowed.join('|')}` });
        continue;
      }
      out[key] = value;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(schema.range, key)) {
      if (!isNumber(value)) {
        errors.push({ key, reason: 'wrong type: expected a number' });
        continue;
      }
      const [lo, hi] = rangeOverrides[key] ?? schema.range[key];
      out[key] = clampNum(value, lo, hi, schema.floatKeys.has(key));
      continue;
    }

    errors.push({ key, reason: 'unknown key' });
  }

  if (lockedViolation) {
    return { ok: false, patch: {}, errors };
  }
  return { ok: errors.length === 0, patch: out, errors };
}

/* An ink is a colour, and colour in this project is the artist's. An agent
   may move the palette around — that is a real compositional choice — but
   only within the library the generator itself ships, never by inventing a
   hex value nobody painted. Returns an error string, or null when fine. */
function validateInks(value, spec) {
  if (!Array.isArray(value)) return 'wrong type: expected an array of inks';
  if (value.length < 1 || value.length > spec.maxInks) {
    return `wrong type: expected 1 to ${spec.maxInks} inks`;
  }
  for (const ink of value) {
    if (typeof ink !== 'string' || !HEX_RE.test(ink)) return 'wrong type: expected #rrggbb ink strings';
    if (!spec.library.has(ink.toUpperCase())) {
      return `unknown ink: ${ink} is not in the generator's ink library`;
    }
  }
  return null;
}

export { validateWith, clampNum, isNumber, HEX_RE };
