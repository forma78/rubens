/* Regenerates the two card renders on the site's /generator page.
 *
 * Run by hand — `npm run thumbs` — not by the site's build. The site builds
 * with only site/node_modules present (Vercel's Root Directory is `site`),
 * and resvg lives at the repository root. The outputs are committed, which
 * also makes them reviewable: a change to what a model draws by default
 * shows up as an image diff in the pull request rather than silently on the
 * next deploy.
 *
 * Model 1 renders from the same fixture test/parity.test.js pins; model 2
 * from its own default state. Both are what the engines really draw.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { svgOut as svg1 } from '../src/engine/index.js';
import { svgOut as svg2, S as S2 } from '../src/engine2/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => path.join(repo, 'site/public', name);
const png = (svg) => Buffer.from(new Resvg(svg).render().asPng());

const fixture = JSON.parse(await readFile(path.join(repo, 'test/fixtures/state.json'), 'utf8'));

await writeFile(out('model-1.png'), png(svg1(fixture.S, fixture.refs, fixture.ovr, { base: 420, quality: 'preview' })));
await writeFile(out('model-2.png'), png(svg2(S2, { base: 420, quality: 'preview' })));

console.log('wrote site/public/model-1.png and model-2.png');
