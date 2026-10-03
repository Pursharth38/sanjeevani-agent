// WhatsApp steps of the flow. Messages come from data/whatsapp_script.json; ctx.step (a plan step) or
// ctx.beat picks the entry.
//
// Manual mode (default): a teammate's phone is "Sanjeevani". The cue page (web/cue/) shows each message;
// the teammate sends it by hand and taps Sent ✓ / Received ✓. run() waits for those taps, so the flow
// stays in sync with WhatsApp. Events are labelled SCRIPTED. Waits in live mode; set CUE_WAIT=0|1 to override.
// Orchestrator wiring: push {"beat": N} on /cue-stream, forward POST /cue/ack (JSON) to onCueAck(body),
// call resetCue() on reset, and optionally pass ctx.emit(event) to show events as they happen.
//
// Twilio mode (WA_MODE=twilio, parked: the trial account only sends Twilio's templates): the agent sends
// through the Twilio API and reads replies from POST /webhooks/whatsapp → onWebhook(body).
//
// CLI:
//   node server/integrations/whatsapp.js --cue [beat ...]   rehearsal: serves the cue page and runs the
//                                                           WhatsApp beats in order, waiting for taps
//   node server/integrations/whatsapp.js --listen           Twilio webhook server only
//   node server/integrations/whatsapp.js --live <beat>      Twilio: run one beat for real → cache/whatsapp.json
// All start a server on WA_PORT (default 8787).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const API = 'https://api.twilio.com/2010-04-01';
const SCRIPT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/whatsapp_script.json'), 'utf8'));
const CACHE_FILE = path.join(ROOT, 'cache/whatsapp.json');
// Plan steps plus the orchestrator's pre-roll / landing step names (its CUE_BEAT).
const STEP_BEAT = {
  documents_received: '1',
  confirm_medicine_name: '3',
  away_mode: '4',
  notify_caregiver: '7',
  notify_parent: '12',
  caregiver_lands: '13',
};
const REPLY_TIMEOUT_MS = 5 * 60 * 1000;
const INBOX_TTL_MS = 2 * 60 * 1000;
const DOCS_SETTLE_MS = 5000;
const CUE_TIMEOUT_MS = 30 * 60 * 1000;
const AUDIO = /\.(mp3|ogg|m4a|amr)$/i;
const MEDIA_TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

const wa = (n) => (n.startsWith('whatsapp:') ? n : `whatsapp:${n}`);
const nowIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().replace('Z', '+05:30');
const maskJson = (o) => JSON.parse(JSON.stringify(o)
  .replace(/AC[0-9a-f]{32}/gi, 'AC••••••••')
  .replace(/(\+\d{2})\d{5,}(\d{3})/g, '$1•••••$2'));

// Weekday labels are computed from the dates in the script, never hardcoded.
function fill(text) {
  const fmt = (iso, opts) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(new Date(iso));
  const { appt, return: ret } = SCRIPT.vars;
  const v = {
    appt_weekday: fmt(appt, { weekday: 'long' }),
    appt_wd: fmt(appt, { weekday: 'short' }),
    appt_time: fmt(appt, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
    return_weekday: fmt(ret, { weekday: 'long' }),
  };
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? v[k] : m));
}

// ---- inbound ---------------------------------------------------------------

const inbox = [];
const waiters = [];

// Twilio posts application/x-www-form-urlencoded; pass the parsed fields.
export function onWebhook(body) {
  const msg = {
    from: body.From,
    text: body.Body ?? '',
    media: Number(body.NumMedia || 0),
    sid: body.MessageSid,
    at: Date.now(),
  };
  const i = waiters.findIndex((w) => w.test(msg));
  if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
  else inbox.push(msg);
  return { status: 200, type: 'text/xml', body: '<Response></Response>' };
}

function waitFor(test, ms) {
  const i = inbox.findIndex((m) => Date.now() - m.at < INBOX_TTL_MS && test(m));
  if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
  return new Promise((resolve) => {
    const w = { test, resolve: (m) => { clearTimeout(timer); resolve(m); } };
    const timer = setTimeout(() => {
      waiters.splice(waiters.indexOf(w), 1);
      resolve(null);
    }, ms);
    waiters.push(w);
  });
}

