// Pine Labs Online (UAT) for the create_order step: real token → real Hosted Checkout order → payment.
//
//   node server/integrations/pinelabs.js --live     one real UAT run; writes cache/pinelabs.json
//   node server/integrations/pinelabs.js --replay   print the cached run
//
// PINELABS_PAYMENT chooses how the payment completes:
//   simulated (default)  the token and order are real SANDBOX calls; the payment happens on our own
//                        payment window (web/pay, "Simulated payment · Sanjeevani demo", no Pine Labs
//                        branding), which the console shows over itself. It lists every endpoint called,
//                        auto-confirms after PAY_AUTO_S (default 5; PAY_AUTO=0 waits for a click), and the
//                        server confirms by itself 15 s later if no window is open. Card processing is
//                        not enabled on our UAT merchant account, so a real payment would be declined.
//   Endpoints: GET /pay/session → paySession() · POST /pay/confirm → onPayConfirm(body).
//   checkout             the real flow below, for an account with card payments enabled.
//
// Hosted Checkout: our server creates the order; the card is entered on Pine Labs' own checkout page
// (no card data touches this server, so no PCI requirement). The checkout link is shown in the
// console and printed in the terminal; PINELABS_OPEN_CHECKOUT=1 also opens it in the default browser.
// A failed attempt (order ATTEMPTED) can be retried on the same page, so the run keeps waiting.
//
// Confirmation is whichever arrives first: the signed ORDER_PROCESSED webhook (POST
// /webhooks/pinelabs, verified with PINELABS_WEBHOOK_SECRET) or polling GET /orders/{id}.
// Both are real Pine Labs responses. Nothing here ever fabricates a PROCESSED status.
//
// Docs: https://www.pinelabs.com/docs/online-payments/hosted-checkout/integration-steps
//       https://www.pinelabs.com/docs/online-payments/developer-tools/webhooks/signature-verification
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readCache, writeCache, maskSecrets } from '../cache.js';

const CACHE = 'pinelabs';
const LABEL = 'SANDBOX';
const POLL_MS = 4000;
const HTTP_TIMEOUT_MS = 20000;
const REPLAY_MAX_GAP_MS = 2500;
const WEBHOOK_TOLERANCE_S = 300;
const FINAL = ['PROCESSED', 'FAILED', 'CANCELLED'];
const PAY_BACKSTOP_S = 15;
const PAID = ['PROCESSED', 'SIMULATED'];
const paymentMode = () => (process.env.PINELABS_PAYMENT === 'checkout' ? 'checkout' : 'simulated');

/* ---------------- Masking (cache files are committed) ---------------- */
const last4 = (s) => (s ? `••••${String(s).slice(-4)}` : s);
const maskUrl = (u) => (u ? String(u).replace(/([?&](token|t|key)=)[^&]+/gi, '$1••••') : u);

/* ---------------- Webhooks ---------------- */
// One pending payment at a time: run() registers what it is waiting for, onWebhook() fulfils it.
let pending = null;      // { orderId, resolve(evt) }
const early = new Map(); // order_id → final webhook that arrived before run() started waiting

