/* SPEC 3 — a shift. The CLI entry point: propose -> render -> judge -> rank
   -> select -> mutate, across brief.rounds, writing runs/<brief.id>/ as it
   goes (SPEC 3.4) and stopping the moment the cost or time cap is reached
   (SPEC 3.5), writing whatever it has rather than pretending the shift
   finished. */

import { mkdir, rm, writeFile, appendFile, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { S as DEFAULT_STATE, PRESETS } from '../engine/index.js';
import { loadEnv } from './env.js';
import { loadBrief, normaliseBrief } from './brief.js';
import { CANVAS_PROFILES } from './canvas.js';
import { createCostTracker } from './cost.js';
import { renderToPng } from './render-core.js';
import { modelFor } from './models.js';
import { toTransmitJpeg } from './image.js';
import { proposeRound, renderRound, judgeRound, selectRound } from './round.js';
import { screenRound } from './screen.js';
import { renderFinalMd } from './report.js';
import { analyseFile } from '../analyse/decode.js';
import { signIn, fetchBriefById, claimBrief, insertBrief, closeBrief, syncVariant, syncVariantResults, syncComparisons } from './sync.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a === '--publish') args.publish = true;
    else if (a === '--brief-id') args.briefId = argv[++i];
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  return args;
}

/**
 * resolveBriefSource({ briefId, briefPath, cwd, fileConfig, env, fetchImpl,
 * signIn, claimBrief, fetchBriefById }) -> { brief, referencePaths, existingBriefId, accessToken }
 *
 * Two ways into a shift: a local JSON file (the original flow — SPEC 3.1),
 * or a brief a site visitor already created in Supabase (--brief-id). The
 * Supabase path needs to sign in before it can read anything (RLS: a
 * pending brief isn't published, so the anon key can't see it), claim the
 * row (pending -> running, atomically — see sync.js's claimBrief), map it
 * onto the same shape normaliseBrief validates for a local file, and
 * download its reference image to a real local path, since analyseFile()
 * needs one. The accessToken is returned too so the caller doesn't sign in
 * twice when it also wants to --publish at the end.
 *
 * referencePaths is always an array (1-4 entries, sparse — a null keeps
 * that layer on the engine's own built-in PRESETS default; see
 * buildBaseState). A --brief-id shift downloads every real URL in the
 * `briefs` table's `reference_urls` column (site's A4 form, up to 4);
 * a local JSON brief supplies up to 4 local paths the same shape.
 */
async function resolveBriefSource({
  briefId, briefPath, cwd, fileConfig, env, fetchImpl, dry,
  signIn: signInFn, claimBrief: claimBriefFn, fetchBriefById: fetchBriefByIdFn,
}) {
  if (!briefId) {
    const brief = await loadBrief(briefPath, fileConfig);
    const referencePaths = brief.references.map(r => r ? path.join(cwd, r) : null);
    return { brief, referencePaths, existingBriefId: null, accessToken: null };
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_EMAIL || !env.SUPABASE_PASSWORD) {
    throw new Error('--brief-id requires SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_EMAIL/SUPABASE_PASSWORD all set in .env');
  }
  const { accessToken } = await signInFn({
    supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY,
    email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD, fetchImpl,
  });

  // a dry run never publishes (see run()'s publish block), so claiming the
  // row here would flip it to 'running' with nothing ever setting it back
  // — a real brief left stuck mid-status by a test. Dry mode only reads.
  const claimed = dry
    ? await fetchBriefByIdFn({ supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY, accessToken, briefId, fetchImpl })
    : await claimBriefFn({ supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY, accessToken, briefId, fetchImpl });
  if (!claimed) {
    throw new Error(`run: brief ${briefId} is not pending (already claimed by another worker, or does not exist)`);
  }

  const profile = CANVAS_PROFILES[claimed.canvas_format];
  if (!profile) {
    throw new Error(`run: brief ${briefId} has an unknown canvas_format ${JSON.stringify(claimed.canvas_format)}`);
  }
  const brief = normaliseBrief({
    id: claimed.slug,
    instruction: claimed.instruction,
    ratio: profile.ratio,
    canvasFormat: claimed.canvas_format,
    references: claimed.reference_urls,
    rounds: claimed.rounds,
  }, fileConfig, `brief ${briefId} (from Supabase)`);

  // Each real entry in reference_urls is a Storage URL, not a local path —
  // analyseFile() needs a real file. Downloaded to the OS temp dir, not
  // under runs/: the runDir this brief.id maps to gets rm-and-recreated a
  // few lines below (in run()), which would delete an image parked there
  // first, and runs/ is committed evidence — a scratch download doesn't
  // belong in it regardless. A null entry (a layer this brief left on the
  // engine's PRESETS default) stays null, same shape a local brief's
  // referencePaths already has.
  const referencePaths = [];
  for (const url of claimed.reference_urls ?? []) {
    if (!url) { referencePaths.push(null); continue; }
    const imgRes = await (fetchImpl ?? fetch)(url);
    if (!imgRes.ok) throw new Error(`run: could not download reference image ${url}: ${imgRes.status}`);
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const referencePath = path.join(tmpdir(), `rubens-reference-${brief.id}-${referencePaths.length}${ext}`);
    await writeFile(referencePath, Buffer.from(await imgRes.arrayBuffer()));
    referencePaths.push(referencePath);
  }

  return { brief, referencePaths, existingBriefId: claimed.id, accessToken };
}

