/* ---- colour space ---- */
function s2lab(r,g,b){
  const f=c=>{c/=255; return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  const R=f(r),G=f(g),B=f(b);
  let X=(0.4124564*R+0.3575761*G+0.1804375*B)/0.95047;
  let Y=(0.2126729*R+0.7151522*G+0.0721750*B);
  let Z=(0.0193339*R+0.1191920*G+0.9503041*B)/1.08883;
  const h=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  X=h(X);Y=h(Y);Z=h(Z);
  return [116*Y-16,500*(X-Y),200*(Y-Z)];
}
function lab2s(L,a,b){
  const fy=(L+16)/116, fx=fy+a/500, fz=fy-b/200;
  const g=t=>{const t3=t*t*t; return t3>0.008856?t3:(t-16/116)/7.787;};
  const X=g(fx)*0.95047, Y=g(fy), Z=g(fz)*1.08883;
  let R= 3.2404542*X-1.5371385*Y-0.4985314*Z;
  let G=-0.9692660*X+1.8760108*Y+0.0415560*Z;
  let B= 0.0556434*X-0.2040259*Y+1.0572252*Z;
  const f=c=>{c=c<=0.0031308?12.92*c:1.055*Math.pow(Math.max(c,0),1/2.4)-0.055;
              return Math.max(0,Math.min(255,Math.round(c*255)));};
  return [f(R),f(G),f(B)];
}
const hex=c=>'#'+c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
const unhex=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];

/* ---- built-in references: k-means(8) palettes + 48-bin band profiles ---- */
const D36='0123456789abcdefghijklmnopqrstuvwxyz';
function unpack(str,K){
  const M=str.length/K, out=[];
  for(let b=0;b<M;b++){
    const row=[]; let s=0;
    for(let k=0;k<K;k++){ const v=D36.indexOf(str[b*K+k]); row.push(v); s+=v; }
    out.push(row.map(v=>s?v/s:1/K));
  }
  return out;
}
const PRESETS=[
 ['color_01','CD6877,BE823E,D58C9A,CA8A78,E4D6D1,BCA166,D9BD38,B79D38',
  '70l2500070m2500080l15000a0j14000c0h14000f0f13000g1e23000h1c22000i2a32000j4732000k6532000j8322100ha231100fd131101cg1321008i1322005k2422003l3423001k4533001i4633000e694200198b420015cd410012fc400021ia300020l9300030m7300040n6200050n5200060m5200060k5210060h7221151d82421519825424158266431362795111428b7100228d9000127eb000027ed000027ce000027af0000278h0000287i00003a5g00007b4d0000bb3a0000i826'],
 ['color_02','E4C6A3,DB90AD,E6D8CF,E7CB58,BB9481,C46D36,AD1619,AB4E76',
  'm0c01000p0901000q0702000q0702000p0802000n0a02000k0e02000f1h02000a3k0200057j030002dg020012ka020022n6030023n3040024j3070016f30a0017a31d0018631g0008333g0008136g000803ad000603fa000503k7100303n4110203p2220103o0340103l0560003g0690103a07d0004508i0004207m0005004p0005002r0006001s0006010r0006020q1006040n1016080i20160e0b20160j0530170m0240170l0060170g00a0170a00g0180500l01a0200n01d0000l01h0000h'],
 ['color_03','D88AA1,DE508F,DAC1B2,A51347,D21B41,343869,03116D,817893',
  '60s0000080r0000090p00000b0n00000d0l10000e1i20000e2e40000e4b60000d6970000b96800009d4910007f3910004i1920002j1840001i0780001f06c0001b04i0001803n0001502r0001311t0001211u0001212t1001113q3000113n6010114i9010114fb121124ab3310247a73102449b3003428g2003217l1003105p1003004s0003003s1002004q2003006m4003008g8003009bc0030096h0040062m0040041q0040020t0050010t0050000t0060000t0070000s0080000r00b0000o'],
 ['color_04','620650,29056F,B064B2,DE97D6,6F50A8,1C58CA,0436BE,020BA7',
  'fg121000lb120000q7110000s4210000t3210000t3300000r4410000n6410000j7621000e8731000b994200089b4200069c530004ad6300029e6300019f7400018f7400107f7500106f7500106f7500116f7600116e6700105e5800105d5910104d5a11104b4b21103a4c3220383c4330263b6430252a7540242987501317886012158a7012148b9011137bb011027be010016ag0100059j0100058l0100048m0100048m0100048m0000048m0000049m0100038n0101037n0201026n0303125m']
].map(p=>({name:p[0], src:null, thumb:null,
           pal:p[1].split(',').map(h=>unhex('#'+h)), prof:unpack(p[2],8)}));

/* ---- merge adjacent bands down to K (gradient complexity) ----
   Cached per REFS array, not globally: a plain object keyed by "idx:K" is
   wrong the moment a process ever sees more than one REFS array (or the
   same array spliced in place, which is exactly what removing a reference
   image does) — two different palettes at the same idx:K would collide and
   the second reband would silently get the first one's answer. A WeakMap
   keyed on the REFS array itself gives every array its own bucket, and lets
   a discarded REFS array (and its cache) be garbage collected once nothing
   else holds it — which matters once a long-lived process (the Phase 3
   runner) renders many states with different REFS arrays back to back. */
const RB=new WeakMap();
function reband(REFS,idx,K){
  let bucket=RB.get(REFS);
  if(!bucket){ bucket=new Map(); RB.set(REFS,bucket); }
  const key=idx+':'+K; if(bucket.has(key)) return bucket.get(key);
  const r=REFS[idx];
  let pal=r.pal.map(c=>c.slice()), prof=r.prof.map(x=>x.slice());
  while(pal.length>K){
    let bi=0,bd=1e18;
    for(let i=0;i<pal.length-1;i++){
      const A=s2lab(...pal[i]), B=s2lab(...pal[i+1]);
      const d=(A[0]-B[0])**2+(A[1]-B[1])**2+(A[2]-B[2])**2;
      if(d<bd){bd=d;bi=i;}
    }
    let wA=0,wB=0; for(const row of prof){ wA+=row[bi]; wB+=row[bi+1]; }
    const A=s2lab(...pal[bi]), B=s2lab(...pal[bi+1]), t=wB/(wA+wB||1);
    pal[bi]=lab2s(A[0]+(B[0]-A[0])*t, A[1]+(B[1]-A[1])*t, A[2]+(B[2]-A[2])*t);
    pal.splice(bi+1,1);
    for(const row of prof){ row[bi]+=row[bi+1]; row.splice(bi+1,1); }
  }
  const result={pal,prof};
  bucket.set(key,result);
  return result;
}
/* call whenever a REFS array is structurally mutated in place (an upload
   appended, a reference removed) — removing a reference splices the array,
   which shifts every index after it, so any cached reband for this array is
   no longer trustworthy and the whole bucket is dropped, not just one key */
function invalidateReband(REFS){ RB.delete(REFS); }

export { s2lab, lab2s, hex, unhex, unpack, PRESETS, reband, invalidateReband };
