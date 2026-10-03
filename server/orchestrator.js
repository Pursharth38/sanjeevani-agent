// Sanjeevani demo orchestrator: an agent runner.
//
//   pre-roll (records, away mode) → trigger → hf_reason plans → each plan step runs its module(s)
//   in order → simulated delivery → summary
//
// Every step resolves only when it has really finished (call ended, webhook received, HOLD window
// over). The orchestrator enforces the caregiver's limits on every step, whatever the model wrote.
// The dashboard is not synced. state.js holds internal story state that modules read via ctx.state.
//
//   MODE=replay npm run demo     modules replay their cache/ (default; the offline backup take)
//   MODE=live npm run demo       modules call the real APIs
//   PREROLL=0                    start at the trigger
//   HOLD_WINDOW_S=10             the 10-minute HOLD window, compressed for the demo
//
// HTTP (bound to 127.0.0.1; through ngrok only /webhooks/* is reachable)
//   /console/  /onboarding/  /dashboard/ (static, unsynced)  /data/docs/*  /data/audio/*
//   GET  /events             SSE for the agent console   (hello, phase, evt, control)
//   GET  /status             run status as JSON;  GET /state.json  internal story state (debug)
//   POST /next  /reset  /pause
//   ANY  /webhooks/<module>  → that module's onWebhook({ method, headers, rawBody, body, query, url })
// Keys (in this terminal): Space start · R reset · P pause · Q quit
//
// Module contract
//   run(ctx), ctx = { state, mode: "live" | "replay", phase, step, emit, signal }
//     step    the plan step with its arguments (null for pre-roll and hf_reason)
//     emit    emit(event) streams a console event now (transcript lines, countdown, awaiting webhook)
//     signal  AbortSignal: fires on timeout or reset
//   returns { events, statePatch, artifacts, result }
//     result  notify_caregiver { hold, reply } · book_appointment { confirmed, slot }
//             create_order { status: PROCESSED | SIMULATED, order_id } · route_delivery { serviceable, route }
//             hf_reason { decision, plan, model }
// Fallback per call: live → replay (module's cache/) → fixtures/<module>.<step>.json → fixtures/<module>.json
// → a visible "missing" row. Fixture events carry `fixture: true` and must never appear in a recording.
import http from 'node:http';
import readline from 'node:readline';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as store from './state.js';
import { ROOT, readFixture, maskSecrets } from './cache.js';
import { STORY, PREROLL, TRIGGER, STEP_MODULES, ACTION_STEPS, TIMEOUT_S, FALLBACK_PLAN, DELIVERED, SUMMARY_PATCH } from './beats.js';

try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* no .env: replay still works */ }

const argMode = process.argv.includes('--live') ? 'live' : process.argv.includes('--replay') ? 'replay' : null;
const MODE = argMode || (process.env.MODE === 'live' ? 'live' : 'replay');
const PORT = Number(process.env.PORT) || 4000;
const PREROLL_ON = process.env.PREROLL !== '0';
const HOLD_WINDOW_S = Number(process.env.HOLD_WINDOW_S) || 10;
const EVENT_GAP_MS = 700;       // pause between events a module returns at once
const TYPE_CPS = 40;            // console types reasoning at this speed (plan section 8)
const LINE_MS = 700;            // console reveals transcript lines at this pace
const TIMECARD_MS = 1600;       // console shows a full-screen time card this long
const WEBHOOK_MAX_BYTES = 1 << 20;

/* ---------------- Run state ---------------- */
let runToken = 0;
let running = false;
let paused = false;
let phase = 'idle';
let currentStep = null;
let outcome = null;             // set when a run ends: { ok, completed, stopped }
let seq = 0;
let history = [];               // console events since the last reset (replayed to late joiners)
let aborters = new Set();       // in-flight module calls, aborted on reset
const consoleClients = new Set();

class Cancelled extends Error {}

const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);
const agentLabel = () => (MODE === 'live' ? 'LIVE' : 'CACHED');

/* ---------------- SSE ---------------- */
function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event, data) {
  for (const res of consoleClients) send(res, event, data);
}
setInterval(() => { for (const res of consoleClients) res.write(': keepalive\n\n'); }, 15000).unref();

