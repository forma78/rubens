/* SPEC 3.1 — the brief. */
import { readFile } from 'node:fs/promises';
import { CANVAS_PROFILES } from './canvas.js';

const REQUIRED = ['id', 'instruction', 'ratio'];

/**
 * normaliseBrief(raw, syndicateConfig, label) -> normalised brief
 *
 * Shared by loadBrief (a local JSON file) and run.js's Supabase brief path
 * (a `briefs` row, mapped to this same raw shape first) — one validator, so
 * a site-created brief can't drift from what a hand-written one accepts.
 *
 * rounds/variantsPerRound/survivors fall back to config/syndicate.json when
 * the brief doesn't set them itself — the brief overrides, the config is
 * the default.
 *
 * `references`: 1-4 entries, each either a path (local brief) or a URL
 * (Supabase brief) — normaliseBrief doesn't care which, run.js resolves
 * them differently per source. Position is the layer it replaces:
 * references[0] overrides layer 0's palette, references[1] layer 1, and so
 * on — this mirrors the generator's own "Reference library" (a layer not
 * given an override here keeps whichever of the engine's four built-in
 * PRESETS studies it points to by default; see canvas.js's sibling
 * comment in run.js's buildBaseState). A brief needs at least one.
 */
function normaliseBrief(raw, syndicateConfig, label = 'brief') {
  const errors = [];
  for (const key of REQUIRED) {
    if (raw[key] === undefined) errors.push(`missing required field "${key}"`);
  }
  if (raw.references === undefined) {
    errors.push('missing required field "references" (an array of 1-4 paths/URLs — see brief.js)');
  } else if (!Array.isArray(raw.references) || raw.references.length < 1 || raw.references.length > 4) {
    errors.push(`references must be an array of 1-4 entries (got ${JSON.stringify(raw.references)})`);
  } else if (raw.references.some(r => r !== null && typeof r !== 'string')) {
    errors.push('references entries must each be a string (a path or URL) or null (keep that layer\'s built-in default)');
  } else if (raw.references.every(r => r === null)) {
    errors.push('references must include at least one real path/URL, not only null slots — a brief with nothing new to say isn\'t a brief');
  }
  if (raw.ratio !== undefined && (!Number.isInteger(raw.ratio) || raw.ratio < 0 || raw.ratio > 5)) {
    errors.push(`ratio must be an integer 0-5 (got ${JSON.stringify(raw.ratio)})`);
  }
  // which generator to search. Absent means 1: every brief written before
  // there was a second one meant that, and a shift that silently ran the
  // wrong generator would spend real money rendering the wrong thing.
  if (raw.generator !== undefined && raw.generator !== 1 && raw.generator !== 2) {
    errors.push(`generator must be 1 or 2 (got ${JSON.stringify(raw.generator)})`);
  }
  if (raw.rounds !== undefined && (!Number.isInteger(raw.rounds) || raw.rounds < 1)) {
    errors.push(`rounds must be a positive integer (got ${JSON.stringify(raw.rounds)})`);
  }
  if (raw.variantsPerRound !== undefined && (!Number.isInteger(raw.variantsPerRound) || raw.variantsPerRound < 1)) {
    errors.push(`variantsPerRound must be a positive integer (got ${JSON.stringify(raw.variantsPerRound)})`);
  }
  if (raw.survivors !== undefined && (!Number.isInteger(raw.survivors) || raw.survivors < 1)) {
    errors.push(`survivors must be a positive integer (got ${JSON.stringify(raw.survivors)})`);
  }
  // optional: a physical canvas format (canvas.js) selects nv/nh clamps and
  // prompt guidance that ratio alone can't (60x80 and 120x90 render
  // through the same ratio but want different treatment). A typo here
  // should fail loudly, not silently fall back to an unconstrained shift.
  if (raw.canvasFormat !== undefined && !Object.prototype.hasOwnProperty.call(CANVAS_PROFILES, raw.canvasFormat)) {
    errors.push(`canvasFormat "${raw.canvasFormat}" is not a known format (${Object.keys(CANVAS_PROFILES).join(', ')})`);
  }
  if (errors.length) {
    throw new Error(`invalid ${label}:\n  ${errors.join('\n  ')}`);
  }

  return {
    id: raw.id,
    instruction: raw.instruction,
    ratio: raw.ratio,
    canvasFormat: raw.canvasFormat,
    // explicit rather than left undefined: every consumer reads brief.generator
    // directly, and a normalised brief should say which generator it means
    generator: raw.generator ?? 1,
    references: raw.references,
    rounds: raw.rounds ?? syndicateConfig.rounds,
    variantsPerRound: raw.variantsPerRound ?? syndicateConfig.variantsPerRound,
    survivors: raw.survivors ?? syndicateConfig.survivors,
    unlockedColours: raw.unlockedColours ?? [],
  };
}

/** loadBrief(path, syndicateConfig) -> normalised brief, read from a local JSON file. */
async function loadBrief(briefPath, syndicateConfig) {
  let raw;
  try {
    raw = JSON.parse(await readFile(briefPath, 'utf8'));
  } catch (e) {
    throw new Error(`could not read brief ${briefPath}: ${e.message}`);
  }
  return normaliseBrief(raw, syndicateConfig, `brief ${briefPath}`);
}

export { loadBrief, normaliseBrief };
