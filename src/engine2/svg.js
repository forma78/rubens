/* SVG out for model 2. frame()/canonicalFrame() are src/engine's — the
   same function and the same fixed reference viewport, so weave and edge
   widths scale the same way here as they do for model 1. That reference is
   why the browser's own canvas size is gone from this file: index2.html
   divided by whatever the window happened to be, which cannot survive on a
   server with no window. See src/engine/svg.js for the reasoning.

   Public signature matches model 1's: svgOut(state, opts). No refs/ovr —
   model 2 has no colour studies behind it, its inks are named in the state. */
import { dom } from '../engine/state.js';
import { ribbons, layers, lattice, panels, edges, drape, outline, bbox } from '../engine/geometry.js';
import { frame, canonicalFrame, CANONICAL_BASE } from '../engine/svg.js';
import { ink, COLC } from './ink.js';
import { barPanel, barRibbons } from './bars.js';

function svgOut(state,opts={}){
  const S=state;
  const quality=opts.quality||'full';
  const base=opts.base||(quality==='preview'?700:1600);
  const D=dom(S), W=Math.round(base*D.w), H=Math.round(base*D.h);
  const R=ribbons(S), F=frame(S,W,H), L=layers(S), LT=lattice(S,L);
  const sc=F.k/canonicalFrame(S).k;
  const T=p=>[(p[0]*F.k+F.ox),(p[1]*F.k+F.oy)];
  const T2=p=>T(p).map(v=>v.toFixed(2));
  const poly2=a=>a.map(p=>T2(p).join(',')).join(' ');
  const cap=S.caps==='round'?'round':'butt';
  const strand=(E,B,axis,v)=>{
    const pad=0.06, a=(axis==='v'?B.y0:B.x0)-pad, b=(axis==='v'?B.y1:B.x1)+pad;
    const n=Math.max(8,Math.round((b-a)*(S.drape>0?160:2))), out=[];
    for(let s=0;s<=n;s++){
      const t=a+(b-a)*s/n;
      out.push(drape(S, axis==='v'?v:t, axis==='v'?t:v, E));
    }
    return poly2(out);
  };
  const on=S.paint&&S.pattern==='grid';
  const PS=[ink(S,F.k,0),ink(S,F.k,1),ink(S,F.k,2),ink(S,F.k,3)];
  let buf=[];
  const sink=(pts,col,w)=>{
    buf.push(`<polyline points="${pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')}" stroke="${col}" stroke-width="${w.toFixed(2)}"/>`);
  };
  sink.flush=()=>{};
  let defs='', body='', n=0;
  COLC.clear();
  for(const poly of panels(S,R)){
    const E=edges(S,poly), B=bbox(poly), pts=poly2(outline(S,poly,E)), id='p'+(n++);
    defs+=`<clipPath id="${id}"><polygon points="${pts}"/></clipPath>`;
    body+=`<polygon points="${pts}" fill="${S.cell}"/><g clip-path="url(#${id})">`;
    if(on&&S.wover){
      buf=[]; barPanel(S,sink,poly,E,LT.X,LT.Y,T,PS);
      if(buf.length) body+=`<g fill="none" stroke-linecap="${cap}" stroke-linejoin="round">${buf.join('')}</g>`;
    }
    if(S.pattern==='grid'){
      body+=`<g fill="none" stroke="${S.thread}" stroke-width="${(S.weave*sc).toFixed(2)}" stroke-linejoin="round">`;
      for(const x of L.xs) if(x>B.x0-0.08&&x<B.x1+0.08) body+=`<polyline points="${strand(E,B,'v',x)}"/>`;
      for(const y of L.ys) if(y>B.y0-0.08&&y<B.y1+0.08) body+=`<polyline points="${strand(E,B,'h',y)}"/>`;
      body+='</g>';
    } else {
      const r=((S.dot/100)*Math.min(L.cw,L.ch)*F.k/2).toFixed(2);
      body+=`<g fill="${S.thread}">`;
      for(let i=0;i<S.cols;i++) for(let j=0;j<S.rows;j++){
        const x=(i+0.5)*L.cw, y=(j+0.5)*L.ch;
        if(x<B.x0-0.08||x>B.x1+0.08||y<B.y0-0.08||y>B.y1+0.08) continue;
        const p=T2(drape(S,x,y,E));
        body+=`<circle cx="${p[0]}" cy="${p[1]}" r="${r}"/>`;
      }
      body+='</g>';
    }
    if(on&&!S.wover){
      buf=[]; barPanel(S,sink,poly,E,LT.X,LT.Y,T,PS);
      if(buf.length) body+=`<g fill="none" stroke-linecap="${cap}" stroke-linejoin="round">${buf.join('')}</g>`;
    }
    body+=`</g><polygon points="${pts}" fill="none" stroke="${S.thread}" stroke-width="${(S.edge*sc).toFixed(2)}" stroke-linejoin="round"/>`;
  }
  const ov=S.over/100;
  defs+=`<clipPath id="band"><rect x="${(F.ox-ov*F.k).toFixed(2)}" y="${(F.oy-ov*F.k).toFixed(2)}" width="${((F.w+2*ov)*F.k).toFixed(2)}" height="${((F.h+2*ov)*F.k).toFixed(2)}"/></clipPath>`;
  body+=`<g clip-path="url(#band)"><g stroke="${S.ribbon}" stroke-width="${((S.rw/1000)*F.k).toFixed(2)}">`;
  for(const r of R.all){
    const a=T2([r.px-r.dx*2,r.py-r.dy*2]), b=T2([r.px+r.dx*2,r.py+r.dy*2]);
    body+=`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  }
  body+='</g>';
  if(S.paint&&S.L[4].on){
    buf=[]; barRibbons(S,sink,R,T,ink(S,F.k,4));
    if(buf.length) body+=`<g fill="none" stroke-linecap="${cap}" stroke-linejoin="round">${buf.join('')}</g>`;
  }
  body+='</g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`+
         `<rect width="${W}" height="${H}" fill="${S.bg}"/><defs>${defs}</defs>${body}</svg>`;
}

export { svgOut, frame, canonicalFrame, CANONICAL_BASE };