/* ---------------- Story clock ---------------- */
// Story time runs at real speed from an anchor; phases re-anchor it (Tue 09:58, Thu delivery…).
const clock = { story: Date.parse(STORY.preroll), real: Date.now() };
function setClock(iso) { clock.story = Date.parse(iso); clock.real = Date.now(); }
function advanceClock(seconds) { clock.story += seconds * 1000; }
function storyNow() {
  const ist = new Date(clock.story + (Date.now() - clock.real) + 330 * 60000);
  return `${ist.toISOString().slice(0, 19)}+05:30`;
}
function timecard(iso) {
  const [date, time] = iso.split('T');
  return `${store.dateLabel(date)}, ${time.slice(0, 5)}`;
}

function setPhase(name, title, card = null) {
  phase = name;
  broadcast('phase', { phase: name, title, timecard: card ? timecard(card) : null, mode: MODE });
  log(`▶ ${title}${card ? ` · ${timecard(card)}` : ''}`);
}

// How long the console needs to animate an event, so the run never gets ahead of the screen.
function animMs(e) {
  if (e.type === 'stream') {
    const text = e.stream || (e.json && Array.isArray(e.json.reasoning) ? e.json.reasoning.join('\n\n') : '');
    return Math.ceil((String(text).length / TYPE_CPS) * 1000) + EVENT_GAP_MS;
  }
  if (e.type === 'transcript') return (Array.isArray(e.lines) ? e.lines.length : 0) * LINE_MS + EVENT_GAP_MS;
  return EVENT_GAP_MS;
}

/* ---------------- Pausing / cancelling ---------------- */
async function sleep(ms, token) {
  let left = ms;
  while (left > 0 || paused) {
    if (token !== runToken) throw new Cancelled();
    await new Promise((r) => setTimeout(r, 100));
    if (!paused) left -= 100;
  }
  if (token !== runToken) throw new Cancelled();
}

/* ---------------- Events ---------------- */
function emit(raw, token) {
  if (token !== runToken) return null;  // a cancelled run's late events are dropped
  const evt = { ...raw };
  if (evt.t && !evt.t_source) evt.t_source = evt.t;
  evt.id = `evt_${String(++seq).padStart(4, '0')}`;
  evt.t = storyNow();
  evt.phase = phase;
  if (currentStep && !evt.step) evt.step = currentStep.step;
  if (evt.json) evt.json = maskSecrets(evt.json);
  if (!evt.label) {
    log(`  ! event "${evt.title}" has no source label; marked SCRIPTED`);
    evt.label = 'SCRIPTED';
  }
  history.push(evt);
  broadcast('evt', evt);
  return evt;
}
const agent = (title, token, extra = {}) => emit({ source: 'agent', label: agentLabel(), type: 'info', title, ...extra }, token);

/* ---------------- Modules ---------------- */
// Console source chip for module events that don't set `source` themselves (team split 2.3).
const CHIP = { hf_ocr: 'hf', hf_reason: 'hf', fhir: 'abha' };
const KNOWN_MODULES = new Set(['hf_ocr', 'fhir', 'hf_reason', ...Object.values(STEP_MODULES).flat()]);
const loaded = new Map();

async function loadModule(name) {
  if (loaded.has(name)) return loaded.get(name);
  const file = join(ROOT, 'server', 'integrations', `${name}.js`);
  let mod = null;
  if (existsSync(file)) {
    try {
      mod = await import(pathToFileURL(file).href);
    } catch (e) {
      log(`  ! ${name}.js failed to load: ${e.message}`);
      mod = null;
    }
  }
  loaded.set(name, mod);
  return mod;
}

const validResult = (r) => r && typeof r === 'object' && Array.isArray(r.events);
const withSource = (name, e) => ({ ...e, source: e.source || CHIP[name] || name });

function abortPromise(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason instanceof Error ? signal.reason : new Error('aborted')), { once: true });
  });
}

