import { readFile } from 'node:fs/promises';

/* No dotenv dependency — four is already the count CLAUDE.md holds this
   project to, and a .env parser is a dozen lines. */
async function loadEnv(path = '.env') {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export { loadEnv };
