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

import { S as DEFAULT_STATE } from '../engine/index.js';
import { loadEnv } from './env.js';
import { loadBrief, normaliseBrief } from './brief.js';
import { CANVAS_PROFILES } from './canvas.js';
import { createCostTracker } from './cost.js';
import { renderToPng } from './render-core.js';
import { toTransmitJpeg } from './image.js';
import { proposeRound, renderRound, judgeRound, selectRound } from './round.js';
import { renderFinalMd } from './report.js';
import { analyseFile } from '../analyse/decode.js';
import { signIn, syncShift, fetchBriefById, claimBrief } from './sync.js';

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
 * signIn, claimBrief, fetchBriefById }) -> { brief, referencePath, existingBriefId, accessToken }
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
 */
async function resolveBriefSource({
  briefId, briefPath, cwd, fileConfig, env, fetchImpl, dry,
  signIn: signInFn, claimBrief: claimBriefFn, fetchBriefById: fetchBriefByIdFn,
}) {
  if (!briefId) {
    const brief = await loadBrief(briefPath, fileConfig);
    return { brief, referencePath: path.join(cwd, brief.reference), existingBriefId: null, accessToken: null };
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
    reference: claimed.reference,
    rounds: claimed.rounds,
  }, fileConfig, `brief ${briefId} (from Supabase)`);

  // claimed.reference is a Storage URL, not a local path — analyseFile()
  // needs a real file. Downloaded to the OS temp dir, not under runs/: the
  // runDir this brief.id maps to gets rm-and-recreated a few lines below
  // (in run()), which would delete an image parked there first, and
  // runs/ is committed evidence — a scratch download doesn't belong in it
  // regardless.
  const imgRes = await (fetchImpl ?? fetch)(claimed.reference);
  if (!imgRes.ok) throw new Error(`run: could not download reference image ${claimed.reference}: ${imgRes.status}`);
  const ext = path.extname(new URL(claimed.reference).pathname) || '.jpg';
  const referencePath = path.join(tmpdir(), `rubens-reference-${brief.id}${ext}`);
  await writeFile(referencePath, Buffer.from(await imgRes.arrayBuffer()));

  return { brief, referencePath, existingBriefId: claimed.id, accessToken };
}

