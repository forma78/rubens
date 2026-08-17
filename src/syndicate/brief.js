/* SPEC 3.1 — the brief. */
import { readFile } from 'node:fs/promises';
import { CANVAS_PROFILES } from './canvas.js';

const REQUIRED = ['id', 'instruction', 'ratio', 'reference'];

/**
 * loadBrief(path, syndicateConfig) -> normalised brief
 *
 * rounds/variantsPerRound/survivors fall back to config/syndicate.json when
 * the brief doesn't set them itself — the brief overrides, the config is
 * the default. `reference` is left as written (a path resolved relative to
 * the process cwd, same as render.js and analyse's cli.js already do).
 */
async function loadBrief(briefPath, syndicateConfig) {
  let raw;
  try {
    raw = JSON.parse(await readFile(briefPath, 'utf8'));
  } catch (e) {
    throw new Error(`could not read brief ${briefPath}: ${e.message}`);
  }

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
    throw new Error(`invalid brief ${briefPath}:\n  ${errors.join('\n  ')}`);
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

export { loadBrief };
