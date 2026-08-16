import { mk } from '../engine/rng.js';
import { s2lab, lab2s } from '../engine/colour.js';

const K=8, MAX=340, M=48, KMEANS_SEED=20260815;

/* the size analyse() resizes to before reading pixels: never upscale, cap
   the long side at MAX=340. Shared so the browser's canvas and Node's sharp
   target the exact same w×h. */
function analyseSize(width,height){
  const sc=Math.min(MAX/width, MAX/height, 1);
  return {w:Math.max(2,Math.round(width*sc)), h:Math.max(2,Math.round(height*sc))};
}

/* ---- analyse a decoded image: palette + band profile + stroke axis ----
   Ported from generator/index.html's analyse(img), unchanged from the point
   it has an RGBA buffer at w×h — only the decode step differs (a canvas
   ImageData in the browser, sharp().raw() with an alpha channel forced on
   in Node), so both surfaces feed this same function the same shape of
   data. `d` is RGBA, four bytes per pixel, exactly like ImageData.data. */
function analysePixels(d,w,h){
  const lab=new Float32Array(w*h*3), ok=new Uint8Array(w*h);
  for(let i=0;i<w*h;i++){
    const L=s2lab(d[i*4],d[i*4+1],d[i*4+2]);
    lab[i*3]=L[0]; lab[i*3+1]=L[1]; lab[i*3+2]=L[2];
    const C=Math.hypot(L[1],L[2]);
    ok[i]=(!(L[0]>92&&C<9) && L[0]>6)?1:0;
  }
  /* stroke axis: paint varies fast across the strokes, slowly along them */
  let gh=0,nh=0,gv=0,nv=0;
  const dif=(a,b)=>Math.abs(lab[a*3]-lab[b*3])+Math.abs(lab[a*3+1]-lab[b*3+1])+Math.abs(lab[a*3+2]-lab[b*3+2]);
  for(let y=0;y<h;y++) for(let x=1;x<w;x++){ const a=y*w+x, b=a-1; if(ok[a]&&ok[b]){gh+=dif(a,b);nh++;} }
  for(let y=1;y<h;y++) for(let x=0;x<w;x++){ const a=y*w+x, b=a-w; if(ok[a]&&ok[b]){gv+=dif(a,b);nv++;} }
  const vertical=(gh/(nh||1))>=(gv/(nv||1));

  const idx=[]; for(let i=0;i<w*h;i++) if(ok[i]) idx.push(i);
  if(idx.length<64) return {pal:[[128,128,128]],prof:[[1]],vertical};

  /* k-means++ in Lab, seeded */
  const rnd=mk(KMEANS_SEED), fit=[];
  const stride=Math.max(1,Math.floor(idx.length/12000));
  for(let i=0;i<idx.length;i+=stride) fit.push(idx[i]);
  const cen=[], p0=fit[(rnd()*fit.length)|0];
  cen.push([lab[p0*3],lab[p0*3+1],lab[p0*3+2]]);
  const dd=new Float64Array(fit.length).fill(1e18);
  for(let k=1;k<K;k++){
    let sum=0;
    for(let i=0;i<fit.length;i++){
      const p=fit[i], c0=cen[k-1];
      const e=(lab[p*3]-c0[0])**2+(lab[p*3+1]-c0[1])**2+(lab[p*3+2]-c0[2])**2;
      if(e<dd[i]) dd[i]=e;
      sum+=dd[i];
    }
    let r=rnd()*sum, pick=fit[fit.length-1];
    for(let i=0;i<fit.length;i++){ r-=dd[i]; if(r<=0){pick=fit[i];break;} }
    cen.push([lab[pick*3],lab[pick*3+1],lab[pick*3+2]]);
  }
  for(let it=0;it<20;it++){
    const acc=cen.map(()=>[0,0,0,0]);
    for(const p of fit){
      let bk=0,bd=1e18;
      for(let k=0;k<K;k++){
        const c0=cen[k];
        const e=(lab[p*3]-c0[0])**2+(lab[p*3+1]-c0[1])**2+(lab[p*3+2]-c0[2])**2;
        if(e<bd){bd=e;bk=k;}
      }
      const a=acc[bk]; a[0]+=lab[p*3]; a[1]+=lab[p*3+1]; a[2]+=lab[p*3+2]; a[3]++;
    }
    for(let k=0;k<K;k++) if(acc[k][3]) cen[k]=[acc[k][0]/acc[k][3],acc[k][1]/acc[k][3],acc[k][2]/acc[k][3]];
  }

  /* band profile along the stroke axis, over the painted bbox */
  let lo=1e9,hi=-1e9;
  for(const p of idx){ const a=vertical?(p/w)|0:p%w; if(a<lo)lo=a; if(a>hi)hi=a; }
  const prof=[]; for(let b=0;b<M;b++) prof.push(new Array(K).fill(0));
  for(const p of idx){
    let bk=0,bd=1e18;
    for(let k=0;k<K;k++){
      const c0=cen[k];
      const e=(lab[p*3]-c0[0])**2+(lab[p*3+1]-c0[1])**2+(lab[p*3+2]-c0[2])**2;
      if(e<bd){bd=e;bk=k;}
    }
    const a=vertical?(p/w)|0:p%w;
    let b=Math.floor((a-lo)/Math.max(1,hi-lo)*M); b=b<0?0:b>M-1?M-1:b;
    prof[b][bk]++;
  }
  const ker=[1,2,3,2,1], sm=[];
  for(let b=0;b<M;b++){
    const row=new Array(K).fill(0); let s=0;
    for(let o=-2;o<=2;o++){ const q=Math.min(M-1,Math.max(0,b+o)), wgt=ker[o+2];
      for(let k=0;k<K;k++) row[k]+=prof[q][k]*wgt; }
    for(let k=0;k<K;k++) s+=row[k];
    sm.push(row.map(v=>s?v/s:1/K));
  }
  /* order the bands the way the eye reads them: by their place along the axis */
  const ord=[...Array(K).keys()].map(k=>{
    let n=0,d0=0; for(let b=0;b<M;b++){ n+=sm[b][k]*b; d0+=sm[b][k]; }
    return {k, m:d0?n/d0:0};
  }).sort((a,b)=>a.m-b.m).map(o=>o.k);
  return {pal:ord.map(k=>lab2s(...cen[k])), prof:sm.map(r=>ord.map(k=>r[k])), vertical};
}

export { K, MAX, M, analyseSize, analysePixels };
