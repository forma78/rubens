/* SPEC 3 — a shift. The CLI entry point: propose -> render -> judge -> rank
   -> select -> mutate, across brief.rounds, writing runs/<brief.id>/ as it
   goes (SPEC 3.4) and stopping the moment the cost or time cap is reached
   (SPEC 3.5), writing whatever it has rather than pretending the shift
   finished. */

import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

import { S as DEFAULT_STATE } from '../engine/index.js';
import { loadEnv } from './env.js';
import { loadBrief } from './brief.js';
import { createCostTracker } from './cost.js';
import { renderToPng } from './render-core.js';
import { toTransmitJpeg } from './image.js';
import { proposeRound, renderRound, judgeRound, selectRound } from './round.js';
import { renderFinalMd } from './report.js';
import { analyseFile } from '../analyse/decode.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry') args.dry = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  return args;
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

async function run({ briefPath, dry = false, cwd = process.cwd(), runsDir }) {
  const fileConfig = JSON.parse(await readFile(path.join(cwd, 'config/syndicate.json'), 'utf8'));
  const roles = JSON.parse(await readFile(path.join(cwd, 'config/roles.json'), 'utf8'));
  const env = await loadEnv(path.join(cwd, '.env'));
  const brief = await loadBrief(briefPath, fileConfig);
  const referencePath = path.join(cwd, brief.reference);

  // the brief's rounds/variantsPerRound/survivors (already resolved against
  // fileConfig's defaults by loadBrief) are what actually govern this
  // shift — round.js reads variantsPerRound off `config`, so that override
  // has to reach it, not just fileConfig's untouched default
  const syndicateConfig = { ...fileConfig, variantsPerRound: brief.variantsPerRound, survivors: brief.survivors };

  if (!dry) {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in .env — required for a real shift (use --dry to skip model calls)');
    if (!env.XAI_API_KEY) throw new Error('XAI_API_KEY is not set in .env — required for a real shift (use --dry to skip model calls)');
  }
  const clients = dry ? {} : {
    anthropic: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    xai: new OpenAI({ apiKey: env.XAI_API_KEY, baseURL: syndicateConfig.models.xai.base_url }),
  };

  const runDir = path.join(runsDir ?? path.join(cwd, 'runs'), brief.id);
  await mkdir(runDir, { recursive: true });

  const { state: baseState, refs, ovr, palette } = await buildBaseState(brief, referencePath);
  await writeFile(path.join(runDir, 'brief.json'), JSON.stringify(brief, null, 2));
  await writeFile(path.join(runDir, 'base-state.json'), JSON.stringify({ v: 1, S: baseState, ovr, refs }, null, 2));
  await writeFile(path.join(runDir, 'palette.json'), JSON.stringify(palette, null, 2));

  const referenceJpeg = await toTransmitJpeg(await readFile(referencePath));

  const costTracker = createCostTracker(syndicateConfig.limits.maxUsd);
  const startedAt = Date.now();
  const maxMs = syndicateConfig.limits.maxMinutes * 60 * 1000;
  const timeUp = () => Date.now() - startedAt > maxMs;

  const seedBase = hashSeed(brief.id);
  const allVariantsById = new Map();
  const allComparisons = [];
  const critiquesByVariant = new Map(); // variant id -> [why, ...] said about it when it lost

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
  });
  await writeFile(path.join(runDir, 'FINAL.md'), md);

  return { runDir, roundsRun, aborted, costSpent: costTracker.spent, finalIds, dry };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.brief) {
    console.error('usage: npm run syndicate -- --brief <path.json> [--dry]');
    process.exitCode = 1;
    return;
  }
  const result = await run({ briefPath: args.brief, dry: !!args.dry });
  console.log(`[syndicate] ${result.dry ? 'dry run' : 'shift'} complete: ${result.roundsRun} round(s), $${result.costSpent.toFixed(2)} spent${result.aborted ? ' (aborted: cap reached)' : ''}`);
  console.log(`[syndicate] see ${result.runDir}/FINAL.md`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exitCode = 1; });
}

export { run, buildBaseState };
