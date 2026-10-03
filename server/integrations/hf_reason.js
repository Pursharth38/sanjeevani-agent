// Hugging Face agent reasoning (beat 6).
//
// CLI:
//   node server/integrations/hf_reason.js --live             → cache/hf_reason.json
//   node server/integrations/hf_reason.js --live --escalate  → cache/hf_reason_escalate.json
//
// The CLI re-runs the model (up to 5 attempts) until the output validates, then saves the
// first valid run UNEDITED with the model id, timestamp and raw response. run() only reads it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';
const MODEL = process.env.HF_REASON_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507';
const MAX_ATTEMPTS = 5;

const SYSTEM_PROMPT = `You are Sanjeevani, a family health agent acting for a caregiver.

Rules you must follow:
- Routine care is: a refill of an EXISTING prescription at the USUAL pharmacy within the monthly mandate cap,
  and booking a follow-up that is due with the patient's EXISTING doctor.
  → you may act, but inform the caregiver FIRST: notify_caregiver comes before any other action, and the
    caregiver gets a 10-minute window to reply HOLD before anything runs.
- Anything new (new medicine, new pharmacy, new doctor, over cap) → do NOT act; escalate to the caregiver,
  or to the backup if the caregiver is away.
- Away mode: an away caregiver is travelling but still reads WhatsApp. Routine care continues as normal
  (notify_caregiver first, then act); only new things go to the backup.
- Never diagnose or interpret test results. You may suggest the caregiver "mention a trend to the doctor".
- The elderly parent is told ONLY about completed outcomes: notify_parent is the last step, runs after
  delivery, and describes only what has already happened. Never send them pending actions.
- Use only these tools: notify_caregiver, escalate_to_backup, book_appointment (gnani_call),
  create_order (pinelabs), route_delivery (delhivery), notify_parent (gnani_tts).

Return ONLY JSON, with the plan steps listed in the order you will run them:
{
  "reasoning": ["short sentence", "..."],
  "decision": "act_and_inform" | "escalate",
  "plan": [{ "step": "<tool>", ...args }]
}`;

const ACTIONS = ['book_appointment', 'create_order', 'route_delivery', 'notify_parent'];
const PENDING = /\b(will|soon|going to|pending|scheduled to|on (its|the) way)\b/i;

// The state facts at beat 5, as in the plan (section 9).
const CASES = {
  main: {
    cache: 'hf_reason.json',
    user: `Patient: Maa, 68, Lucknow (226001). Caregiver: Pursharth, AWAY until Sun 11 Oct. Backup: Rohan.
Medicine: Amlodipine 5mg OD — existing prescription, 3 days of stock left. Usual pharmacy: Apollo Lucknow.
Price ₹184. Mandate: medicines & tests, cap ₹3,000/month, ₹1,000 used.
Follow-up with Dr. Mehta (Cardiology) is due; not booked.
Trend: HbA1c 6.8, 6.9, 7.1, 7.2, 7.4 (last 5 readings).
Decide what to do now.`,
    validate: (out) => {
      if (out.decision !== 'act_and_inform') return `decision is "${out.decision}", expected act_and_inform`;
      const steps = out.plan.map((p) => p.step);
      for (const s of ['notify_caregiver', 'book_appointment', 'create_order', 'route_delivery', 'notify_parent']) {
        if (!steps.includes(s)) return `plan is missing ${s}`;
      }
      if (steps.at(-1) !== 'notify_parent') return 'notify_parent is not the last step';
      // Inform before acting: the HOLD window has to come before any action runs.
      const informed = steps.indexOf('notify_caregiver');
      const firstAction = steps.findIndex((s) => ACTIONS.includes(s));
      if (informed > firstAction) return `${steps[firstAction]} runs before notify_caregiver`;
      if (steps.includes('escalate_to_backup')) return 'act_and_inform plan also escalates';
      // The parent hears only completed outcomes.
      const parentText = JSON.stringify(out.plan.at(-1));
      if (PENDING.test(parentText)) return 'notify_parent message describes a pending action';
      return null;
    },
  },
  escalate: {
    cache: 'hf_reason_escalate.json',
    user: `Patient: Maa, 68, Lucknow (226001). Caregiver: Pursharth, AWAY until Sun 11 Oct. Backup: Rohan.
Medicine: Rosuvastatin 10mg — NEW prescription from Dr. Rao, not taken before. Usual pharmacy: Apollo Lucknow.
Mandate: medicines & tests, cap ₹3,000/month, ₹1,000 used.
Decide what to do now.`,
    validate: (out) => {
      if (out.decision !== 'escalate') return `decision is "${out.decision}", expected escalate`;
      if (!out.plan.some((p) => p.step === 'escalate_to_backup')) return 'plan is missing escalate_to_backup';
      const acted = out.plan.find((p) => ACTIONS.includes(p.step));
      if (acted) return `escalate plan still acts (${acted.step})`;
      return null;
    },
  },
};

