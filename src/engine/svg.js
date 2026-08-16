import { dom } from './state.js';
import { ribbons, layers, lattice, panels, edges, drape, outline, bbox } from './geometry.js';
import { dye, dyePanel, dyeRibbons, COLC } from './dye.js';

/* ---------- render frame: fit the sheet into a W×H box ---------- */
function frame(S,W,H){
  const D=dom(S), k=Math.min(W*0.80/D.w,H*0.80/D.h);
  return {k,ox:(W-D.w*k)/2,oy:(H-D.h*k)/2,w:D.w,h:D.h};
}

/* ---------- svg ----------
   Public signature per SPEC 1.1/1.2: svgOut(state, refs, ovr, opts).
   `state`/`refs`/`ovr` are aliased to S/REFS/OVR so the body below is the
   original generator code, otherwise unchanged. */
function svgOut(state,refs,ovr,opts={}){
  const S=state, REFS=refs, OVR=ovr;
  const quality=opts.quality||'full';
  const base=opts.base||(quality==='preview'?700:1600);
  const D=dom(S), W=Math.round(base*D.w), H=Math.round(base*D.h);
  const R=ribbons(S), F=frame(S,W,H), L=layers(S), LT=lattice(S,L);
  /* the browser export used to rescale stroke widths against the live
     on-screen canvas size (view.clientWidth/Height); that DOM reference does
     not exist here. The original code already fell back to sc=1 whenever the
     view had no size yet, so this is that same fallback, made unconditional. */
  const sc=1;
  const T=p=>[(p[0]*F.k+F.ox),(p[1]*F.k+F.oy)];
  const T2=p=>T(p).map(v=>v.toFixed(2));
  const poly2=a=>a.map(p=>T2(p).join(',')).join(' ');
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
  const PS=[dye(S,REFS,OVR,F.k,0,undefined,quality),dye(S,REFS,OVR,F.k,1,undefined,quality),dye(S,REFS,OVR,F.k,2,undefined,quality),dye(S,REFS,OVR,F.k,3,undefined,quality)];
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
      buf=[]; dyePanel(S,sink,poly,E,LT.X,LT.Y,T,PS);
      if(buf.length) body+=`<g fill="none" stroke-linecap="butt" stroke-linejoin="round">${buf.join('')}</g>`;
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
      buf=[]; dyePanel(S,sink,poly,E,LT.X,LT.Y,T,PS);
      if(buf.length) body+=`<g fill="none" stroke-linecap="butt" stroke-linejoin="round">${buf.join('')}</g>`;
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
    buf=[]; dyeRibbons(S,sink,R,T,dye(S,REFS,OVR,F.k,4,undefined,quality));
    if(buf.length) body+=`<g fill="none" stroke-linecap="butt" stroke-linejoin="round">${buf.join('')}</g>`;
  }
  body+='</g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`+
         `<rect width="${W}" height="${H}" fill="${S.bg}"/><defs>${defs}</defs>${body}</svg>`;
}

export { frame, svgOut };
