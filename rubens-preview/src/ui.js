// Shared look of the three pages. The sliders' orange fill, as on the
// MELNICOMM pendant and the Braun references (the owner, 2026-09-28): from
// the slider's origin — 0 when its range crosses zero, else its minimum — to
// the handle. style.css draws it from --f0 and --f1 (0…1). A frame loop,
// because the pages also move handles from code (the jog back to idle, the
// arm handles following the servos).

const seen = new WeakMap();
function paint() {
  for (const el of document.querySelectorAll('input[type=range]')) {
    const v = +el.value, lo = +el.min || 0, hi = +el.max || 100;
    if (seen.get(el) === v) continue;
    seen.set(el, v);
    const o = lo < 0 && hi > 0 ? 0 : lo, f = x => (x - lo) / (hi - lo || 1);
    el.style.setProperty('--f0', Math.min(f(o), f(v)));
    el.style.setProperty('--f1', Math.max(f(o), f(v)));
  }
  requestAnimationFrame(paint);
}
requestAnimationFrame(paint);