function verifySignature(headers, rawBody) {
  const secret = process.env.PINELABS_WEBHOOK_SECRET;
  if (!secret) return { verified: false, reason: 'no PINELABS_WEBHOOK_SECRET set' };
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];
  if (!id || !ts || !sigHeader) return { verified: false, reject: true, reason: 'missing webhook-id/timestamp/signature headers' };
  if (Math.abs(Date.now() / 1000 - Number(ts)) > WEBHOOK_TOLERANCE_S) return { verified: false, reject: true, reason: 'timestamp outside tolerance' };
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${rawBody}`).digest();
  // Header is "v1,<base64>", possibly several space-separated.
  const ok = String(sigHeader).split(' ').some((part) => {
    const [, sig] = part.split(',');
    if (!sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return ok ? { verified: true } : { verified: false, reject: true, reason: 'signature mismatch' };
}

export async function onWebhook(req) {
  if (req.method !== 'POST') return { status: 405, body: { error: 'POST only' } };
  const check = verifySignature(req.headers, req.rawBody);
  if (check.reject) {
    console.log(`  ! pinelabs webhook rejected: ${check.reason}`);
    return { status: 401, body: { error: 'invalid signature' } };
  }
  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const data = body.data || {};
  if (!FINAL.includes(data.status)) return { status: 200, body: { received: true } };  // e.g. PAYMENT_FAILED: page allows retry
  const evt = { event_type: body.event_type, data, verified: check.verified, reason: check.reason };
  if (pending && data.order_id === pending.orderId) pending.resolve(evt);
  else if (data.order_id) early.set(data.order_id, evt);
  return { status: 200, body: { received: true } };
}

/* ---------------- HTTP ---------------- */
function base() {
  return (process.env.PINELABS_BASE || 'https://pluraluat.v2.pinepg.in').replace(/\/$/, '');
}

// Every real Pine Labs call of the current run, shown on the payment window's endpoint list.
let trace = [];

async function call(method, path, { token, body, signal } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers['Request-ID'] = randomUUID();
    headers['Request-Timestamp'] = new Date().toISOString();
  }
  const res = await fetch(base() + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.any([signal, AbortSignal.timeout(HTTP_TIMEOUT_MS)].filter(Boolean))
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 500) }; }
  trace.push({ method, url: base() + path, status: res.status, label: LABEL });
  return { status: res.status, ok: res.ok, json };
}
const ep = (method, path) => `${method} ${base()}${path}`;

function fail(step, r) {
  const msg = (r.json && (r.json.message || r.json.response_message || r.json.code)) || JSON.stringify(r.json).slice(0, 200);
  return new Error(`${step} failed: HTTP ${r.status} · ${msg}`);
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal && signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('aborted')); }, { once: true });
});

const paymentError = (p) => {
  const e = p.error_detail || {};
  const more = e.additional_error_details || {};
  return [e.code, more.reason, more.step].filter(Boolean).join(' · ') || 'no reason given';
};

/* ---------------- Simulated payment window ---------------- */
// One payment window at a time. run() opens a session; the page reads it (GET /pay/session) and
// confirms it (POST /pay/confirm); run() resumes when it is confirmed.
let session = null;
const payAutoS = () => (process.env.PAY_AUTO === '0' ? 0 : Number(process.env.PAY_AUTO_S) || 5);
const newPaymentId = () => `SIM-PAY-${randomUUID().slice(0, 8).toUpperCase()}`;

function openSession(info) {
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  session = {
    id: `SIM-${randomUUID().slice(0, 8).toUpperCase()}`, status: 'pending', auto_confirm_s: payAutoS(),
    order: info.order, endpoints: info.endpoints.map((e) => ({ ...e })), resolve, done
  };
  return session;
}

function confirmSession(ses, by) {
  if (ses.status !== 'pending') return null;
  ses.status = 'confirmed';
  ses.payment_id = newPaymentId();
  ses.confirmed_by = by;
  const e = ses.endpoints.find((x) => x.method === 'POST' && x.url === '/pay/confirm');
  if (e) e.status = 200;
  ses.resolve({ payment_id: ses.payment_id, confirmed_by: by });
  return ses.payment_id;
}

export function paySession() {
  if (!session) return { active: false };
  const { resolve, done, ...pub } = session;
  return { active: true, ...pub };
}

export async function onPayConfirm(body) {
  if (!session || session.status !== 'pending') return { status: 409, body: { error: 'no payment waiting' } };
  if (!body || body.session_id !== session.id) return { status: 409, body: { error: 'unknown payment session' } };
  const paymentId = confirmSession(session, 'page');
  return { status: 200, body: { confirmed: true, payment_id: paymentId, simulated: true } };
}

// Opens the window, waits for its confirmation (or the safety-net timer), streams the rows.
async function simulatedPayment(info, emit, signal) {
  const o = info.order;
  const ses = openSession(info);
  emit({ label: 'SIMULATED', type: 'pay_page', title: 'payment window · simulated', body: 'Sanjeevani demo payment page · no money moves',
    endpoint: 'GET /pay/', src: `/pay/?s=${ses.id}`, pay_part: true });
  const backstopMs = ses.auto_confirm_s > 0 ? (ses.auto_confirm_s + PAY_BACKSTOP_S) * 1000 : 0;
  const timer = backstopMs && setTimeout(() => confirmSession(ses, 'timer (no payment window open)'), backstopMs);
  let conf;
  try {
    conf = await Promise.race([ses.done, new Promise((_, reject) => signal && signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true }))]);
  } catch (e) {
    if (session === ses) session = null;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  emit({ label: 'SIMULATED', type: 'request', title: 'confirm test payment', endpoint: 'POST /pay/confirm', pay_part: true,
    json: { session_id: ses.id, pinelabs_order_id: o.pinelabs_order_id, amount_inr: o.amount_inr, method: o.card } });
  emit({ label: 'SIMULATED', type: 'response', title: `payment confirmed · ₹${o.amount_inr} · simulated`, endpoint: 'POST /pay/confirm', http: 200, pay_part: true, pay_close: true,
    json: { simulated: true, payment_id: conf.payment_id, pinelabs_order_id: o.pinelabs_order_id, merchant_order_reference: o.merchant_order_reference, amount_inr: o.amount_inr, confirmed_by: conf.confirmed_by } });
  return conf;
}

/* ---------------- Live run ---------------- */
function missingEnv() {
  return ['PINELABS_CLIENT_ID', 'PINELABS_CLIENT_SECRET'].filter((k) => !process.env[k]);
}

async function live(ctx, emit) {
  const missing = missingEnv();
  if (missing.length) throw new Error(`missing ${missing.join(', ')} in .env`);
  const { signal } = ctx;
  const s = ctx.state;
  const amountInr = Number((ctx.step && ctx.step.amount_inr) || s.order.price_inr);
  const paise = Math.round(amountInr * 100);
  trace = [];

  // 1. Token
  const tokenReq = { client_id: process.env.PINELABS_CLIENT_ID, client_secret: process.env.PINELABS_CLIENT_SECRET, grant_type: 'client_credentials' };
  const tokenEp = ep('POST', '/api/auth/v1/token');
  emit({ type: 'request', title: 'pinelabs.token', endpoint: tokenEp, json: { ...tokenReq, client_id: last4(tokenReq.client_id) } });
  const tok = await call('POST', '/api/auth/v1/token', { body: tokenReq, signal });
  if (!tok.ok || !tok.json.access_token) { emit({ type: 'response', title: `token failed · ${tok.status}`, endpoint: tokenEp, http: tok.status, json: tok.json }); throw fail('token', tok); }
  const token = tok.json.access_token;
  emit({ type: 'response', title: 'token issued', endpoint: tokenEp, http: tok.status, json: tok.json });

  // 2. Hosted Checkout order
  const ref = `${s.order.merchant_ref}-${Date.now().toString(36).toUpperCase()}`;  // unique per attempt
  const callback = process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, '')}/console/` : 'https://example.com/sanjeevani/return';
  const orderReq = {
    merchant_order_reference: ref,
    order_amount: { value: paise, currency: 'INR' },
    integration_mode: 'REDIRECT',
    pre_auth: false,
    allowed_payment_methods: ['CARD'],   // UAT UPI moves real money, so cards only
    notes: `${s.order.item} for Maa · ${s.order.pharmacy}`,
    callback_url: callback,
    failure_callback_url: callback,
    purchase_details: { customer: { first_name: s.caregiver.name, customer_id: 'SNJ-CG-01' } }
  };
  const orderEp = ep('POST', '/api/checkout/v1/orders');
  emit({ type: 'request', title: `pinelabs.checkout.create · ₹${amountInr}`, endpoint: orderEp, json: orderReq });
  const ord = await call('POST', '/api/checkout/v1/orders', { token, body: orderReq, signal });
  if (!ord.ok || !ord.json.order_id || !ord.json.redirect_url) { emit({ type: 'response', title: `checkout order failed · ${ord.status}`, endpoint: orderEp, http: ord.status, json: ord.json }); throw fail('checkout order', ord); }
  const orderId = ord.json.order_id;
  emit({ type: 'response', title: `Order created · ₹${amountInr} · ${orderId}`, endpoint: orderEp, http: ord.status, json: { ...ord.json, token: '••••', redirect_url: maskUrl(ord.json.redirect_url) } });

  const mandatePatch = { mandate: { used: s.mandate.used + amountInr, lastDebit: `₹${amountInr} · Apollo` } };
  if (paymentMode() === 'simulated') {
    const payInfo = {
      order: { item: s.order.item, pharmacy: s.order.pharmacy, customer: s.caregiver.name, amount_inr: amountInr,
        pinelabs_order_id: orderId, merchant_order_reference: ref, card: 'Test card •••• 1112' },
      endpoints: [...trace, { method: 'GET', url: '/pay/session', status: 200, label: 'SIMULATED' }, { method: 'POST', url: '/pay/confirm', status: null, label: 'SIMULATED' }]
    };
    const conf = await simulatedPayment(payInfo, emit, signal);
    return { events: [], statePatch: mandatePatch, artifacts: {}, payInfo,
      result: { status: 'SIMULATED', order_id: orderId, payment_id: conf.payment_id, confirmed_via: conf.confirmed_by } };
  }

  // Listen before the page opens, so a fast webhook is not missed.
  const webhook = new Promise((resolve) => {
    if (early.has(orderId)) { resolve(early.get(orderId)); early.delete(orderId); return; }
    pending = { orderId, resolve };
  });

  // 3. Payment on Pine Labs' page. Live only and never cached: the link is a one-time payment token.
  emit({ type: 'info', title: 'checkout · pay on the Pine Labs UAT page', body: 'Card is entered on Pine Labs\' page; the agent waits for Pine Labs to confirm', link: ord.json.redirect_url, live_only: true });
  console.log(`\n  Pine Labs UAT checkout (open once):\n  ${ord.json.redirect_url}\n`);
  if (process.env.PINELABS_OPEN_CHECKOUT === '1' && process.platform === 'darwin') execFile('open', [ord.json.redirect_url], () => {});

  // 4. Confirmation: signed webhook or GET order, whichever comes first
  emit({ type: 'info', title: 'awaiting confirmation · webhook or order status' });
  let stopPolling = false;
  const seenFailures = new Set();
  const poll = (async () => {
    while (!stopPolling) {
      await sleep(POLL_MS, signal);
      if (stopPolling) return null;
      const g = await call('GET', `/api/pay/v1/orders/${orderId}`, { token, signal }).catch(() => null);
      const d = g && g.ok && g.json.data;
      if (!d) continue;
      for (const p of d.payments || []) {
        if (p.status === 'FAILED' && !seenFailures.has(p.id)) {
          seenFailures.add(p.id);
          emit({ type: 'response', title: `payment attempt failed · ${paymentError(p)}`, endpoint: ep('GET', `/api/pay/v1/orders/${orderId}`), http: g.status, body: `Can be retried on the same page (${d.payment_retries_remaining ?? '?'} retries left)`, json: { order_id: d.order_id, status: d.status, payment: { id: p.id, status: p.status, payment_method: p.payment_method, error_detail: p.error_detail } } });
        }
      }
      if (FINAL.includes(d.status)) return { via: 'status', json: g.json, status: d.status };
    }
    return null;
  })();
  const hook = webhook.then((w) => ({ via: 'webhook', ...w, status: w.data.status }));
  const aborted = new Promise((_, reject) => signal && signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true }));
  let done;
  try {
    done = await Promise.race([hook, poll, aborted]);
  } finally {
    stopPolling = true;
    pending = null;
  }
  if (!done) throw new Error('no confirmation');

  if (done.via === 'webhook') {
    const sig = done.verified ? 'signature verified' : `signature NOT verified (${done.reason})`;
    emit({ type: 'response', title: `webhook: ${done.event_type || done.status} · ${sig}`, endpoint: 'POST /webhooks/pinelabs', json: { event_type: done.event_type, data: done.data } });
  } else {
    emit({ type: 'response', title: `order status: ${done.status}`, endpoint: ep('GET', `/api/pay/v1/orders/${orderId}`), http: 200, json: done.json });
  }

  const ok = done.status === 'PROCESSED';
  return {
    events: [],
    statePatch: ok ? mandatePatch : {},
    artifacts: {},
    result: { status: done.status, order_id: orderId, confirmed_via: done.via }
  };
}

