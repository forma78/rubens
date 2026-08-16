import { writeFile } from 'node:fs/promises';
import { analyseFile } from './decode.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = args._;
  if (!paths.length) {
    console.error('usage: npm run analyse -- <image...> [--out out.json]');
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const path of paths) results.push(await analyseFile(path));
  const output = results.length === 1 ? results[0] : results;
  const json = JSON.stringify(output, null, 2);

  if (args.out) await writeFile(args.out, json + '\n');
  else console.log(json);
}

main();
