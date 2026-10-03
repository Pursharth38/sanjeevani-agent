// Replay cache and fixtures.
//   cache/<name>.json     written by each module's own CLI after a real call (committed)
//   fixtures/<name>.json  fake { events, statePatch, artifacts } used until the real cache exists
// Integrations may import these helpers; nothing here makes a network call.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = join(ROOT, 'cache');
const FIXTURE_DIR = join(ROOT, 'fixtures');

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

export const cachePath = (name) => join(CACHE_DIR, `${name}.json`);
export const fixturePath = (name) => join(FIXTURE_DIR, `${name}.json`);

export function readCache(name) {
  return readJson(cachePath(name));
}

export function writeCache(name, data) {
  const file = cachePath(name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ saved_at: new Date().toISOString(), ...data }, null, 2) + '\n');
  return file;
}

export function readFixture(name) {
  return readJson(fixturePath(name));
}

// Key names whose values never reach the console unmasked.
const SECRET_KEY = /^(?!.*(_type|expires)).*(secret|token|authori[sz]ation|api[_-]?key|password|passwd|cookie|signature)/i;

export function maskSecrets(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskSecrets(v, k);
    return out;
  }
  if (typeof value === 'string' && SECRET_KEY.test(key) && !value.startsWith('••••')) {
    // Secrets and passwords are fully hidden; tokens keep their last 4 so runs can be told apart.
    if (/secret|password|passwd/i.test(key)) return '••••••••';
    return value.length > 8 ? `••••${value.slice(-4)}` : '••••';
  }
  return value;
}