/* ---------------- run(ctx) ---------------- */
export async function run(ctx) {
  if (ctx.mode === 'replay') return replay(ctx);

  // Record every event with its offset so replay can keep the rhythm.
  const recorded = [];
  const t0 = Date.now();
  const emit = (e) => {
    const evt = { source: 'pinelabs', label: LABEL, ...e };
    ctx.emit(evt);
    if (!evt.live_only) recorded.push({ dt_ms: Date.now() - t0, ...evt, json: evt.json ? maskSecrets(evt.json) : undefined });
  };
  const r = await live(ctx, emit);
  if (PAID.includes(r.result.status)) {
    const file = writeCache(CACHE, { recorded_at: new Date().toISOString(), base: base(), payment: paymentMode(), events: recorded, pay_info: r.payInfo, statePatch: r.statePatch, result: r.result });
    console.log(`  · pinelabs: saved ${file}`);
  }
  const { payInfo, ...out } = r;
  return out;
}

async function replay(ctx) {
  const cached = readCache(CACHE);
  if (!cached) throw new Error('no cache/pinelabs.json yet (run `node server/integrations/pinelabs.js --live`)');
  let prev = 0;
  let paid = false;
  let result = cached.result;
  for (const e of cached.events) {
    const { dt_ms: dt = prev, ...evt } = e;
    if (evt.pay_part) {
      // The payment window is interactive, so it is opened again rather than replayed.
      if (!paid && cached.pay_info) {
        paid = true;
        const conf = await simulatedPayment(cached.pay_info, (x) => ctx.emit({ source: 'pinelabs', ...x }), ctx.signal);
        result = { ...cached.result, payment_id: conf.payment_id, confirmed_via: conf.confirmed_by };
      }
      continue;
    }
    await sleep(Math.min(Math.max(dt - prev, 0), REPLAY_MAX_GAP_MS), ctx.signal);
    prev = dt;
    ctx.emit({ ...evt, recorded_at: cached.recorded_at });
  }
  // statePatch is recomputed from the current state; the cached result stays as recorded.
  const amountInr = cached.result && PAID.includes(cached.result.status) ? Number(ctx.state.order.price_inr) : 0;
  return {
    events: [],
    statePatch: amountInr ? { mandate: { used: ctx.state.mandate.used + amountInr, lastDebit: `₹${amountInr} · Apollo` } } : {},
    artifacts: {},
    result
  };
}

