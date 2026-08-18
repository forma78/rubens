/* SPEC 3.1 — the brief. */
import { readFile } from 'node:fs/promises';
import { CANVAS_PROFILES } from './canvas.js';

const REQUIRED = ['id', 'instruction', 'ratio', 'reference'];

/**
 * normaliseBrief(raw, syndicateConfig, label) -> normalised brief
 *
 * Shared by loadBrief (a local JSON file) and run.js's Supabase brief path
 * (a `briefs` row, mapped to this same raw shape first) — one validator, so
 * a site-created brief can't drift from what a hand-written one accepts.
 *
 * rounds/variantsPerRound/survivors fall back to config/syndicate.json when
 * the brief doesn't set them itself — the brief overrides, the config is
 * the default. `reference` is left as written (a path resolved relative to
 * the process cwd for a local brief; run.js resolves a Supabase brief's
 * reference as a URL instead — normaliseBrief doesn't care which).
 */
function normaliseBrief(raw, syndicateConfig, label = 'brief') {
  const errors = [];
  for (const key of REQUIRED) {
    if (raw[key] === undefined) errors.push(`missing required field "${key}"`);
  }
  if (raw.ratio !== undefined && (!Number.isInteger(raw.ratio) || raw.ratio < 0 || raw.ratio > 5)) {
    errors.push(`ratio must be an integer 0-5 (got ${JSON.stringify(raw.ratio)})`);
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
    reference: raw.reference,
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