const fromCaregiver = (m) => m.from === wa(process.env.CAREGIVER_WHATSAPP);

// A forwarded batch of documents arrives as one message per file; collect until it goes quiet.
async function waitCaregiver(step) {
  if (!step.action) return [await waitFor(fromCaregiver, REPLY_TIMEOUT_MS)];
  const isDoc = (m) => fromCaregiver(m) && m.media > 0;
  const first = await waitFor(isDoc, REPLY_TIMEOUT_MS);
  if (!first) return [null];
  const msgs = [first];
  for (let m; (m = await waitFor(isDoc, DOCS_SETTLE_MS));) msgs.push(m);
  return msgs;
}

// ---- outbound --------------------------------------------------------------

async function twilioSend(params) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const url = `${API}/Accounts/${sid}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${json?.message ?? 'no body'}`);
  const { sid: msgSid, status, to, from, body, num_media, date_created } = json;
  return maskJson({ request: { url, ...params }, response: { sid: msgSid, status, to, from, body, num_media, date_created } });
}

// WhatsApp drops captions on audio, so audio goes as its own message after the text.
async function send(text, attach = []) {
  const base = { From: wa(process.env.TWILIO_WHATSAPP_FROM), To: wa(process.env.CAREGIVER_WHATSAPP) };
  const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const media = attach.filter((a) => publicUrl && fs.existsSync(path.join(ROOT, a)));
  const skipped = attach.filter((a) => !media.includes(a));
  const image = media.find((a) => !AUDIO.test(a));
  const audio = media.find((a) => AUDIO.test(a));

  const sent = [await twilioSend({ ...base, Body: text, ...(image && { MediaUrl: `${publicUrl}/${image}` }) })];
  if (audio) sent.push(await twilioSend({ ...base, MediaUrl: `${publicUrl}/${audio}` }));
  return { sent, skipped };
}

// ---- run -------------------------------------------------------------------

function readCache() {
  return fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};
}

function makeEvent(key, n, fields) {
  return { id: `evt_${key.padStart(2, '0')}w${n}`, beat: Number(key), t: nowIst(), source: 'whatsapp', ...fields };
}

async function runLive(key, entry, ctx) {
  const events = [];
  const ev = (fields) => events.push(makeEvent(key, events.length + 1, { label: 'LIVE', ...fields }));
  let halt = false;

  for (const step of entry.steps) {
    if (step.from === 'caregiver') {
      const msgs = await waitCaregiver(step);
      if (!msgs[0]) throw new Error(`beat ${key}: no reply from caregiver within ${REPLY_TIMEOUT_MS / 60000} min`);
      ev(step.action
        ? { type: 'info', title: `whatsapp.inbound · ${msgs.length} file${msgs.length > 1 ? 's' : ''}`, body: 'From Pursharth' }
        : { type: 'info', title: `Pursharth: "${msgs[0].text}"`, body: 'whatsapp.inbound' });
      continue;
    }
    const text = fill(step.text);
    const { sent, skipped } = await send(text, step.attach);
    ev({ type: 'info', title: `Sent to Pursharth · ${text}`, body: skipped.length ? `attachment not sent: ${skipped.join(', ')}` : undefined, json: sent });
  }

  // The plan's 10-minute HOLD window, compressed to 10 seconds for the demo (minutes → seconds).
  if (entry.hold) {
    const minutes = ctx.step?.hold_window_min ?? 10;
    const seconds = ctx.step?.hold_window_s ?? minutes;
    ev({ type: 'countdown', title: `HOLD window · ${minutes}:00`, body: 'HOLD window · compressed for demo', seconds, json: { seconds, minutes, compressed: true } });
    const reply = await waitFor((m) => fromCaregiver(m) && /^\s*hold\b/i.test(m.text), seconds * 1000);
    halt = Boolean(reply);
    ev(halt
      ? { type: 'info', title: 'HOLD received → stopping', body: `Pursharth: "${reply.text}"` }
      : { type: 'info', title: 'No HOLD received → proceed' });
  }

  const cache = readCache();
  cache[key] = { recorded_at: new Date().toISOString(), halt, events };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n');
  return { events, statePatch: {}, artifacts: {}, halt };
}

