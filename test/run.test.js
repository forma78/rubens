import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { run } from '../src/syndicate/run.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const briefPath = path.join(root, 'test/fixtures/brief.json');
const runScript = path.join(root, 'src/syndicate/run.js');

test('run({ dry: true }) completes a full shift with no model calls, writing the documented layout', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    const result = await run({ briefPath, dry: true, cwd: root, runsDir });

    assert.equal(result.dry, true);
    assert.equal(result.roundsRun, 1); // the fixture brief sets rounds:1
    assert.equal(result.costSpent, 0, 'dry run must never spend anything');
    assert.ok(result.finalIds.length > 0);

    const runDir = path.join(runsDir, 'test-brief');
    for (const f of ['brief.json', 'base-state.json', 'palette.json', 'FINAL.md']) {
      await assert.doesNotReject(readFile(path.join(runDir, f)), `${f} should exist`);
    }

    const variantsDir = path.join(runDir, 'round-1', 'variants');
    const files = await readdir(variantsDir);
    const pngs = files.filter(f => f.endsWith('.png'));
    const jsons = files.filter(f => f.endsWith('.json'));
    assert.equal(pngs.length, 4); // fixture brief sets variantsPerRound:4
    assert.equal(jsons.length, 4);

    const baseState = JSON.parse(await readFile(path.join(runDir, 'base-state.json'), 'utf8'));
    assert.equal(baseState.S.ratio, 3); // fixture brief sets ratio:3
    assert.ok(baseState.S.L.every(l => l.ref === 0), 'every layer should be locked to the one analysed reference');
    assert.equal(baseState.refs.length, 1);

    const finalMd = await readFile(path.join(runDir, 'FINAL.md'), 'utf8');
    assert.match(finalMd, /# test-brief/);
    assert.match(finalMd, /Spend: \$0\.00/);
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('run() throws a clear error for a real (non-dry) shift with no API keys configured', async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), 'rubens-run-'));
  try {
    await assert.rejects(
      () => run({ briefPath, dry: false, cwd: root, runsDir }),
      /ANTHROPIC_API_KEY|XAI_API_KEY/
    );
  } finally {
    await rm(runsDir, { recursive: true, force: true });
  }
});

test('the real CLI (node src/syndicate/run.js --dry) runs end to end', async () => {
  // the CLI always writes under <cwd>/runs (no --runsDir flag), so this
  // necessarily touches the real repo's runs/test-brief/ — clean it up after
  const writtenDir = path.join(root, 'runs', 'test-brief');
  try {
    const out = execFileSync(process.execPath, [runScript, '--brief', briefPath, '--dry'], { cwd: root, encoding: 'utf8' });
    assert.match(out, /dry run complete/);
    assert.match(out, /FINAL\.md/);
  } finally {
    await rm(writtenDir, { recursive: true, force: true });
  }
});
