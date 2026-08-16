import { readFile, writeFile } from 'node:fs/promises';
import { S as DEFAULT_STATE, PRESETS } from '../engine/index.js';
import { renderToPng } from './render-core.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.state || !args.out) {
    console.error('usage: npm run render -- --state <path.json> --out <path.png> [--height <px>] [--quality full|preview]');
    process.exitCode = 1;
    return;
  }

  const raw = JSON.parse(await readFile(args.state, 'utf8'));
  const S = raw.S ?? DEFAULT_STATE;
  const ovr = raw.ovr ?? [{}, {}, {}, {}, {}];
  const refs = raw.refs ?? PRESETS;
  const quality = args.quality ?? 'preview';

  const png = await renderToPng(S, refs, ovr, { quality, height: args.height });
  await writeFile(args.out, png);
}

main();