function jsonlLine(obj) {
  return JSON.stringify(obj) + '\n';
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/**
 * buildBaseState(brief, referencePaths) -> { state, refs, ovr, palette }
 *
 * refs starts as the engine's own four built-in PRESETS studies — the same
 * "Reference library" the generator opens with (colour.js) — and
 * referencePaths[i], where given, replaces that slot with a freshly
 * analysed photo. state.L is left untouched: DEFAULT_STATE's own
 * ref:[0,1,2,3,3] already points each of the four colour layers at a
 * different slot (layer 4, the ribbons, shares layer 3's), so a brief that
 * gives fewer than 4 references simply leaves the rest on their canonical
 * PRESETS default rather than collapsing everything onto one photo.
 */
async function buildBaseState(brief, referencePaths) {
  const model = modelFor(brief.generator);
  const state = structuredClone(model.defaultState);
  state.ratio = brief.ratio;

  // Model 2 has no colour studies at all — its inks are named in its own
  // state, and the analyser reads stroke direction and pure colours out of a
  // hand-painted study, which is not what a photograph means to it. Running
  // the analyser anyway would spend real work producing a palette nothing
  // downstream reads.
  if (!model.usesStudies) return { state, refs: [], ovr: [{}, {}, {}, {}, {}], palette: [] };

  const refs = PRESETS.map(p => ({ name: p.name, pal: p.pal, prof: p.prof }));
  for (let i = 0; i < Math.min(referencePaths.length, refs.length); i++) {
    if (!referencePaths[i]) continue; // sparse: keep this slot's PRESETS default
    const analysed = await analyseFile(referencePaths[i]);
    refs[i] = { name: referencePaths[i], pal: analysed.pal, prof: analysed.prof };
  }
  return { state, refs, ovr: [{}, {}, {}, {}, {}], palette: refs };
}

async function run({ briefPath, briefId, dry = false, cwd = process.cwd(), runsDir, env: envOverride, clients: clientsOverride, publish = false, sync: syncOverride, fetchImpl }) {
  const fileConfig = JSON.parse(await readFile(path.join(cwd, 'config/syndicate.json'), 'utf8'));
  const roles = JSON.parse(await readFile(path.join(cwd, 'config/roles.json'), 'utf8'));
  // env is injectable (like clients below) precisely so a test can force
  // the "no keys" case deterministically, regardless of what the real
  // repo's own .env happens to contain at the time the test runs
  const env = envOverride ?? await loadEnv(path.join(cwd, '.env'));
  // one injection point for the whole Supabase surface (sign-in, claiming
  // a site-created brief, publishing results) — same DI pattern as
  // `clients` below, so a test never touches the network for any of it
  const syncFns = syncOverride ?? { signIn, claimBrief, fetchBriefById, insertBrief, closeBrief, syncVariant, syncVariantResults, syncComparisons };
  const { brief, referencePaths, existingBriefId, accessToken: claimAccessToken } = await resolveBriefSource({
    briefId, briefPath, cwd, fileConfig, env, fetchImpl, dry,
    signIn: syncFns.signIn, claimBrief: syncFns.claimBrief, fetchBriefById: syncFns.fetchBriefById,
  });

  // the brief's rounds/variantsPerRound/survivors (already resolved against
  // fileConfig's defaults by loadBrief) are what actually govern this
  // shift — round.js reads variantsPerRound off `config`, so that override
  // has to reach it, not just fileConfig's untouched default
  const syndicateConfig = { ...fileConfig, variantsPerRound: brief.variantsPerRound, survivors: brief.survivors };

  if (!dry) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in .env — required for a real shift (use --dry to skip model calls)');
    if (!env.XAI_API_KEY) throw new Error('XAI_API_KEY is not set in .env — required for a real shift (use --dry to skip model calls)');
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set in .env — required for a real shift (use --dry to skip model calls)');
  }
  // like env: injectable so a test can exercise the real (dry:false) path
  // against a fake client — no network, no key, no spend — the same DI
  // pattern round.js's own functions already use
  const clients = dry ? {} : clientsOverride ?? {
    anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    xai: new OpenAI({ apiKey: env.XAI_API_KEY, baseURL: syndicateConfig.models.xai.base_url }),
    openai: new OpenAI({ apiKey: env.OPENAI_API_KEY }),
  };

  // Incremental sync setup — a brief's Supabase row must exist *before* any
  // variant is synced (variants reference it by brief_id), so this happens
  // up front, not at the end like the old batch-sync model. A --brief-id
  // shift already has a row (claimed in resolveBriefSource); a local-JSON
  // shift with --publish gets one inserted here, as 'running', immediately.
  // Failures here are reported, not thrown — the shift still runs and
  // writes its local record either way (CLAUDE.md: publishing failing is
  // never the same as the shift failing) — they just leave `syncCtx` null,
  // which every sync call site below checks before doing anything.
  let liveBriefId = existingBriefId;
  let accessToken = claimAccessToken;
  let publishError = null;
  const wantsSync = (publish || !!existingBriefId) && !dry;
  if (wantsSync) {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_EMAIL || !env.SUPABASE_PASSWORD) {
        throw new Error('--publish requires SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_EMAIL/SUPABASE_PASSWORD all set in .env');
      }
      if (!accessToken) {
        accessToken = (await syncFns.signIn({
          supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY,
          email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD, fetchImpl,
        })).accessToken;
      }
      if (!liveBriefId) {
        const inserted = await syncFns.insertBrief({ supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY, accessToken, brief, fetchImpl });
        liveBriefId = inserted.briefId;
      }
    } catch (e) {
      publishError = e.message;
      console.error(`[syndicate] could not start Supabase sync: ${e.message}`);
    }
  }
  const syncCtx = liveBriefId ? { supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY, accessToken, briefId: liveBriefId, fetchImpl } : null;
  const labelToUuid = new Map();

  const runDir = path.join(runsDir ?? path.join(cwd, 'runs'), brief.id);
  // proposals.jsonl/comparisons.jsonl are opened with appendFile below so a
  // round can log durably as it goes — but that means a runDir left over
  // from an earlier, interrupted attempt at this same brief.id would get
  // *mixed into* this run's log rather than replaced by it (stale lines,
  // duplicate variant ids, contradictory patches under the same id). SPEC's
  // acceptance criterion 4 ("re-run the same shift... get the same
  // variants") already implies a run always starts clean, not resumed — so
  // clear it first.
  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });

  const { state: baseState, refs, ovr, palette } = await buildBaseState(brief, referencePaths);
  await writeFile(path.join(runDir, 'brief.json'), JSON.stringify(brief, null, 2));
  await writeFile(path.join(runDir, 'base-state.json'), JSON.stringify({ v: 1, S: baseState, ovr, refs }, null, 2));
  await writeFile(path.join(runDir, 'palette.json'), JSON.stringify(palette, null, 2));

  // judges see one photo as "the tonal target" (SPEC 3.2) — the first real
  // upload the brief gave, not all four layers' worth. references is
  // required to have at least one non-null entry (brief.js), so this
  // always finds something.
  const primaryReferencePath = referencePaths.find(p => p);
  const referenceJpeg = await toTransmitJpeg(await readFile(primaryReferencePath));

  const costLogPath = path.join(runDir, 'cost-log.jsonl');
  const costTracker = createCostTracker(syndicateConfig.limits.maxUsd, {
    // synchronous and on every real charge: a killed or crashed process
    // still leaves a true record of what was actually spent, rather than a
    // total that only ever existed in memory
    onAdd: dry ? undefined : (entry) => appendFileSync(costLogPath, jsonlLine(entry)),
  });
  const startedAt = Date.now();
  const maxMs = syndicateConfig.limits.maxMinutes * 60 * 1000;
  const timeUp = () => Date.now() - startedAt > maxMs;

  const seedBase = hashSeed(brief.id);
  const allVariantsById = new Map();
  const allComparisons = [];
  const critiquesByVariant = new Map(); // variant id -> [why, ...] said about it when it lost
  const allRatings = new Map();      // variant id -> its rating from the round it was judged in
  const allDisagreements = new Map(); // variant id -> its disagreement share, same scope
  const survivedIds = new Set();      // variant ids that were ever selected to carry forward

  let field = null; // survivors carried into the next round, or null before round 1
  let lastSelected = [];
  let roundsRun = 0;
  let aborted = false;

  const basePng = await renderToPng(baseState, refs, ovr, { quality: 'preview', model: modelFor(brief.generator).id });
  const baseParent = { id: 'base', state: baseState, png: basePng, source: 'base', intent: 'base state', roundNum: 'base', seedRating: 1500 };
  allVariantsById.set('base', baseParent);

  for (let roundNum = 1; roundNum <= brief.rounds; roundNum++) {
    if (costTracker.capped() || timeUp()) { aborted = true; break; }

    const roundDir = path.join(runDir, `round-${roundNum}`);
    const variantsDir = path.join(roundDir, 'variants');
    await mkdir(variantsDir, { recursive: true });
    const proposalsPath = path.join(roundDir, 'proposals.jsonl');
    const comparisonsPath = path.join(roundDir, 'comparisons.jsonl');
    const screenedPath = path.join(roundDir, 'screened.jsonl');
    const screenCallsPath = path.join(roundDir, 'screen-calls.jsonl');

    const parents = roundNum === 1 ? [baseParent] : field;
    const logProposal = (entry) => appendFile(proposalsPath, jsonlLine({ round: roundNum, ...entry }));
    const logComparison = (entry) => appendFile(comparisonsPath, jsonlLine({ round: roundNum, ...entry }));
    const logScreened = (entry) => appendFile(screenedPath, jsonlLine({ round: roundNum, ...entry }));
    const logScreenCall = (entry) => appendFile(screenCallsPath, jsonlLine({ round: roundNum, ...entry }));

    const children = await proposeRound({
      parents, roundNum, config: syndicateConfig, roles, brief,
      unlockedColours: brief.unlockedColours, clients, costTracker, dry, seedBase,
      logProposal, critiquesFor: (id) => critiquesByVariant.get(id) ?? [],
    });

    // one variant at a time: rendered, written to disk, and synced to
    // Supabase (image uploaded, then the row) before the next one even
    // starts rendering — a viewer watching the feed sees posts arrive one
    // by one, not all 32 in the same instant. Only `children` (this
    // round's new variants) are ever synced here; survivors carried
    // forward from an earlier round already have a row from that round's
    // own pass through this same loop.
    await renderRound(children, refs, ovr, {
      model: modelFor(brief.generator).id,
      config: syndicateConfig,
      onRendered: async (v) => {
        v.roundNum = `round-${roundNum}`;
        await writeFile(path.join(variantsDir, `${v.id}.png`), v.png);
        await writeFile(path.join(variantsDir, `${v.id}.json`), JSON.stringify({ v: 1, S: v.state, ovr, refs }, null, 2));
        allVariantsById.set(v.id, v);
        if (syncCtx) {
          try {
            await syncFns.syncVariant({ ...syncCtx, variant: v, labelToUuid });
          } catch (e) {
            publishError = e.message;
            console.error(`[syndicate] syncing variant ${v.id} failed: ${e.message}`);
          }
        }
      },
    });

    // screening (config.screening.enabled) cuts this round's *new* children
    // down to `finalists` before they join the tournament — survivors
    // carried forward in `field` already went through a tournament in an
    // earlier round and aren't re-screened. Screening never feeds Elo: a
    // screened-out variant already has its PNG/JSON/Supabase row from
    // renderRound above (it rendered, so it's evidence) but never reaches
    // judgeRound/selectRound, and is marked `screened: true` below instead
    // of silently disappearing from the record.
    const { kept: screenedChildren, dropped: screenedOut } = await screenRound({
      variants: children, roundNum, config: syndicateConfig, roles, brief, referenceJpeg,
      clients, costTracker, dry, logScreened, logScreenCall,
    });

    const combinedField = roundNum === 1 ? screenedChildren : [...field, ...screenedChildren];

    const { comparisons } = await judgeRound({
      variants: combinedField, roundNum, config: syndicateConfig, roles, brief,
      referenceJpeg, clients, costTracker, dry, seedBase, logComparison,
      // fires as each vendor's real results come back — see judgeRound's
      // own comment for why this can't just be "after the round finishes"
      onComparisons: syncCtx ? async (newOnes) => {
        try {
          await syncFns.syncComparisons({ ...syncCtx, comparisons: newOnes.map(c => ({ round: roundNum, ...c })), labelToUuid });
        } catch (e) {
          publishError = e.message;
          console.error(`[syndicate] syncing round ${roundNum}'s comparisons failed: ${e.message}`);
        }
      } : undefined,
    });
    comparisons.forEach(c => allComparisons.push({ round: roundNum, ...c }));

    const survivorsCount = brief.survivors;
    const { selected, ratings, disagreements, wildcard } = dry
      ? { selected: combinedField.slice(0, survivorsCount + syndicateConfig.wildcards).map(v => v.id), ratings: {}, disagreements: {}, wildcard: null }
      : selectRound(combinedField, comparisons, survivorsCount, syndicateConfig.wildcards);

    // screened-out variants have no rating — a judge never saw them, so
    // recording one would be inventing a verdict nobody produced. `screened:
    // true` says "not taken to the floor", which the site needs to tell
    // apart from "lost the floor" (CLAUDE.md: screening never feeds Elo).
    const screened = Object.fromEntries(screenedOut.map(d => [d.id, true]));
    await writeFile(path.join(roundDir, 'ratings.json'), JSON.stringify({ dry, ratings, disagreements, selected, wildcard, screened }, null, 2));

    for (const [id, r] of Object.entries(ratings)) allRatings.set(id, r);
    for (const [id, d] of Object.entries(disagreements)) allDisagreements.set(id, d);
    for (const id of selected) survivedIds.add(id);

    // now that this round's ratings/disagreement/survival are known,
    // patch them onto the rows syncVariant() already inserted — a viewer
    // watching the feed sees a variant's rating settle, not just appear
    if (syncCtx && !dry) {
      try {
        await syncFns.syncVariantResults({ ...syncCtx, variants: combinedField, labelToUuid, allRatings, allDisagreements, survivedIds });
      } catch (e) {
        publishError = e.message;
        console.error(`[syndicate] syncing round ${roundNum}'s results failed: ${e.message}`);
      }
    }

    for (const id of selected) {
      const why = comparisons.filter(c => c.loser === id).map(c => c.why).filter(Boolean);
      if (why.length) critiquesByVariant.set(id, why);
    }

    field = selected.map(id => {
      const v = combinedField.find(x => x.id === id) ?? allVariantsById.get(id);
      return { ...v, seedRating: ratings[id] ?? v.seedRating ?? 1500 };
    });
    lastSelected = selected;
    roundsRun = roundNum;

    if (costTracker.capped() || timeUp()) { aborted = true; break; }
  }

  const finalIds = lastSelected;
  const lastRatings = field ? Object.fromEntries(field.map(v => [v.id, v.seedRating])) : {};
  const md = renderFinalMd({
    brief,
    finalIds,
    variantsById: allVariantsById,
    ratings: lastRatings,
    disagreements: {},
    comparisons: allComparisons,
    roundsRun,
    costSpent: costTracker.spent,
    roles,
  });
  await writeFile(path.join(runDir, 'FINAL.md'), md);

  // Everything above is already durably on disk in runDir, which is the
  // real record per CLAUDE.md — variants and comparisons were already
  // synced incrementally as the shift ran, so this is only the close-out:
  // set the fields only known once it's over (final rating history is
  // already in place; base_state/palette/status/cost are what's left). A
  // --brief-id shift claimed a real row (pending -> running) in
  // resolveBriefSource; that row must be closed out to done/aborted no
  // matter what --publish was passed as, or it stays stuck at 'running'
  // forever with nothing to ever flip it back.
  let published = false;
  if (syncCtx) {
    try {
      await syncFns.closeBrief({
        ...syncCtx, baseState, palette, rounds: roundsRun,
        status: aborted ? 'aborted' : 'done', costUsd: costTracker.spent,
      });
      published = true;
    } catch (e) {
      publishError = e.message;
      console.error(`[syndicate] closing the brief failed: ${e.message}`);
    }
  }

  return { runDir, roundsRun, aborted, costSpent: costTracker.spent, finalIds, dry, published, publishError };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.brief && !args.briefId) {
    console.error('usage: npm run syndicate -- (--brief <path.json> | --brief-id <uuid>) [--dry] [--publish]');
    process.exitCode = 1;
    return;
  }
  const result = await run({ briefPath: args.brief, briefId: args.briefId, dry: !!args.dry, publish: !!args.publish });
  console.log(`[syndicate] ${result.dry ? 'dry run' : 'shift'} complete: ${result.roundsRun} round(s), $${result.costSpent.toFixed(2)} spent${result.aborted ? ' (aborted: cap reached)' : ''}`);
  console.log(`[syndicate] see ${result.runDir}/FINAL.md`);
  if ((args.publish || args.briefId) && !args.dry) {
    console.log(result.published ? '[syndicate] published to Supabase' : `[syndicate] NOT published: ${result.publishError}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}

export { run, buildBaseState, resolveBriefSource };
