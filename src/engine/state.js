const S={
  ratio:3, pattern:'grid', cols:14, rows:30, weave:5.1, edge:7.1, dot:40,
  nv:2, nh:3, rw:34, angle:79, scatter:13, over:0,
  squeeze:15, swell:64, round:67, drape:45, hand:26,
  thread:'#B0822F', cell:'#FFFFFF', ribbon:'#1877E0', bg:'#FFFFFF',
  seed:11,
  /* dye — shared brush */
  paint:1, pitch:10, ilock:42, grain:13, load:44, cseed:5, wover:1,
  /* five stacked layers; index 4 paints the ribbons */
  L:[{ref:0,bands:3,dir:'h',span:'auto',cover:25,on:1},
     {ref:1,bands:3,dir:'h',span:'auto',cover:50,on:1},
     {ref:2,bands:3,dir:'h',span:'auto',cover:75,on:1},
     {ref:3,bands:4,dir:'v',span:'auto',cover:100,on:1},
     {ref:3,bands:4,dir:'v',span:'auto',cover:100,on:1}]
};
const RATIOS=[[1,1,'1:1'],[4,5,'4:5'],[3,4,'3:4'],[2,3,'2:3'],[1,Math.SQRT2,'1:\u221A2'],[9,16,'9:16']];
/* S threaded through as an explicit argument — the browser and the CLI each
   own their own state object, so dom() cannot read a shared global. */
function dom(S){ const r=RATIOS[S.ratio], m=Math.max(r[0],r[1]); return {w:r[0]/m,h:r[1]/m,label:r[2]}; }

export { S, RATIOS, dom };
