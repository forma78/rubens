/* Screening (2026-08-18 follow-up to the fast-shift patch): two sub-stages
   between renderRound and judgeRound that cut the field before the pairwise
   tournament, since parallelising the tournament (round.js's pool) turns
   hours into minutes but doesn't reduce how many calls a late round makes.

   3a. dedupe — no model calls. mutate() perturbs 2-4 keys at 12% of range,
   so a meaningful share of a round is visually indistinguishable from its
   parent; an average hash catches that for free.

   3b. contact-sheet screening — one call per (sheet, judge role, vendor).
   Every active judge narrows a numbered contact sheet down to its own
   keepCount, best first; screenRound Borda-aggregates all of those votes
   into one global ranking and keeps the top `finalists`.

   Screening never feeds Elo (CLAUDE.md) — a dropped variant is recorded in
   round-N/screened.jsonl, not scored as a loss, and the caller (run.js)
   marks it `screened: true` in ratings.json rather than omitting it. */

import sharp from 'sharp';
import { mapPool, serialise } from './pool.js';
import * as anthropic from './vendors/anthropic.js';
import * as xai from './vendors/xai.js';
import * as openai from './vendors/openai.js';

const VENDOR_MODULES = { anthropic, xai, openai };

/**
 * aHash(pngBuffer) -> Promise<string>
 * Average hash: greyscale, resize to 8x8 (fit 'fill', so aspect ratio is
 * deliberately ignored — two renders of the same canvas ratio are always
 * compared like-for-like), threshold each of the 64 pixels at the frame
 * mean, pack into 16 hex characters (64 bits).
 */
