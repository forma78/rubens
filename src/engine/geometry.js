import { mk } from './rng.js';
import { dom } from './state.js';

/* ---------- ribbons ---------- */
function ribbons(S){
  const D=dom(S), rnd=mk((S.seed*2654435761)>>>0), tilt=(90-S.angle)*Math.PI/180, sc=S.scatter/100, V=[],H=[];
  for(let i=0;i<S.nv;i++){
    const off=((i+1)/(S.nv+1)+(rnd()-0.5)*sc*0.20)*D.w, mid=D.h/2;
    const a=tilt*(1+(rnd()-0.5)*sc)*(rnd()<0.5?-1:1), dx=Math.sin(a), dy=Math.cos(a);
    V.push({dx,dy,nx:dy,ny:-dx,c:dy*off-dx*mid,px:off,py:mid});
  }
  for(let j=0;j<S.nh;j++){
    const off=((j+1)/(S.nh+1)+(rnd()-0.5)*sc*0.15)*D.h, mid=D.w/2;
    const a=tilt*(1+(rnd()-0.5)*sc)*(rnd()<0.5?-1:1), dx=Math.cos(a), dy=Math.sin(a);
    H.push({dx,dy,nx:-dy,ny:dx,c:-dy*mid+dx*off,px:mid,py:off});
  }
  return {V,H,all:V.concat(H)};
}

/* ---------- two independent thread layers, laid by hand ---------- */
function layers(S){
  const D=dom(S), rnd=mk((S.seed*40503+9176)>>>0), h=S.hand/100, xs=[], ys=[];
  const cw=D.w/S.cols, ch=D.h/S.rows;
  for(let i=1;i<S.cols;i++) xs.push(i*cw+(rnd()-0.5)*h*cw*0.6);
  for(let j=1;j<S.rows;j++) ys.push(j*ch+(rnd()-0.5)*h*ch*0.6);
  return {xs,ys,cw,ch};
}
/* full cell lattice, borders included — the brown cells the dye must stay inside */
function lattice(S,L){
  const D=dom(S);
  return {X:[0].concat(L.xs,[D.w]), Y:[0].concat(L.ys,[D.h])};
}

/* ---------- convex clipping, remembering where each edge came from ---------- */
const FRAME=0, BAND=1;
function clipHalf(poly,L,keepPos){
  if(!poly.length) return poly;
  const sd=p=>(L.nx*p.x+L.ny*p.y-L.c)*(keepPos?1:-1), out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length], da=sd(a), db=sd(b);
    if(da>=0) out.push(a);
    if((da>=0)!==(db>=0)){
      const t=da/(da-db);
      out.push({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, tag: da>=0?BAND:a.tag});
    }
  }
  return out;
}
function panels(S,R){
  const D=dom(S), out=[];
  for(let i=0;i<=R.V.length;i++) for(let j=0;j<=R.H.length;j++){
    let p=[{x:0,y:0,tag:FRAME},{x:D.w,y:0,tag:FRAME},{x:D.w,y:D.h,tag:FRAME},{x:0,y:D.h,tag:FRAME}];
    for(let k=0;k<R.V.length;k++) p=clipHalf(p,R.V[k],k<i);
    for(let k=0;k<R.H.length;k++) p=clipHalf(p,R.H[k],k<j);
    p=p.filter((v,k)=>{const w=p[(k+1)%p.length];return Math.hypot(v.x-w.x,v.y-w.y)>1e-6;});
    if(p.length>=3) out.push(p);
  }
  return out;
}

/* ---------- one panel: edges, boundary offsets, interior drape field ---------- */
function edges(S,poly){
  const sq=S.squeeze/100*0.09, sw=S.swell/100*0.055;
  let cx=0,cy=0; for(const v of poly){cx+=v.x;cy+=v.y;} cx/=poly.length; cy/=poly.length;
  const E=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length];
    let nx=b.y-a.y, ny=-(b.x-a.x); const L=Math.hypot(nx,ny)||1; nx/=L; ny/=L;
    if(nx*(cx-a.x)+ny*(cy-a.y)<0){nx=-nx;ny=-ny;}                 // inward
    const band=a.tag===BAND;
    E.push({ax:a.x,ay:a.y,nx,ny,dx:(b.x-a.x)/L,dy:(b.y-a.y)/L,len:L,band,
            base: band ? sq : -sw*0.35, bow: band ? 0 : -sw});
  }
  E.cx=cx; E.cy=cy; E.sq=sq; E.sw=sw;
  return E;
}
function drape(S,x,y,E){
  if(S.drape<=0) return [x,y];
  const reach=0.015+0.26*(S.drape/100);
  let X=0,Y=0;
  for(const e of E){
    const px=x-e.ax, py=y-e.ay, u=px*e.nx+py*e.ny;
    if(u<-1e-4||u>reach*3) continue;
    let t=(px*e.dx+py*e.dy)/e.len; t=t<0?0:t>1?1:t;
    const d=e.base+e.bow*Math.sin(Math.PI*t);
    const w=Math.exp(-(u/reach)*(u/reach));
    X+=e.nx*d*w; Y+=e.ny*d*w;
  }
  return [x+X,y+Y];
}

/* ---------- panel outline ---------- */
function outline(S,poly,E){
  const rr=S.round/100;
  const lines=E.map(e=>({nx:e.nx,ny:e.ny,c:e.nx*(e.ax+e.nx*e.base)+e.ny*(e.ay+e.ny*e.base),band:e.band}));
  const V=[];
  for(let i=0;i<lines.length;i++){
    const p=lines[(i-1+lines.length)%lines.length], q=lines[i], det=p.nx*q.ny-p.ny*q.nx;
    if(Math.abs(det)<1e-9){ V.push({x:poly[i].x,y:poly[i].y,band:false,frame:!q.band}); continue; }
    V.push({ x:(p.c*q.ny-q.c*p.ny)/det, y:(p.nx*q.c-q.nx*p.c)/det,
             band:(p.band)!==(q.band), frame:!q.band });
  }
  const pts=[],wt=[];
  for(let i=0;i<V.length;i++){
    const a=V[i], b=V[(i+1)%V.length], e=E[i];
    const len=Math.hypot(b.x-a.x,b.y-a.y), n=Math.max(4,Math.round(len*160));
    for(let s=0;s<n;s++){
      const t=s/n, k=-e.bow*Math.sin(Math.PI*t);
      pts.push([a.x+(b.x-a.x)*t-e.nx*k, a.y+(b.y-a.y)*t-e.ny*k]);
      wt.push((a.band&&t<0.5)||(b.band&&t>=0.5) ? Math.exp(-Math.pow(Math.min(t,1-t)*len/(0.05+0.14*rr),2)) : 0);
    }
  }
  const N=pts.length, it=Math.round(6+70*rr);
  for(let k=0;k<it;k++){
    const src=pts.map(p=>p.slice());
    for(let i=0;i<N;i++){
      const w=wt[i]*0.5; if(w<1e-4) continue;
      const a=src[(i-1+N)%N], b=src[(i+1)%N];
      pts[i][0]+=w*(a[0]+b[0]-2*src[i][0]); pts[i][1]+=w*(a[1]+b[1]-2*src[i][1]);
    }
  }
  return pts;
}
function bbox(poly){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const v of poly){ if(v.x<x0)x0=v.x; if(v.x>x1)x1=v.x; if(v.y<y0)y0=v.y; if(v.y>y1)y1=v.y; }
  return {x0,y0,x1,y1};
}

export { ribbons, layers, lattice, clipHalf, panels, edges, drape, outline, bbox };