async function callModule(name, step, token) {
  const mod = await loadModule(name);
  const key = step ? step.step : name;
  const timeoutS = TIMEOUT_S[key] || 60;
  if (mod && typeof mod.run === 'function') {
    for (const mode of MODE === 'live' ? ['live', 'replay'] : ['replay']) {
      const ac = new AbortController();
      aborters.add(ac);
      const timer = setTimeout(() => ac.abort(new Error(`timed out after ${timeoutS}s`)), timeoutS * 1000);
      const ctx = {
        state: structuredClone(store.get()), mode, phase, signal: ac.signal,
        step: step ? structuredClone(step) : null,
        emit: (e) => emit(withSource(name, e), token)
      };
      try {
        const r = await Promise.race([mod.run(ctx), abortPromise(ac.signal)]);
        if (!validResult(r)) throw new Error('run() did not return { events: [...] }');
        return { via: mode, ...r };
      } catch (e) {
        if (token !== runToken) throw new Cancelled();
        log(`  ! ${name} (${mode}) failed: ${e.message}`);
        agent(`${name} · ${mode} call failed`, token, { body: e.message });
      } finally {
        clearTimeout(timer);
        aborters.delete(ac);
      }
    }
  }
  const fxName = step && readFixture(`${name}.${step.step}`) ? `${name}.${step.step}` : name;
  const fx = readFixture(fxName);
  if (validResult(fx)) {
    log(`  ⚠ ${name}: using FIXTURE fixtures/${fxName}.json (fake data, not for recording)`);
    return { via: 'fixture', ...fx, events: fx.events.map((e) => ({ ...e, fixture: true })) };
  }
  log(`  ! ${name}: no module, cache or fixture`);
  return {
    via: 'missing', statePatch: {}, result: null,
    events: [{ source: CHIP[name] || name, label: 'SIMULATED', type: 'info', missing: true,
      title: `[missing] ${name}${step ? ` · ${step.step}` : ''} · no module, cache or fixture yet`,
      body: `Expected server/integrations/${name}.js or fixtures/${name}${step ? `.${step.step}` : ''}.json` }]
  };
}

// Calls a module, streams the events it returns, applies its statePatch.
async function runModule(name, step, token) {
  const r = await callModule(name, step, token);
  if (token !== runToken) throw new Cancelled();
  log(`  · ${name}${step ? ` (${step.step})` : ''} via ${r.via}`);
  for (const e of r.events) {
    emit(withSource(name, e), token);
    await sleep(animMs(e), token);
  }
  if (r.statePatch) store.apply(r.statePatch);
  return r;
}

/* ---------------- The agent run ---------------- */
async function playScripted(steps, token) {
  for (const s of steps) {
    if (s.kind === 'event') { emit(s.event, token); await sleep(EVENT_GAP_MS, token); }
    else if (s.kind === 'module') await runModule(s.name, null, token);
  }
}

function planFrom(r) {
  if (r.via === 'missing') return null;
  const res = r.result;
  if (res && Array.isArray(res.plan) && res.decision) return { decision: res.decision, plan: res.plan };
  const ev = r.events.find((e) => e.type === 'plan');
  if (!ev) return null;
  const j = ev.json;
  if (Array.isArray(j)) return { decision: ev.decision || 'act_and_inform', plan: j };
  if (j && Array.isArray(j.plan)) return { decision: j.decision || ev.decision, plan: j.plan };
  return null;
}

// Limits checked against state, never against the model's own claims. Returns a reason or null.
function guard(step, facts) {
  const s = store.get();
  const maa = s.members.find((m) => m.id === 'maa');
  if (step.step === 'create_order') {
    const amount = Number(step.amount_inr);
    const remaining = s.mandate.cap - s.mandate.used;
    if (amount !== s.order.price_inr) return `order amount ₹${step.amount_inr} ≠ price on file ₹${s.order.price_inr}`;
    if (amount > remaining) return `₹${amount} is over the ₹${remaining} left on the mandate`;
  }
  if (step.step === 'route_delivery') {
    if (!facts.paid) return 'order is not paid';
    if (String(step.pincode) !== String(maa.pincode)) return `pincode ${step.pincode} is not Maa's (${maa.pincode})`;
  }
  if (step.step === 'notify_parent' && !facts.delivered) return 'Maa is told only after delivery';
  return null;
}

// Checks the whole plan before anything acts. Returns a reason or null.
function checkPlan(decision, plan) {
  const unknown = plan.filter((p) => !STEP_MODULES[p.step]).map((p) => p.step);
  if (unknown.length) return `unknown step${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`;
  if (decision !== 'act_and_inform') return null;
  const notifyAt = plan.findIndex((p) => p.step === 'notify_caregiver');
  const firstAction = plan.findIndex((p) => ACTION_STEPS.includes(p.step));
  if (firstAction >= 0 && (notifyAt < 0 || notifyAt > firstAction)) return 'the caregiver must be told before any action';
  const parentAt = plan.findIndex((p) => p.step === 'notify_parent');
  if (parentAt >= 0 && parentAt !== plan.length - 1) return 'notify_parent must be the last step';
  return null;
}