function jsonlLine(obj) {
  return JSON.stringify(obj) + '\n';
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

async function buildBaseState(brief, referencePath) {
  const analysed = await analyseFile(referencePath);
  const refs = [{ name: brief.reference, pal: analysed.pal, prof: analysed.prof }];
  const state = structuredClone(DEFAULT_STATE);
  state.ratio = brief.ratio;
  state.L = state.L.map(l => ({ ...l, ref: 0 })); // SPEC 3.2: locked to the one analysed reference
  return { state, refs, ovr: [{}, {}, {}, {}, {}], palette: analysed };
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
  const syncFns = syncOverride ?? { signIn, syncShift, claimBrief, fetchBriefById };
  const { brief, referencePath, existingBriefId, accessToken: claimAccessToken } = await resolveBriefSource({
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

  const { state: baseState, refs, ovr, palette } = await buildBaseState(brief, referencePath);
  await writeFile(path.join(runDir, 'brief.json'), JSON.stringify(brief, null, 2));
  await writeFile(path.join(runDir, 'base-state.json'), JSON.stringify({ v: 1, S: baseState, ovr, refs }, null, 2));
  await writeFile(path.join(runDir, 'palette.json'), JSON.stringify(palette, null, 2));

  const referenceJpeg = await toTransmitJpeg(await readFile(referencePath));

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

  const basePng = await renderToPng(baseState, refs, ovr, { quality: 'preview' });
  const baseParent = { id: 'base', state: baseState, png: basePng, source: 'base', intent: 'base state', roundNum: 'base', seedRating: 1500 };
  allVariantsById.set('base', baseParent);

  for (let roundNum = 1; roundNum <= brief.rounds; roundNum++) {
    if (costTracker.capped() || timeUp()) { aborted = true; break; }

    const roundDir = path.join(runDir, `round-${roundNum}`);
    const variantsDir = path.join(roundDir, 'variants');
    await mkdir(variantsDir, { recursive: true });
    const proposalsPath = path.join(roundDir, 'proposals.jsonl');
    const comparisonsPath = path.join(roundDir, 'comparisons.jsonl');

    const parents = roundNum === 1 ? [baseParent] : field;
    const logProposal = (entry) => appendFile(proposalsPath, jsonlLine({ round: roundNum, ...entry }));
    const logComparison = (entry) => appendFile(comparisonsPath, jsonlLine({ round: roundNum, ...entry }));

    const children = await proposeRound({
      parents, roundNum, config: syndicateConfig, roles, brief,
      unlockedColours: brief.unlockedColours, clients, costTracker, dry, seedBase,
      logProposal, critiquesFor: (id) => critiquesByVariant.get(id) ?? [],
    });
    await renderRound(children, refs, ovr);
    children.forEach(v => { v.roundNum = `round-${roundNum}`; });

    for (const v of children) {
      await writeFile(path.join(variantsDir, `${v.id}.png`), v.png);
      await writeFile(path.join(variantsDir, `${v.id}.json`), JSON.stringify({ v: 1, S: v.state, ovr, refs }, null, 2));
      allVariantsById.set(v.id, v);
    }

    const combinedField = roundNum === 1 ? children : [...field, ...children];

    const { comparisons } = await judgeRound({
      variants: combinedField, roundNum, config: syndicateConfig, roles, brief,
      referenceJpeg, clients, costTracker, dry, seedBase, logComparison,
    });
    comparisons.forEach(c => allComparisons.push({ round: roundNum, ...c }));

    const survivorsCount = brief.survivors;
    const { selected, ratings, disagreements, wildcard } = dry
      ? { selected: combinedField.slice(0, survivorsCount + syndicateConfig.wildcards).map(v => v.id), ratings: {}, disagreements: {}, wildcard: null }
      : selectRound(combinedField, comparisons, survivorsCount, syndicateConfig.wildcards);

    await writeFile(path.join(roundDir, 'ratings.json'), JSON.stringify({ dry, ratings, disagreements, selected, wildcard }, null, 2));

    for (const [id, r] of Object.entries(ratings)) allRatings.set(id, r);
    for (const [id, d] of Object.entries(disagreements)) allDisagreements.set(id, d);
    for (const id of selected) survivedIds.add(id);

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

  // Phase 4: batch-sync the finished shift to Supabase (metadata only, no
  // image upload — see src/syndicate/sync.js). Everything up to this point
  // is already durably on disk in runDir, which is the real record per
  // CLAUDE.md; a publish failure here is reported, not thrown, so it never
  // masquerades as the shift itself having failed.
  // a --brief-id shift claimed a real row (pending -> running) in
  // resolveBriefSource; that row must be closed out to done/aborted no
  // matter what --publish was passed as, or it stays stuck at 'running'
  // forever with nothing to ever flip it back
  let published = false, publishError = null;
  if ((publish || existingBriefId) && !dry) {
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_EMAIL || !env.SUPABASE_PASSWORD) {
        throw new Error('--publish requires SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_EMAIL/SUPABASE_PASSWORD all set in .env');
      }
      // reuse the token resolveBriefSource already signed in with for a
      // --brief-id shift, rather than signing in a second time
      const accessToken = claimAccessToken ?? (await syncFns.signIn({
        supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY,
        email: env.SUPABASE_EMAIL, password: env.SUPABASE_PASSWORD, fetchImpl,
      })).accessToken;
      await syncFns.syncShift({
        supabaseUrl: env.SUPABASE_URL, apikey: env.SUPABASE_ANON_KEY, accessToken,
        brief, baseState, palette, variantsById: allVariantsById, comparisons: allComparisons,
        allRatings, allDisagreements, survivedIds, roundsRun, costSpent: costTracker.spent, aborted,
        briefId: existingBriefId,
      }, { fetchImpl });
      published = true;
    } catch (e) {
      publishError = e.message;
      console.error(`[syndicate] publish to Supabase failed: ${e.message}`);
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