// Twilio replay: the saved real run if there is one, otherwise the script text. Never waits.
function runReplay(key, entry, ctx) {
  const cached = readCache()[key];
  if (cached) return { events: cached.events, statePatch: {}, artifacts: {}, halt: cached.halt };
  return runManual(key, entry, ctx, false);
}

// ---- manual mode (cue page) -------------------------------------------------

const acks = new Map();        // "beat:step" → tap that arrived before run() asked for it
const ackWaiters = new Map();  // "beat:step" → resolve

// The orchestrator forwards POST /cue/ack here. Body: { beat, step, kind }; step is the step index or "hold".
export function onCueAck(body) {
  const id = `${body.beat}:${body.step}`;
  const resolve = ackWaiters.get(id);
  if (resolve) {
    ackWaiters.delete(id);
    resolve(body);
  } else {
    acks.set(id, body);
  }
  return { status: 200, type: 'application/json', body: '{"ok":true}' };
}

// Call on reset (R) so taps from an earlier run don't count.
export function resetCue() {
  acks.clear();
  for (const resolve of ackWaiters.values()) resolve(null);
  ackWaiters.clear();
}

function waitAck(id, ms) {
  if (acks.has(id)) {
    const ack = acks.get(id);
    acks.delete(id);
    return Promise.resolve(ack);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ackWaiters.delete(id); resolve(null); }, ms);
    ackWaiters.set(id, (ack) => { clearTimeout(timer); resolve(ack); });
  });
}

async function runManual(key, entry, ctx, wait) {
  const events = [];
  const ev = (fields) => {
    const e = makeEvent(key, events.length + 1, { label: 'SCRIPTED', ...fields });
    events.push(e);
    ctx.emit?.(e);
  };
  let halt = false;

  for (const [i, step] of entry.steps.entries()) {
    if (wait && !(await waitAck(`${key}:${i}`, CUE_TIMEOUT_MS))) {
      throw new Error(`beat ${key}: no cue tap for step ${i + 1}`);
    }
    ev(step.from === 'caregiver'
      ? { type: 'info', title: step.action ? `Pursharth: ${step.action}` : `Pursharth: "${fill(step.text)}"`, body: 'whatsapp.inbound' }
      : { type: 'info', title: `Sent to Pursharth · ${fill(step.text)}`, body: step.attach ? `📎 ${step.attach.join(', ')}` : undefined });
  }

  // The plan's 10-minute HOLD window, compressed to 10 seconds for the demo (minutes → seconds).
  // The cue page shows a "Pursharth replied HOLD" button during the window.
  if (entry.hold) {
    const minutes = ctx.step?.hold_window_min ?? 10;
    const seconds = ctx.step?.hold_window_s ?? minutes;
    ev({ type: 'countdown', title: `HOLD window · ${minutes}:00`, body: 'HOLD window · compressed for demo', seconds, json: { seconds, minutes, compressed: true } });
    if (wait) halt = Boolean(await waitAck(`${key}:hold`, seconds * 1000));
    ev(halt ? { type: 'info', title: 'HOLD received → stopping' } : { type: 'info', title: 'No HOLD received → proceed' });
  }

  for (const id of acks.keys()) if (id.startsWith(`${key}:`)) acks.delete(id);
  // Events already streamed through ctx.emit are not returned again (the orchestrator shows returned ones).
  return { events: ctx.emit ? [] : events, statePatch: {}, artifacts: {}, halt, result: { halt, hold: halt } };
}

export async function run(ctx) {
  const key = String(STEP_BEAT[ctx.step?.step] ?? ctx.beat);
  const entry = SCRIPT.beats[key];
  if (!entry || entry.steps.length === 0) return { events: [], statePatch: {}, artifacts: {}, halt: false };
  if (process.env.WA_MODE === 'twilio') return ctx.mode === 'live' ? runLive(key, entry, ctx) : runReplay(key, entry, ctx);
  const wait = process.env.CUE_WAIT ? process.env.CUE_WAIT === '1' : ctx.mode === 'live';
  return runManual(key, entry, ctx, wait);
}

// ---- CLI -------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

// Standalone server for the CLI. The orchestrator provides the same routes in the real flow.
const cueClients = new Set();
let cueBeat = 0;