async function escalate(reason, token) {
  currentStep = { step: 'escalate_to_backup', reason };
  agent(`escalate_to_backup · ${reason}`, token);
  for (const name of STEP_MODULES.escalate_to_backup) await runModule(name, currentStep, token);
  currentStep = null;
}

// Runs one plan step through its module(s). Returns { ok, stop, reason }.
async function runStep(step, facts, token) {
  const args = { ...step };
  if (step.step === 'notify_caregiver') args.hold_window_s = HOLD_WINDOW_S;
  let last = null;
  for (const name of STEP_MODULES[step.step]) {
    const r = await runModule(name, args, token);
    if (r.via === 'missing') return { ok: false, reason: `${name} unavailable` };
    if (r.artifacts && r.artifacts.audio) args.audio = r.artifacts.audio;   // gnani TTS → whatsapp
    last = r;
  }
  const res = (last && last.result) || {};
  switch (step.step) {
    case 'notify_caregiver':
      if (res.hold) return { ok: false, stop: 'hold', reason: `HOLD received${res.reply ? ` ("${res.reply}")` : ''}` };
      advanceClock((Number(step.hold_window_min) || 10) * 60 - HOLD_WINDOW_S);
      agent('no HOLD received → proceed', token);
      return { ok: true };
    case 'book_appointment':
      return res.confirmed === false ? { ok: false, reason: 'clinic did not confirm a slot' } : { ok: true };
    case 'create_order':
      // SIMULATED = real Pine Labs UAT order, payment step simulated and labelled so (see pinelabs.js).
      if (!['PROCESSED', 'SIMULATED'].includes(res.status)) return { ok: false, reason: `payment not confirmed (${res.status || 'no webhook'})` };
      facts.paid = true;
      return { ok: true };
    case 'route_delivery':
      if (res.serviceable === false) return { ok: false, reason: `pincode ${step.pincode} not serviceable` };
      facts.routed = true;
      return { ok: true };
    default:
      return { ok: true };
  }
}

async function executePlan({ decision, plan }, token) {
  const done = [];
  const problem = checkPlan(decision, plan);
  if (problem) {
    agent(`plan rejected · ${problem}`, token, { type: 'checklist_tick', status: 'blocked' });
    await escalate(`plan rejected: ${problem}`, token);
    return { ok: false, completed: done, stopped: problem };
  }
  const steps = decision === 'act_and_inform' ? plan : plan.filter((p) => p.step === 'escalate_to_backup');
  if (decision !== 'act_and_inform') {
    plan.filter((p) => p.step !== 'escalate_to_backup').forEach((p) => agent(`ignored · ${p.step} (decision: ${decision})`, token));
    if (!steps.length) { await escalate(`decision: ${decision}`, token); return { ok: true, completed: ['escalate_to_backup'], stopped: null }; }
  }

  const facts = { paid: false, routed: false, delivered: false };
  for (const step of steps) {
    currentStep = step;
    broadcast('phase', { phase: 'execute', title: 'Acting', step: step.step, mode: MODE });
    log(`  ▸ ${step.step}`);
    const blocked = guard(step, facts);
    if (blocked) {
      agent(`blocked · ${step.step} · ${blocked}`, token, { type: 'checklist_tick', status: 'blocked' });
      currentStep = null;
      await escalate(`${step.step} blocked: ${blocked}`, token);
      return { ok: false, completed: done, stopped: blocked };
    }
    const r = await runStep(step, facts, token);
    if (!r.ok) {
      agent(`stopped · ${step.step} · ${r.reason}`, token, { type: 'checklist_tick', status: 'stopped' });
      currentStep = null;
      if (r.stop !== 'hold') await escalate(`${step.step} failed: ${r.reason}`, token);
      return { ok: false, completed: done, stopped: r.reason };
    }
    emit({ source: 'agent', label: agentLabel(), type: 'checklist_tick', step: step.step, status: 'done', title: `✓ ${step.step}` }, token);
    done.push(step.step);

    if (step.step === 'route_delivery') {
      currentStep = null;
      setClock(STORY.delivered);
      setPhase('delivered', 'Delivered', STORY.delivered);
      await sleep(TIMECARD_MS, token);
      emit(DELIVERED.event, token);
      store.apply(DELIVERED.statePatch);
      facts.delivered = true;
      await sleep(EVENT_GAP_MS, token);
    }
  }
  currentStep = null;
  return { ok: true, completed: done, stopped: null };
}

