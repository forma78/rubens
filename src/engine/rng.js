const mk=s=>{let x=s>>>0||1;return()=>{x^=x<<13;x>>>=0;x^=x>>17;x^=x<<5;x>>>=0;return x/4294967296;};};

/* ---- seeded value noise ---- */
function h3(i,j,s){
  let x=(Math.imul(i,374761393)+Math.imul(j,668265263)+Math.imul(s,362437))>>>0;
  x=(x^(x>>>13))>>>0; x=Math.imul(x,1274126177)>>>0; x=(x^(x>>>16))>>>0;
  return x/4294967296;
}
function vn(u,v,s){
  const i0=Math.floor(u), j0=Math.floor(v), fu=u-i0, fv=v-j0;
  const su=fu*fu*(3-2*fu), sv=fv*fv*(3-2*fv);
  const a=h3(i0,j0,s), b=h3(i0+1,j0,s), c=h3(i0,j0+1,s), d=h3(i0+1,j0+1,s);
  return (a+(b-a)*su)*(1-sv)+(c+(d-c)*su)*sv;
}

export { mk, h3, vn };
