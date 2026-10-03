// Delhivery for the route_delivery step: real pincode check → serviceability → route.
//
//   node server/integrations/delhivery.js --live     one real run; writes cache/delhivery.json
//   node server/integrations/delhivery.js --replay   print the cached run
//
// 1. Pincode check, always real: India Post's public pincode API confirms the pincode exists
//    and where it is (LIVE). An unknown pincode fails the step.
// 2. Serviceability: with DELHIVERY_TOKEN, Delhivery's pin-codes API (LIVE). Without a token
//    (the API returns 401 "Login or API Key Required"), the check is SIMULATED, in our own
//    wording, never shaped like a Delhivery response.
// 3. Route: serviceable for prepaid → Delhivery; otherwise → local partner.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readCache, writeCache, maskSecrets } from '../cache.js';

const CACHE = 'delhivery';
const INDIA_POST = 'https://api.postalpincode.in/pincode';
const HTTP_TIMEOUT_MS = 15000;
const REPLAY_MAX_GAP_MS = 2500;
const SIMULATED_MS = 1200;

const base = () => (process.env.DELHIVERY_BASE || 'https://track.delhivery.com').replace(/\/$/, '');

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('aborted')); }, { once: true });
});

async function getJson(url, { headers = {}, signal } = {}) {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)].filter(Boolean)) });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, json };
}

/* ---------------- Live run ---------------- */
async function live(ctx, emit) {
  const { signal } = ctx;
  const maa = ctx.state.members.find((m) => m.id === 'maa');
  const pincode = String((ctx.step && ctx.step.pincode) || maa.pincode);

  // 1. Pincode check (India Post)
  const postUrl = `${INDIA_POST}/${pincode}`;
  emit({ source: 'agent', label: 'LIVE', type: 'request', title: `pincode lookup · India Post · ${pincode}`, json: { method: 'GET', url: postUrl } });
  const post = await getJson(postUrl, { signal });
  const entry = Array.isArray(post.json) ? post.json[0] : null;
  const offices = (entry && entry.PostOffice) || [];
  if (!post.ok || !entry || entry.Status !== 'Success' || !offices.length) {
    emit({ source: 'agent', label: 'LIVE', type: 'response', title: `pincode ${pincode} not found · ${post.status}`, json: post.json });
    return { events: [], statePatch: {}, artifacts: {}, result: { serviceable: false, route: null, reason: 'unknown pincode' } };
  }
  const district = offices[0].District;
  const stateName = offices[0].State;
  emit({ source: 'agent', label: 'LIVE', type: 'response', title: `${pincode} · ${district}, ${stateName} · ${offices.length} post offices`,
    json: { Status: entry.Status, Message: entry.Message, PostOffice: offices.slice(0, 3).map(({ Name, BranchType, District, State, Pincode }) => ({ Name, BranchType, District, State, Pincode })) } });

  // 2. Serviceability (Delhivery)
  let serviceable;
  let verifiedBy;
  const token = process.env.DELHIVERY_TOKEN;
  if (token) {
    const url = `${base()}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`;
    emit({ type: 'request', title: `delhivery.pincode ${pincode}`, json: { method: 'GET', url, headers: { Authorization: `Token ${token}` } } });
    const r = await getJson(url, { headers: { Authorization: `Token ${token}` }, signal });
    emit({ type: 'response', title: `serviceability · ${r.status}`, json: r.json });
    if (!r.ok) throw new Error(`delhivery pin-codes failed: HTTP ${r.status}`);
    const codes = (r.json.delivery_codes || []).map((c) => c.postal_code || {});
    const pc = codes[0];
    serviceable = Boolean(pc && pc.pre_paid === 'Y');
    verifiedBy = 'delhivery';
    emit({ type: 'info', title: pc ? `${pincode} ${serviceable ? 'serviceable' : 'not serviceable'} for prepaid · ${pc.district || district}` : `${pincode} not in Delhivery's network` });
  } else {
    emit({ label: 'SIMULATED', type: 'info', title: `delhivery serviceability · ${pincode} · simulated`, body: 'No Delhivery API token; the pincode above is real, this check is simulated' });
    await sleep(SIMULATED_MS, signal);
    serviceable = true;
    verifiedBy = 'simulated';
    emit({ label: 'SIMULATED', type: 'response', title: `${district} serviceable for prepaid · simulated`, json: { simulated: true, pincode, district, state: stateName, prepaid: true } });
  }

  // 3. Route
  const route = serviceable ? 'delhivery' : 'local_partner';
  emit({ source: 'agent', label: verifiedBy === 'delhivery' ? 'LIVE' : 'SIMULATED', type: 'info',
    title: `route = ${route === 'delhivery' ? 'Delhivery Express' : 'local partner'}`,
    body: serviceable ? `Apollo Pharmacy, Lucknow → Maa · ${district}` : 'Delhivery does not cover this pincode for prepaid; using a local partner' });

  return { events: [], statePatch: {}, artifacts: {}, result: { serviceable, route, pincode, district, verified_by: verifiedBy } };
}

/* ---------------- run(ctx) ---------------- */
export async function run(ctx) {
  if (ctx.mode === 'replay') return replay(ctx);
  const recorded = [];
  const t0 = Date.now();
  const emit = (e) => {
    const evt = { source: 'delhivery', label: 'LIVE', ...e };
    ctx.emit(evt);
    recorded.push({ dt_ms: Date.now() - t0, ...evt, json: evt.json ? maskSecrets(evt.json) : undefined });
  };
  const r = await live(ctx, emit);
  if (r.result.route) {
    const file = writeCache(CACHE, { recorded_at: new Date().toISOString(), serviceability: r.result.verified_by, events: recorded, result: r.result });
    console.log(`  · delhivery: saved ${file}`);
  }
  return r;
}

async function replay(ctx) {
  const cached = readCache(CACHE);
  if (!cached) throw new Error('no cache/delhivery.json yet (run `node server/integrations/delhivery.js --live`)');
  let prev = 0;
  for (const e of cached.events) {
    const { dt_ms: dt = prev, ...evt } = e;
    await sleep(Math.min(Math.max(dt - prev, 0), REPLAY_MAX_GAP_MS), ctx.signal);
    prev = dt;
    ctx.emit({ ...evt, recorded_at: cached.recorded_at });
  }
  return { events: [], statePatch: {}, artifacts: {}, result: cached.result };
}

/* ---------------- CLI ---------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* works without .env */ }
  const mode = process.argv.includes('--live') ? 'live' : 'replay';
  const state = JSON.parse(readFileSync(join(ROOT, 'data', 'state.initial.json'), 'utf8'));
  const print = (e) => {
    console.log(`${e.label.padEnd(9)} ${e.type.padEnd(8)} ${e.title}${e.body ? ` — ${e.body}` : ''}`);
    if (e.json && process.argv.includes('--json')) console.log(JSON.stringify(maskSecrets(e.json), null, 2));
  };
  const pin = state.members.find((m) => m.id === 'maa').pincode;
  console.log(`delhivery · ${mode}${mode === 'live' ? ` · serviceability: ${process.env.DELHIVERY_TOKEN ? `Delhivery API (${base()})` : 'simulated (no DELHIVERY_TOKEN)'}` : ''}\n`);
  run({ state, mode, phase: 'execute', step: { step: 'route_delivery', pincode: pin }, emit: print, signal: AbortSignal.timeout(60000) })
    .then((r) => { console.log(`\nresult: ${JSON.stringify(r.result)}`); process.exit(r.result.route ? 0 : 2); })
    .catch((e) => { console.error(`\nfailed: ${e.message}`); process.exit(1); });
}