async function runAgent(token) {
  running = true;
  outcome = null;
  try {
    if (PREROLL_ON) {
      setClock(STORY.preroll);
      setPhase('preroll', 'Records', STORY.preroll);
      await sleep(TIMECARD_MS, token);
      await playScripted(PREROLL, token);
    }

    setClock(STORY.trigger);
    setPhase('trigger', 'Trigger', STORY.trigger);
    await sleep(TIMECARD_MS, token);
    store.apply(TRIGGER.statePatch);
    await playScripted(TRIGGER.events, token);

    setPhase('reason', 'Agent plan');
    const r = await runModule('hf_reason', null, token);
    let decided = planFrom(r);
    if (!decided) {
      emit({ source: 'agent', label: 'SCRIPTED', type: 'plan', title: 'Plan · fallback (scripted, no model plan available)',
        decision: FALLBACK_PLAN.decision, json: FALLBACK_PLAN.plan }, token);
      decided = FALLBACK_PLAN;
      await sleep(EVENT_GAP_MS, token);
    }

    setPhase('execute', 'Acting');
    outcome = await executePlan(decided, token);

    const actions = outcome.completed.filter((s) => s !== 'notify_caregiver').length;
    const n = `${actions} action${actions === 1 ? '' : 's'}`;
    if (outcome.ok) {
      setClock(STORY.summary);
      setPhase('summary', 'Caregiver lands', STORY.summary);
      await sleep(TIMECARD_MS, token);
      store.apply(SUMMARY_PATCH);
      agent(`summary · ${n}, 0 missed`, token);
    } else {
      setPhase('summary', 'Stopped');
      agent(`summary · ${n} done, stopped: ${outcome.stopped}`, token);
    }
    log(outcome.ok ? '■ run complete' : `■ run stopped: ${outcome.stopped}`);
  } catch (e) {
    if (!(e instanceof Cancelled)) {
      log(`  ! run failed: ${e.stack || e.message}`);
      agent('run failed', token, { body: e.message });
    }
  } finally {
    if (token === runToken) { running = false; phase = phase === 'summary' ? 'done' : phase; broadcast('control', { action: 'finished' }); }
  }
}

/* ---------------- Controls ---------------- */
function doReset() {
  runToken++;
  for (const ac of aborters) ac.abort(new Error('reset'));
  aborters = new Set();
  running = false;
  paused = false;
  phase = 'idle';
  currentStep = null;
  outcome = null;
  history = [];
  seq = 0;
  store.reset();
  setClock(STORY.preroll);
  broadcast('control', { action: 'reset' });
  log('■ reset');
}

function start() {
  if (running) { log('  (run in progress; Space ignored)'); return false; }
  if (phase !== 'idle') doReset();
  runAgent(runToken);
  return true;
}

function togglePause() {
  paused = !paused;
  broadcast('control', { action: paused ? 'pause' : 'resume' });
  log(paused ? '⏸ paused (live calls keep going)' : '▶ resumed');
  return paused;
}

const status = () => ({ phase, step: currentStep ? currentStep.step : null, running, paused, mode: MODE, preroll: PREROLL_ON, outcome });

