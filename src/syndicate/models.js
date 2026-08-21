/* Which generator a shift is running.
 *
 * There are two, and almost everything downstream needs to know which: the
 * validator that gates a patch, the pool a mechanical mutation draws from,
 * the vocabulary an agent is told, the default state a shift starts from,
 * and the renderer. Each of those could have grown its own `if (model === 2)`;
 * this file exists so the fork is stated once and read everywhere else.
 *
 * Model 1 renders from colour studies — svgOut(state, refs, ovr, opts).
 * Model 2's inks are named in its own state and it has no studies at all, so
 * its svgOut takes no refs. The `svg` wrapper below gives both the same
 * shape, which is what lets render-core stay ignorant of the difference.
 */

import * as ENGINE_1 from '../engine/index.js';
import * as ENGINE_2 from '../engine2/index.js';
import { SCHEMA as SCHEMA_1, validate as validate1 } from './patch.js';
import { SCHEMA as SCHEMA_2, validate as validate2 } from './patch2.js';

const MODELS = {
  1: {
    id: 1,
    slug: 'dyed',
    title: 'dyed cloth',
    file: 'generator/index.html',
    schema: SCHEMA_1,
    validate: validate1,
    defaultState: ENGINE_1.S,
    /** model 1 dyes from the brief's studies, so refs/ovr are load-bearing */
    usesStudies: true,
    svg: (state, refs, ovr, opts) => ENGINE_1.svgOut(state, refs, ovr, opts),
  },
  2: {
    id: 2,
    slug: 'ruled',
    title: 'ruled cloth',
    file: 'generator/index2.html',
    schema: SCHEMA_2,
    validate: validate2,
    defaultState: ENGINE_2.S,
    /** model 2's inks are named in its state; a study would have nothing to
     *  say to it, and the palette analyser would read stripes as a palette */
    usesStudies: false,
    svg: (state, refs, ovr, opts) => ENGINE_2.svgOut(state, opts),
  },
};

/**
 * modelFor(id) -> model
 *
 * An absent id is model 1: every brief written before generators were a
 * choice has no such field, and every one of them ran model 1. An id that
 * is present but unrecognised throws rather than falling back — a shift
 * that silently ran the wrong generator would render 32 real variants, cost
 * real money, and be wrong in a way nothing on the page would show.
 */
function modelFor(id) {
  if (id === undefined || id === null || id === '') return MODELS[1];
  const model = MODELS[Number(id)];
  if (!model) throw new Error(`unknown generator model: ${JSON.stringify(id)} — this repository has 1 and 2`);
  return model;
}

export { MODELS, modelFor };