async function aHash(pngBuffer) {
  const { data } = await sharp(pngBuffer)
    .greyscale()
    .resize(8, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / data.length;
  let hex = '';
  for (let i = 0; i < data.length; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (data[i + b] >= mean ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

function hammingDistance(hexA, hexB) {
  let dist = 0;
  for (let i = 0; i < hexA.length; i++) {
    let x = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * dedupe(variants, minDistance = 4) -> Promise<{ kept, dropped }>
 * Always walks in id order regardless of the array's given order, so the
 * result never depends on caller/completion order — only on which variants
 * are actually there. A variant is dropped in favour of the earliest
 * (lowest id) already-kept variant within minDistance of it.
 */
async function dedupe(variants, minDistance = 4) {
  const ordered = [...variants].sort(byId);
  const hashes = new Map();
  for (const v of ordered) hashes.set(v.id, await aHash(v.png));

  const kept = [];
  const dropped = [];
  for (const v of ordered) {
    const h = hashes.get(v.id);
    let match = null;
    for (const k of kept) {
      const d = hammingDistance(h, hashes.get(k.id));
      if (d < minDistance) { match = { of: k.id, distance: d }; break; }
    }
    if (match) dropped.push({ id: v.id, reason: 'duplicate', ...match });
    else kept.push(v);
  }
  return { kept, dropped };
}

/** Burns the tile's 1-based position number into its corner via an SVG
 *  overlay — never the variant id, which would leak the round/parent and
 *  bias a judge who recognises a pattern in the numbering. */
function numberOverlay(n, tilePx) {
  const fontSize = Math.round(tilePx * 0.14);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tilePx}" height="${tilePx}">` +
    `<text x="10" y="${tilePx - 10}" font-size="${fontSize}" font-family="sans-serif" ` +
    `fill="white" stroke="black" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${n}</text></svg>`;
  return Buffer.from(svg);
}

async function buildOneSheet(variants, { tilePx, cols }) {
  const n = variants.length;
  const rows = Math.ceil(n / cols);
  const order = variants.map(v => v.id);
  const composites = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const tile = await sharp(variants[i].png).resize(tilePx, tilePx, { fit: 'cover' }).toBuffer();
    composites.push({ input: tile, left: col * tilePx, top: row * tilePx });
    composites.push({ input: numberOverlay(i + 1, tilePx), left: col * tilePx, top: row * tilePx });
  }
  const jpeg = await sharp({
    create: { width: cols * tilePx, height: rows * tilePx, channels: 3, background: '#101010' },
  }).composite(composites).jpeg({ quality: 80 }).toBuffer();
  return { jpeg, order };
}

/**
 * buildContactSheet(variants, opts) -> Promise<{ sheets: [{ jpeg, order }] }>
 * Splits into multiple independent sheets above maxTilesPerSheet (default
 * 12); each sheet's own tile numbering restarts at 1 (order[n-1] gives that
 * sheet's variant id for tile n). N not divisible by cols just leaves the
 * last row short, not padded onto a false grid.
 */
async function buildContactSheet(variants, { tilePx = 512, cols = 4, maxTilesPerSheet = 12 } = {}) {
  const chunks = [];
  for (let i = 0; i < variants.length; i += maxTilesPerSheet) chunks.push(variants.slice(i, i + maxTilesPerSheet));
  const sheets = [];
  for (const chunk of chunks) sheets.push(await buildOneSheet(chunk, { tilePx, cols }));
  return { sheets };
}

/**
 * screenRound({ variants, roundNum, config, roles, brief, referenceJpeg,
 * clients, costTracker, dry, logScreened, logScreenCall })
 * -> Promise<{ kept, dropped }>
 *
 * config.screening.enabled: false (or dry) skips both sub-stages and
 * returns every variant kept — the pre-screening shape, unchanged, so the
 * two regimes stay comparable.
 *
 * dropped entries are `{ id, reason: 'duplicate', of, distance }` (3a) or
 * `{ id, reason: 'screened-out', score }` (3b) — never deleted variants,
 * just ones that don't go to judgeRound. logScreened(entry) is called once
 * per dropped variant; logScreenCall(entry), if given, once per (sheet,
 * role, vendor) call, success or failure — a failed screening call is a
 * recorded failure, same rule as a judge call, never a fabricated
 * shortlist.
 */
async function screenRound({
  variants, roundNum, config, roles, brief, referenceJpeg,
  clients, costTracker, dry, logScreened, logScreenCall,
}) {
  const screening = config.screening ?? {};
  if (!screening.enabled || dry) return { kept: variants, dropped: [] };

  const { kept: deduped, dropped: dupDropped } = await dedupe(variants, screening.minHammingDistance ?? 4);
  if (logScreened) for (const d of dupDropped) await logScreened(d);
  if (!deduped.length) return { kept: [], dropped: dupDropped };

  // fixed once, used both for tile numbering and as the deterministic
  // tie-break ("lowest tile number") when two variants' Borda scores tie
  const ordered = [...deduped].sort(byId);
  const indexOf = new Map(ordered.map((v, i) => [v.id, i]));

  const finalists = Math.min(screening.finalists ?? 8, ordered.length);
  const { sheets } = await buildContactSheet(ordered, {
    tilePx: screening.tilePx ?? 512,
    cols: screening.cols ?? 4,
    maxTilesPerSheet: screening.maxTilesPerSheet ?? 12,
  });

  const activeJudges = roles.judges.filter(j => j.rounds.includes(roundNum));
  const calls = [];
  for (const [sheetIndex, sheet] of sheets.entries()) {
    for (const role of activeJudges) {
      for (const vendor of role.vendors) calls.push({ sheetIndex, sheet, role, vendor });
    }
  }

  const scores = new Map(ordered.map(v => [v.id, 0]));
  const logOne = serialise(logScreenCall ?? (async () => {}));
  const judgeLane = config?.limits?.concurrency?.judge ?? 24;

  await mapPool(calls, judgeLane, async (c) => {
    if (costTracker.capped()) return;
    const model = config.models[c.vendor]?.judge;
    const tileCount = c.sheet.order.length;
    const keepCount = Math.min(finalists, tileCount);
    let r;
    try {
      r = await VENDOR_MODULES[c.vendor].screen(clients[c.vendor], {
        model, rolePrompt: c.role.prompt, brief, maxWords: config.judging.maxWords,
        tileCount, keepCount, sheetImage: c.sheet.jpeg, referenceImage: referenceJpeg,
      });
    } catch (e) {
      r = { error: e.message };
    }
    await logOne({ sheetIndex: c.sheetIndex, judgeId: c.role.id, vendor: c.vendor, model, ok: !r.error, keep: r.keep, why: r.why, error: r.error });
    if (r.error) return;
    if (r.usage) costTracker.add(c.vendor, model, r.usage, { tag: `screen:${c.role.id}` });
    r.keep.forEach((tileNum, rank) => {
      const variantId = c.sheet.order[tileNum - 1];
      scores.set(variantId, scores.get(variantId) + (keepCount - rank));
    });
  });

  const ranked = ordered
    .map(v => ({ id: v.id, score: scores.get(v.id), index: indexOf.get(v.id) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const keptIds = new Set(ranked.slice(0, finalists).map(r => r.id));
  const kept = ordered.filter(v => keptIds.has(v.id));
  const screenedOutDropped = ranked.slice(finalists).map(r => ({ id: r.id, reason: 'screened-out', score: r.score }));
  if (logScreened) for (const d of screenedOutDropped) await logScreened(d);

  return { kept, dropped: [...dupDropped, ...screenedOutDropped] };
}

export { aHash, hammingDistance, dedupe, buildContactSheet, screenRound };
