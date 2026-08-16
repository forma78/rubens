import { h3, vn } from './rng.js';
import { reband, unhex, hex } from './colour.js';
import { dom } from './state.js';
import { drape, bbox } from './geometry.js';

/* ---- paint parameters, derived once per frame ----
   `quality` is new: it is not part of the original brush maths, it only
   selects how hard dyeCell/dyeRibbons cap their stroke step count (see
   below) so that svgOut's preview renders are cheap, per SPEC 1.2. */
function dye(S,REFS,OVR,k,li,ref,quality){
  const cfg=S.L[li];
  const use=Math.max(0,Math.min((ref===undefined)?cfg.ref:ref,REFS.length-1));
  const R=reband(REFS,use,cfg.bands);
  const pal=R.pal.map((c,i)=>(use===cfg.ref&&OVR[li][i])?unhex(OVR[li][i]):c);
  const K=pal.length;
  return {
    id:li, pal, prof:R.prof, K, k,
    seed:S.cseed+li*17,
    pitch:S.pitch/2000,
    shift:(S.ilock/100)*0.18,
    fi:0.20+(S.ilock/100)*0.70,
    ft:0.45*K,
    grain:(S.grain/100)*0.6,
    load:S.load/100,
    dir:cfg.dir, span:cfg.span,
    quality:quality||'full'
  };
}
/* colour choice: the profile gives a probability over pure colours at every
   point of the gradient; one seeded draw per stroke turns it into paint. */
function pick(P,n,t){
  let tp=t+P.shift*(h3(n,3,P.seed)-0.5);
  tp=tp<0?0:tp>0.9999?0.9999:tp;
  const M=P.prof.length, row=P.prof[Math.min(M-1,(tp*M)|0)];
  /* value noise piles up around 0.5; the logistic spreads it back to uniform
     so a band is chosen exactly as often as the reference says it should be */
  const q=(1-P.grain)*vn(n*P.fi,tp*P.ft,P.seed)+P.grain*vn(n*P.fi*2.3,tp*P.ft*3.3,P.seed+91);
  const r=1/(1+Math.exp(-10*(q-0.5)));
  let acc=0;
  for(let k=0;k<row.length;k++){ acc+=row[k]; if(r<acc) return k; }
  return row.length-1;
}
/* one brush load per stroke — thinner paint lets the ground through.
   Load and width are quantised so strokes batch into few draw calls. */
let COLC=new Map();
function strokeInk(P,n){
  const q=Math.floor(h3(n,2,P.seed)*12), key=P.id+'|'+P.seed+'|'+q;
  let c=COLC.get(key); if(c) return c;
  const f=(q/12-0.45)*P.load;
  c=P.pal.map(rgb=>hex(f>0?rgb.map(v=>v*(1-f)+255*f):rgb.map(v=>v*(1+f*0.6))));
  COLC.set(key,c); return c;
}
const strokeW=(P,n,sp)=>Math.max(0.55,(sp||P.pitch)*P.k*(1.00+0.45*(Math.floor(h3(n,1,P.seed)*8)/8)));

/* ---- the gradient's own grid: how far one run of colour reaches ---- */
function reach(j,A,P){
  if(P.span==='sheet') return [A[0],A[A.length-1]];
  const sp=P.span==='cell'?1:Math.max(1,P.K);
  const r=Math.floor(j/sp);
  return [A[Math.min(A.length-1,r*sp)], A[Math.min(A.length-1,(r+1)*sp)]];
}
/* Which layer owns this cell. Layer 1 sits on top and keeps every cell whose
   draw falls under its coverage; layer 2 only gets what layer 1 left, and so
   on down the stack. Turn a layer off and the one beneath shows through. */
function owner(S,i,j){
  const r=h3(i+7,j+13,S.cseed*31+5)*100;
  for(let L=0;L<4;L++){ const y=S.L[L]; if(y.on&&r<y.cover) return L; }
  return -1;
}
function shareOf(S,li){
  if(!S.L[li].on) return 0;
  let prev=0;
  for(let L=0;L<li;L++) if(S.L[L].on&&S.L[L].cover>prev) prev=S.L[L].cover;
  return Math.max(0,S.L[li].cover-prev);
}

