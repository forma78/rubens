/* Puts the generators where the site can serve them.
 *
 * Vercel's Root Directory for this project is `site`, so nothing above this
 * folder exists in the deployed build — but `generator/index.html` and its
 * engine live at the repository root, and the site is where people should be
 * able to open them. So they are copied in at build time (predev/prebuild)
 * rather than committed here twice: a second copy in git is a second copy
 * free to drift from the one the tests and the runner actually use.
 *
 * The layout is not arbitrary. index.html imports '../src/engine/index.js',
 * so the HTML has to sit one directory below the engine on the served side
 * too: /gen/index.html next to /src/engine/. Named `gen` rather than
 * `generator` so it cannot collide with the Next route of that name.
 *
 * Copies stay out of git — see site/.gitignore.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const site = path.resolve(here, '..');

const jobs = [
  ['generator/index.html', 'public/gen/index.html'],
  ['generator/index2.html', 'public/gen/index2.html'],
  ['generator/README.md', 'public/gen/README.md'],
  ['src/engine', 'public/src/engine'],
  ['src/engine2', 'public/src/engine2'],
  // index.html's one non-engine import; analyse.js itself only pulls from
  // ../engine/, so it is browser-safe. decode.js/cli.js (sharp, node:fs) are
  // deliberately not copied — nothing in the browser imports them.
  ['src/analyse/analyse.js', 'public/src/analyse/analyse.js'],
];

await rm(path.join(site, 'public/gen'), { recursive: true, force: true });
await rm(path.join(site, 'public/src'), { recursive: true, force: true });

for (const [from, to] of jobs) {
  const dest = path.join(site, to);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(path.join(repo, from), dest, { recursive: true });
}

/* One small real render per model, for the cards on /generator. Rendered by
   the engines themselves from committed state — a picture of what each model
   actually draws, not an artist's impression of it. Model 1's comes from the
   same fixture test/parity.test.js pins; model 2's from its own default S. */
const { svgOut: svg1 } = await import(path.join(repo, 'src/engine/index.js'));
const { svgOut: svg2, S: S2 } = await import(path.join(repo, 'src/engine2/index.js'));
const { readFile, writeFile } = await import('node:fs/promises');
// PNG, not SVG: model 1 lays thousands of individual strokes, and the same
// picture is 1.1MB of vector against ~100KB of raster at this size.
const { Resvg } = await import(path.join(repo, 'node_modules/@resvg/resvg-js/index.js'));
const toPng = (svg) => Buffer.from(new Resvg(svg).render().asPng());

const fixture = JSON.parse(await readFile(path.join(repo, 'test/fixtures/state.json'), 'utf8'));
await writeFile(
  path.join(site, 'public/gen/thumb-1.png'),
  toPng(svg1(fixture.S, fixture.refs, fixture.ovr, { base: 420, quality: 'preview' })),
);
await writeFile(
  path.join(site, 'public/gen/thumb-2.png'),
  toPng(svg2(S2, { base: 420, quality: 'preview' })),
);

console.log(`staged ${jobs.length} generator paths + 2 thumbnails into site/public`);
