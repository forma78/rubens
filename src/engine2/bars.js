/* Laying the bars. owner()/shareOf()/ribbonSpan() and the whole cloth
   geometry are src/engine's — identical, so imported. */
import { h3 } from '../engine/rng.js';
import { dom } from '../engine/state.js';
import { drape, bbox } from '../engine/geometry.js';
import { owner, ribbonSpan } from '../engine/dye.js';
import { ink, inkOf, shadeOf } from './ink.js';

/* ---- lay the bars of one cell; nothing crosses the cell border ---- */
function barCell(S,sink,i,j,X,Y,E,T,P){
  const x0=X[i],x1=X[i+1],y0=Y[j],y1=Y[j+1];
  if(x1-x0<=1e-6||y1-y0<=1e-6) return;
  const V=P.dir==='v';
  const a0=V?x0:y0, a1=V?x1:y1;                  /* across the bars */
  const b0=V?y0:x0, b1=V?y1:x1;                  /* along  the bars */
  const span=a1-a0, run=b1-b0;
  const m=Math.max(1,Math.round(span/P.pitch)), sp=span/m;
  const base=Math.round(a0/P.pitch)+i*31+j*17;
  const steps=S.drape>0?Math.max(2,Math.min(16,Math.round(run*P.k/9))):1;
  for(let q=0;q<m;q++){
    const n=base+q;
    let w=sp*P.weight*(1+(h3(n,1,P.seed)-0.5)*P.jit*0.45);
    w=Math.max(sp*0.05,Math.min(w,sp*0.96));
    const half=w/2;
    let u=a0+(q+0.5)*sp+(h3(n,0,P.seed)-0.5)*sp*P.jit*0.40;
    if(u-half<a0) u=a0+half;
    if(u+half>a1) u=a1-half;
    let L=run*P.len*(1+(h3(n,4,P.seed)-0.5)*P.jit*0.50);
    L=Math.max(run*0.04,Math.min(L,run*0.99));
    const slack=(run-L)/2;
    const c=(b0+b1)/2+(h3(n,5,P.seed)-0.5)*slack*P.jit*1.2;
    let c0=c-L/2, c1=c+L/2;
    if(c0<b0+run*0.004){ c1+=b0+run*0.004-c0; c0=b0+run*0.004; }
    if(c1>b1-run*0.004){ c0-=c1-(b1-run*0.004); c1=b1-run*0.004; }
    if(c0<b0) c0=b0;
    if(P.round){ const t=Math.min(half,(c1-c0)/2*0.98); c0+=t; c1-=t; }
    if(c1-c0<1e-6){ if(!P.round) continue; c1=c0+1e-6; }
    const col=shadeOf(inkOf(P,n,i,j),P,n);
    const pts=[];
    for(let s=0;s<=steps;s++){
      const t=c0+(c1-c0)*s/steps;
      pts.push(T(drape(S, V?u:t, V?t:u, E)));
    }
    sink(pts,col,w*P.k);
  }
}
function barPanel(S,sink,poly,E,X,Y,T,PS){
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
    barCell(S,sink,i,j,X,Y,E,T,PS[L]);
  }
}
/* ---- ribbons: bars laid across the band, stepping along its run ---- */
function barRibbons(S,sink,R,T,P){
  const D=dom(S), ov=S.over/100, W=S.rw/1000;
  for(const grp of [{list:R.V,sd:P.seed+7},{list:R.H,sd:P.seed+29}]){
    if(!grp.list.length) continue;
    const Q=Object.assign({},P,{seed:grp.sd});
    for(const r of grp.list){
      const sp=ribbonSpan(r,D,ov); if(sp[1]<=sp[0]) continue;
      const run=sp[1]-sp[0];
      const m=Math.max(1,Math.round(run/P.pitch)), step=run/m;
      for(let n=0;n<m;n++){
        let w=step*P.weight*(1+(h3(n,1,Q.seed)-0.5)*P.jit*0.45);
        w=Math.max(step*0.05,Math.min(w,step*0.96));
        const half=w/2;
        let t=sp[0]+(n+0.5)*step+(h3(n,0,Q.seed)-0.5)*step*P.jit*0.40;
        if(t-half<sp[0]) t=sp[0]+half;
        if(t+half>sp[1]) t=sp[1]-half;
        let L=W*P.len*(1+(h3(n,4,Q.seed)-0.5)*P.jit*0.50);
        L=Math.max(W*0.06,Math.min(L,W*0.99));
        let v0=-L/2, v1=L/2;
        if(P.round){ const s=Math.min(half,L/2*0.98); v0+=s; v1-=s; }
        if(v1-v0<1e-6){ if(!P.round) continue; v1=v0+1e-6; }
        const col=shadeOf(inkOf(Q,n,n,3),Q,n);
        const ox=r.px+r.dx*t, oy=r.py+r.dy*t;
        sink([T([ox+r.nx*v0,oy+r.ny*v0]),T([ox+r.nx*v1,oy+r.ny*v1])],col,w*P.k);
      }
    }
  }
}

export { barCell, barPanel, barRibbons };