/* ---------------- CLI ---------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(join(ROOT, '.env')); } catch { /* replay works without .env */ }
  const mode = process.argv.includes('--live') ? 'live' : 'replay';
  const state = JSON.parse(readFileSync(join(ROOT, 'data', 'state.initial.json'), 'utf8'));
  const print = (e) => {
    console.log(`${e.label} ${e.type.padEnd(9)} ${e.title}${e.body ? ` — ${e.body}` : ''}`);
    if (e.json && process.argv.includes('--json')) console.log(JSON.stringify(maskSecrets(e.json), null, 2));
  };
  if (mode === 'live' && missingEnv().length) {
    console.error(`Missing in .env: ${missingEnv().join(', ')}`);
    process.exit(1);
  }
  console.log(`pinelabs · ${mode} · ${base()}${mode === 'live' ? ` · payment: ${paymentMode()}` : ''}\n`);
  run({ state, mode, phase: 'execute', step: { step: 'create_order', amount_inr: state.order.price_inr }, emit: print, signal: AbortSignal.timeout(10 * 60 * 1000) })
    .then((r) => { console.log(`\nresult: ${JSON.stringify(r.result)}`); process.exit(PAID.includes(r.result.status) ? 0 : 2); })
    .catch((e) => { console.error(`\nfailed: ${e.message}`); process.exit(1); });
}
