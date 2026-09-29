// Library page: the drawings saved with 💾 SAVE on the Create tab (rubens.py
// keeps them in library/ on this Mac, not in git), newest first. A click
// opens a drawing on the Create tab (index.html?open=<file>), from where it
// goes to the Job tab and the machine; the red × moves it to
// library/.deleted/ after asking (the owner, 2026-09-30).

import { FORMATS } from './config.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const url = (file, ext) => 'library/' + encodeURIComponent(file) + ext;

async function load() {
  const grid = $('#grid');
  let list;
  try {
    const r = await fetch('/library', { cache: 'no-store' });
    list = r.ok ? await r.json() : null;
  } catch { list = null; }
  if (!list) { grid.innerHTML = '<p class="none">No server: start rubens.py.</p>'; $('#count').textContent = ''; return; }
  $('#count').textContent = `${list.length} drawing${list.length === 1 ? '' : 's'}`;
  if (!list.length) { grid.innerHTML = '<p class="none">Nothing saved yet: 💾 SAVE on the Create tab.</p>'; return; }
  grid.innerHTML = list.map(d => {
    const fmt = FORMATS[d.format]?.label || '';
    const strokes = d.strokes == null ? '' : `${d.strokes} stroke${d.strokes === 1 ? '' : 's'}`;
    return `<article class="card" data-file="${esc(d.file)}" title="Open on the Create tab">
      <div class="thumb">${d.png ? `<img src="${url(d.file, '.png')}" alt="" loading="lazy">` : ''}</div>
      <div class="meta"><span class="name">${esc(d.name)}</span><span class="sub">${esc([fmt, strokes].filter(Boolean).join(' · '))}</span></div>
      <button class="del" title="Delete" aria-label="Delete ${esc(d.name)}">×</button>
    </article>`;
  }).join('');
}

$('#grid').addEventListener('click', async e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const file = card.dataset.file, name = card.querySelector('.name').textContent;
  if (e.target.closest('.del')) {
    if (!confirm(`Delete «${name}» from the Library?\n\nIt goes to library/.deleted/ on this Mac.`)) return;
    const r = await fetch(url(file, ''), { method: 'DELETE' }).catch(() => null);
    if (!r || !r.ok) alert(r ? await r.text() : 'No server: start rubens.py.');
    return load();
  }
  location.href = 'index.html?open=' + encodeURIComponent(file);
});

addEventListener('focus', load);   // saved on the Create tab meanwhile
load();