/* ---- lay the strokes of one cell; nothing crosses the cell border ---- */
function dyeCell(S,sink,i,j,X,Y,E,T,P){
  const x0=X[i],x1=X[i+1],y0=Y[j],y1=Y[j+1];
  if(x1-x0<=1e-6||y1-y0<=1e-6) return;
  const V=P.dir==='v';
  const a0=V?x0:y0, a1=V?x1:y1;                  /* across the strokes */
  const b0=V?y0:x0, b1=V?y1:x1;                  /* along  the strokes */
  const R=V?reach(j,Y,P):reach(i,X,P);
  const g0=R[0], g1=Math.max(R[1],R[0]+1e-6);
  const cap=P.quality==='preview'?24:70;
  const steps=Math.max(3,Math.min(cap,Math.round((b1-b0)*P.k/2.4)));
  const span=a1-a0, m=Math.max(1,Math.round(span/P.pitch)), sp=span/m;
  const base=Math.round(a0/P.pitch);
  for(let q=0;q<m;q++){
    const n=base+q;
    const w=Math.min(strokeW(P,n,sp),span*P.k), half=w/P.k/2;
    let u=a0+(q+0.5)*sp+(h3(n,0,P.seed)-0.5)*sp*0.30;
    if(u-half<a0) u=a0+half;
    if(u+half>a1) u=a1-half;
    const ink=strokeInk(P,n);
    let cur=-1, seg=null, prev=null;
    for(let s=0;s<=steps;s++){
      const q=b0+(b1-b0)*s/steps;
      const k=pick(P,n,(q-g0)/(g1-g0));
      const p=T(drape(S,V?u:q, V?q:u, E));
      if(k!==cur){
        if(seg){ seg.push(p); sink(seg,ink[cur],w); }
        seg=prev?[prev,p]:[p]; cur=k;
      } else seg.push(p);
      prev=p;
    }
    if(seg&&seg.length>1) sink(seg,ink[cur],w);
  }
}
function dyePanel(S,sink,poly,E,X,Y,T,PS){
  const B=bbox(poly), m=0.02;
  let i0=0,i1=X.length-2,j0=0,j1=Y.length-2;
  while(i0<i1&&X[i0+1]<B.x0-m) i0++;
  while(i1>i0&&X[i1]>B.x1+m) i1--;
  while(j0<j1&&Y[j0+1]<B.y0-m) j0++;
  while(j1>j0&&Y[j1]>B.y1+m) j1--;
  for(let i=i0;i<=i1;i++) for(let j=j0;j<=j1;j++){
    const L=owner(S,i,j); if(L<0) continue;
    const cx=(X[i]+X[i+1])/2, cy=(Y[j]+Y[j+1])/2;
    const r=Math.hypot(X[i+1]-X[i],Y[j+1]-Y[j])/2+0.03;
    let out=false;
    for(const e of E) if((cx-e.ax)*e.nx+(cy-e.ay)*e.ny < -r){ out=true; break; }
    if(out) continue;
    dyeCell(S,sink,i,j,X,Y,E,T,PS[L]);
  }
}
/* ---- ribbons: one master is painted, the rest of the group copy it ---- */
function ribbonSpan(r,D,ov){
  let s0=-4,s1=4;
  const cut=(p,d,lo,hi)=>{
    if(Math.abs(d)<1e-9){ if(p<lo||p>hi){s0=1;s1=-1;} return; }
    let a=(lo-p)/d, b=(hi-p)/d; if(a>b){const t=a;a=b;b=t;}
    if(a>s0)s0=a; if(b<s1)s1=b;
  };
  cut(r.px,r.dx,-ov,D.w+ov); cut(r.py,r.dy,-ov,D.h+ov);
  return [s0,s1];
}
function dyeRibbons(S,sink,R,T,P){
  const D=dom(S), ov=S.over/100, W=S.rw/1000;
  for(const grp of [{list:R.V,sd:P.seed+7},{list:R.H,sd:P.seed+29}]){
    if(!grp.list.length) continue;
    const master=ribbonSpan(grp.list[0],D,ov);
    const len=Math.max(1e-6,master[1]-master[0]);          /* followers copy the master's run */
    const Q=Object.assign({},P,{seed:grp.sd});
    const m=Math.max(1,Math.round(W/P.pitch)), pitch=W/m;
    for(const r of grp.list){
      const sp=ribbonSpan(r,D,ov); if(sp[1]<=sp[0]) continue;
      const cap=Q.quality==='preview'?80:220;
      const steps=Math.max(6,Math.min(cap,Math.round((sp[1]-sp[0])*P.k/2.4)));
      for(let n=0;n<m;n++){
        const w=Math.min(strokeW(Q,n+9001,pitch),W*P.k), half=w/P.k/2;
        let v=-W/2+(n+0.5)*pitch+(h3(n,0,Q.seed)-0.5)*pitch*0.3;
        if(v-half<-W/2) v=-W/2+half;
        if(v+half> W/2) v= W/2-half;
        const ink=strokeInk(Q,n+9001);
        const ox=r.px+r.nx*v, oy=r.py+r.ny*v;
        let cur=-1, seg=null, prev=null;
        for(let s=0;s<=steps;s++){
          const q=sp[0]+(sp[1]-sp[0])*s/steps;
          const k=pick(Q,n,(q-sp[0])/len);
          const p=T([ox+r.dx*q, oy+r.dy*q]);
          if(k!==cur){
            if(seg){ seg.push(p); sink(seg,ink[cur],w); }
            seg=prev?[prev,p]:[p]; cur=k;
          } else seg.push(p);
          prev=p;
        }
        if(seg&&seg.length>1) sink(seg,ink[cur],w);
      }
    }
  }
}
/* strokeInk caches by index — ribbons use a different seed, so key them apart */

export { dye, pick, strokeInk, strokeW, reach, owner, shareOf, dyeCell, dyePanel, ribbonSpan, dyeRibbons, COLC };