/* ---------------- Webhooks ---------------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > WEBHOOK_MAX_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleWebhook(req, res, name, url) {
  const mod = KNOWN_MODULES.has(name) ? await loadModule(name) : null;
  if (!mod || typeof mod.onWebhook !== 'function') return sendJson(res, 404, { error: `no webhook handler for ${name}` });
  let rawBody;
  try { rawBody = await readBody(req); } catch (e) { return sendJson(res, 413, { error: e.message }); }
  const type = String(req.headers['content-type'] || '');
  let body = rawBody;
  try {
    if (type.includes('application/json')) body = rawBody ? JSON.parse(rawBody) : {};
    else if (type.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(rawBody));
  } catch { /* leave body as the raw string */ }
  // The public URL as the sender signed it (Twilio signs the full URL; ngrok sets X-Forwarded-*).
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  log(`  ← webhook ${name} (${req.method})`);
  try {
    const r = await mod.onWebhook({
      method: req.method, headers: req.headers, rawBody, body,
      query: Object.fromEntries(url.searchParams), url: `${proto}://${host}${req.url}`
    });
    const headers = { 'Cache-Control': 'no-store', ...(r && r.headers) };
    if (r && r.body != null && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = typeof r.body === 'string' ? 'text/plain; charset=utf-8' : TYPES['.json'];
    }
    res.writeHead((r && r.status) || 200, headers);
    res.end(r && r.body != null ? (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) : '');
  } catch (e) {
    log(`  ! webhook ${name} failed: ${e.message}`);
    sendJson(res, 500, { error: 'webhook handler failed' });
  }
}

/* ---------------- HTTP ---------------- */
const STATIC = {
  '/console/': join(ROOT, 'web', 'console'),
  '/onboarding/': join(ROOT, 'web', 'onboarding'),
  '/dashboard/': join(ROOT, 'web', 'dashboard'),
  '/data/docs/': join(ROOT, 'data', 'docs'),
  '/data/audio/': join(ROOT, 'data', 'audio')
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2'
};

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function serveStatic(res, pathname) {
  const prefix = Object.keys(STATIC).find((p) => pathname.startsWith(p));
  if (!prefix) return false;
  const base = STATIC[prefix];
  let rel;
  try { rel = decodeURIComponent(pathname.slice(prefix.length)); } catch { sendJson(res, 400, { error: 'bad path' }); return true; }
  let file = normalize(join(base, rel));
  if (file !== base && !file.startsWith(base + sep)) { sendJson(res, 403, { error: 'forbidden' }); return true; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not found: ${pathname}${rel === '' ? ' (not built yet)' : ''}`);
    return true;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
  return true;
}

// ngrok forwards from 127.0.0.1 too, so proxied requests are recognised by their forwarding headers.
const isProxied = (req) => Boolean(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['ngrok-trace-id']);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  const hook = p.match(/^\/webhooks\/([a-z_]+)\/?$/);
  if (hook) return handleWebhook(req, res, hook[1], url);
  if (isProxied(req)) return sendJson(res, 403, { error: 'only /webhooks/* is reachable from outside' });

  if (req.method === 'POST') {
    if (p === '/next') return sendJson(res, 200, { ok: start(), ...status() });
    if (p === '/reset') { doReset(); return sendJson(res, 200, { ok: true, ...status() }); }
    if (p === '/pause') return sendJson(res, 200, { ok: true, paused: togglePause() });
    return sendJson(res, 404, { error: 'unknown control' });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });

  if (p === '/') { res.writeHead(302, { Location: '/console/' }); return res.end(); }
  if (['/console', '/onboarding', '/dashboard'].includes(p)) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
  if (p === '/state.json') return sendJson(res, 200, store.json());
  if (p === '/status') return sendJson(res, 200, status());
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    send(res, 'hello', { ...status(), history });
    consoleClients.add(res);
    req.on('close', () => consoleClients.delete(res));
    return;
  }
  if (serveStatic(res, p)) return;
  sendJson(res, 404, { error: 'not found' });
});

/* ---------------- Keyboard ---------------- */
function keyboard() {
  if (!process.stdin.isTTY) return;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key = {}) => {
    if ((key.ctrl && key.name === 'c') || key.name === 'q') process.exit(0);
    if (key.name === 'space') start();
    else if (key.name === 'r') doReset();
    else if (key.name === 'p') togglePause();
  });
}

/* ---------------- Boot ---------------- */
store.reset();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nSanjeevani agent runner · MODE=${MODE} · pre-roll ${PREROLL_ON ? 'on' : 'off'} · HOLD window ${HOLD_WINDOW_S}s`);
  console.log(`  console    http://localhost:${PORT}/console/`);
  console.log(`  webhooks   http://localhost:${PORT}/webhooks/<module>   (expose with: ngrok http ${PORT})`);
  console.log(`  keys       Space start · R reset · P pause · Q quit\n`);
  keyboard();
});