const DIAGNOSTIC_WORDS = ['abnormal', 'diabetic', 'diabetes', 'dose change', 'change the dose', 'high risk', 'uncontrolled', 'prediabet'];

// Returns { parsed } or { error }. Strips a ```json fence if the model added one; the raw text is saved as-is.
function parseAndValidate(raw, validate) {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    return { error: 'not valid JSON' };
  }
  if (!Array.isArray(out.reasoning) || !Array.isArray(out.plan)) return { error: 'missing reasoning[] or plan[]' };
  const reasoning = out.reasoning.join(' ').toLowerCase();
  const bad = DIAGNOSTIC_WORDS.find((w) => reasoning.includes(w));
  if (bad) return { error: `reasoning contains diagnostic word "${bad}"` };
  const err = validate(out);
  return err ? { error: err } : { parsed: out };
}

async function callModel(userMessage) {
  const body = {
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HF ${res.status}: ${JSON.stringify(json)?.slice(0, 300)}`);
  return { request: body, response: json };
}

async function runLive(caseName) {
  const c = CASES[caseName];
  const rejected = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { request, response } = await callModel(c.user);
    const raw = response.choices?.[0]?.message?.content ?? '';
    const { parsed, error } = parseAndValidate(raw, c.validate);
    if (error) {
      console.log(`attempt ${attempt}: rejected (${error})`);
      rejected.push({ attempt, reason: error, raw });
      continue;
    }
    const record = {
      model: response.model || MODEL,
      requested_model: MODEL,
      endpoint: ENDPOINT,
      timestamp: new Date().toISOString(),
      case: caseName,
      attempt,
      rejected_attempts: rejected,
      request,
      raw,
      parsed,
      response,
    };
    const file = path.join(ROOT, 'cache', c.cache);
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
    console.log(`attempt ${attempt}: valid → ${path.relative(ROOT, file)} (${record.model})`);
    return record;
  }
  throw new Error(`no valid run in ${MAX_ATTEMPTS} attempts`);
}

function readJson(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function eventsFrom(record, beat) {
  const n = String(beat).padStart(2, '0');
  const escalate = readJson('cache/hf_reason_escalate.json');
  const events = [
    {
      id: `evt_${n}01`,
      beat,
      t: '2026-10-06T09:58:20+05:30',
      source: 'hf',
      label: 'LIVE',
      type: 'stream',
      title: `Reasoning · Hugging Face · ${record.requested_model ?? record.model}`,
      body: `Recorded run · ${record.timestamp}`,
      stream: record.parsed.reasoning.join('\n'),
    },
    {
      id: `evt_${n}02`,
      beat,
      t: '2026-10-06T09:58:31+05:30',
      source: 'hf',
      label: 'LIVE',
      type: 'plan',
      title: `Plan · ${record.parsed.decision} · ${record.parsed.plan.length} steps`,
      json: { decision: record.parsed.decision, plan: record.parsed.plan },
    },
  ];
  if (escalate) {
    events.push({
      id: `evt_${n}03`,
      beat,
      t: '2026-10-06T09:58:40+05:30',
      source: 'hf',
      label: 'LIVE',
      type: 'info',
      title: 'Same agent, different case: a new medicine → escalates to Rohan',
      body: escalate.parsed.reasoning.join(' '),
      json: { model: escalate.requested_model ?? escalate.model, decision: escalate.parsed.decision, plan: escalate.parsed.plan },
    });
  }
  return events;
}

export async function run(ctx) {
  const beat = ctx.beat ?? 6;
  let record = readJson('cache/hf_reason.json');
  if (!record && ctx.mode === 'live') record = await runLive('main');
  if (!record) return readJson('fixtures/hf_reason.json');
  return { events: eventsFrom(record, beat), statePatch: {}, artifacts: {} };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env; rely on the environment */ }
  if (!process.argv.includes('--live')) {
    console.log('Usage: node server/integrations/hf_reason.js --live [--escalate]');
    process.exit(1);
  }
  if (!process.env.HF_TOKEN) {
    console.error('HF_TOKEN is not set (add it to .env)');
    process.exit(1);
  }
  runLive(process.argv.includes('--escalate') ? 'escalate' : 'main').catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
