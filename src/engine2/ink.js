/* The ink library and the brush. hex/unhex/h3 come from src/engine —
   identical there, so they are imported rather than kept twice. */
import { h3 } from '../engine/rng.js';
import { hex, unhex } from '../engine/colour.js';

/* ---- ink presets: whole sets of bar colours ---- */
const PRESETS=[
  {name:'Ink',        inks:['#141414']},
  {name:'Graphite',   inks:['#1A1A1A','#3F4348']},
  {name:'Gold ash',   inks:['#B0822F','#42464B']},
  {name:'Iron',       inks:['#101317','#2E3944','#5A646E']},
  {name:'Ochre',      inks:['#2A2A2A','#8A6A22','#C9A24A']},
  {name:'Bone',       inks:['#141414','#9AA0A6','#D8D2C6']}
];
const SPARE=['#141414','#3F4348','#B0822F','#6E7A86','#8A6A22'];

/* ---- per-layer brush parameters, derived once per frame ---- */
function ink(S,k,li,over){
  const cfg=S.L[li];
  return {
    id:li, k,
    inks:(over||cfg.inks).slice(),
    dir:cfg.dir, span:cfg.span,
    seed:S.cseed+li*17,
    pitch:S.pitch/2000,
    weight:S.weight/100,
    len:S.length/100,
    jit:S.jitter/100,
    shade:S.shade/100,
    round:S.caps==='round'
  };
}
function inkOf(P,n,i,j){
  const K=P.inks.length;
  if(K<2) return P.inks[0];
  let r;
  if(P.span==='sheet')      r=h3(i*3+j*5,17,P.seed);
  else if(P.span==='cell')  r=h3(i+11,j+7,P.seed);
  else                      r=h3(n*13+i*29,j*7+n,P.seed+3);
  return P.inks[Math.min(K-1,Math.floor(r*K))];
}
/* one brush load per bar — quantised so bars batch into few draw calls */
let COLC=new Map();
function shadeOf(col,P,n){
  if(P.shade<=0) return col;
  const q=Math.floor(h3(n,2,P.seed)*10), key=col+'|'+q+'|'+P.shade.toFixed(2);
  let c=COLC.get(key); if(c) return c;
  const f=(q/10-0.45)*P.shade, rgb=unhex(col);
  c=hex(f>0?rgb.map(v=>v*(1-f)+255*f):rgb.map(v=>v*(1+f*0.6)));
  COLC.set(key,c); return c;
}

export { PRESETS, SPARE, ink, inkOf, shadeOf, COLC };