function pushCue(beat) {
  cueBeat = beat;
  for (const res of cueClients) res.write(`data: ${JSON.stringify({ beat })}\n\n`);
}

function sendFile(res, file) {
  res.writeHead(200, { 'Content-Type': MEDIA_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function startServer(port) {
  const dataDir = path.join(ROOT, 'data');
  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (req.method === 'POST' && pathname === '/webhooks/whatsapp') {
      const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const out = onWebhook(body);
      console.log(`inbound ${maskJson(body.From ?? '')}: ${body.Body ?? ''}${Number(body.NumMedia) ? ` [${body.NumMedia} media]` : ''}`);
      res.writeHead(out.status, { 'Content-Type': out.type }).end(out.body);
      return;
    }
    if (req.method === 'POST' && pathname === '/cue/ack') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400).end(); return; }
      const out = onCueAck(body);
      res.writeHead(out.status, { 'Content-Type': out.type }).end(out.body);
      return;
    }
    if (req.method === 'GET' && pathname === '/cue-stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ beat: cueBeat })}\n\n`);
      cueClients.add(res);
      req.on('close', () => cueClients.delete(res));
      return;
    }
    if (req.method === 'GET' && (pathname === '/cue' || pathname === '/cue/')) {
      sendFile(res, path.join(ROOT, 'web/cue/index.html'));
      return;
    }
    const file = path.join(ROOT, decodeURIComponent(pathname));
    if (req.method === 'GET' && file.startsWith(dataDir + path.sep) && fs.existsSync(file)) {
      sendFile(res, file);
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(port, () => console.log(`listening on port ${port}`));
  return server;
}

function lanUrls(port) {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}/cue`);
}

// Rehearsal: runs the WhatsApp beats in order and waits for the teammate's taps on the cue page.
async function rehearse(port, beats) {
  const server = startServer(port);
  console.log(`cue page: http://localhost:${port}/cue  (phone on same Wi-Fi: ${lanUrls(port).join(' or ')})`);
  try {
    for (const beat of beats) {
      pushCue(beat);
      console.log(`\n── beat ${beat} · ${SCRIPT.beats[beat].title} ──`);
      const out = await run({
        mode: 'live',
        beat,
        state: {},
        emit: (e) => console.log(`${e.label} · ${e.title}`),
      });
      if (out.halt) {
        console.log('HOLD → flow stopped');
        break;
      }
    }
    pushCue(0);
    console.log('\nrehearsal finished');
  } finally {
    setTimeout(() => { for (const res of cueClients) res.end(); server.close(); }, 500);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env; rely on the environment */ }
  const args = process.argv.slice(2);
  const port = Number(process.env.WA_PORT || 8787);
  const beatArgs = args.filter((a) => /^\d+$/.test(a)).map(Number);

  if (args.includes('--cue')) {
    process.env.WA_MODE = 'manual';
    process.env.CUE_WAIT = '1';
    const all = Object.keys(SCRIPT.beats).map(Number).filter((b) => SCRIPT.beats[b].steps.length);
    rehearse(port, beatArgs.length ? beatArgs : all).catch((err) => { console.error(err.message); process.exitCode = 1; });
  } else if (args.includes('--listen')) {
    startServer(port);
  } else if (args.includes('--live')) {
    process.env.WA_MODE = 'twilio';
    const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'CAREGIVER_WHATSAPP'].filter((k) => !process.env[k]);
    if (missing.length) {
      console.error(`missing in .env: ${missing.join(', ')}`);
      process.exit(1);
    }
    if (!beatArgs.length) {
      console.error('Usage: node server/integrations/whatsapp.js --live <beat>');
      process.exit(1);
    }
    const server = startServer(port);
    run({ mode: 'live', beat: beatArgs[0], state: {} })
      .then((out) => {
        for (const e of out.events) console.log(`${e.label} · ${e.title}`);
        console.log(`saved → cache/whatsapp.json [${beatArgs[0]}]${out.halt ? ' (HALT)' : ''}`);
      })
      .catch((err) => { console.error(err.message); process.exitCode = 1; })
      .finally(() => server.close());
  } else {
    console.log('Usage: node server/integrations/whatsapp.js --cue [beat ...] | --listen | --live <beat>');
    process.exit(1);
  }
}
