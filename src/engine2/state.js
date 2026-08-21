/* Model 2 — "lines". The cloth underneath is model 1's, function for
   function; what changes is what gets laid inside the cells: short bars
   from an ink library instead of dyed colour fields. RATIOS and dom() are
   re-exported from src/engine, not copied — they are byte-identical there
   and one frozen copy of a thing is the whole point.

   Extracted from generator/index2.html on 2026-08-21, byte for byte
   (CLAUDE.md). The only changes permitted, and the only ones made: S is
   threaded through as an explicit argument instead of read off a module
   global, DOM access is removed, and exports are added. */
import { RATIOS, dom } from '../engine/state.js';

const S={
  ratio:3, pattern:'grid', cols:4, rows:9, weave:2.0, edge:2.0, dot:56,
  nv:1, nh:2, rw:31, angle:79, scatter:13, over:-6,
  squeeze:15, swell:32, round:53, drape:45, hand:26,
  thread:'#B0822F', cell:'#FFFFFF', ribbon:'#1877E0', bg:'#FFFFFF',
  seed:11,
  /* lines — shared brush */
  paint:1, pitch:26, weight:52, length:88, jitter:16, shade:6, caps:'round', cseed:5, wover:1,
  /* five stacked layers; index 4 lays bars across the ribbons */
  L:[{inks:['#141414'],dir:'h',span:'cell',cover:50,on:1},
     {inks:['#141414'],dir:'v',span:'cell',cover:100,on:1},
     {inks:['#3F4348'],dir:'h',span:'cell',cover:100,on:0},
     {inks:['#B0822F'],dir:'v',span:'cell',cover:100,on:0},
     {inks:['#FFFFFF'],dir:'v',span:'cell',cover:100,on:0}]
};

export { S, RATIOS, dom };
