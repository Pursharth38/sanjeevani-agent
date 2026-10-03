// Hugging Face OCR sample run (beat 2). Pipeline proof only: this output NEVER feeds the dashboard.
//
// CLI:
//   node server/integrations/hf_ocr.js --live [image]   → cache/hf_ocr.json
//   (image defaults to data/docs/prescription.jpg)
//
// The raw model response is saved unedited with the model id. run() only reads it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';
const MODEL = process.env.HF_OCR_MODEL || 'Qwen/Qwen2.5-VL-72B-Instruct';
const DEFAULT_IMAGE = 'data/docs/prescription.jpg';
const PROMPT = 'Extract every medicine from this prescription. Return only JSON: [{name, dose, frequency, duration, confidence_0_to_1}]. If unsure of a name, give your best reading and a low confidence.';

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function runLive(imageRel) {
  const imageFile = path.join(ROOT, imageRel);
  const mime = MIME[path.extname(imageFile).toLowerCase()];
  if (!mime) throw new Error(`unsupported image type: ${imageRel}`);
  const dataUrl = `data:${mime};base64,${fs.readFileSync(imageFile).toString('base64')}`;

  const body = {
    model: MODEL,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`HF ${res.status}: ${JSON.stringify(response)?.slice(0, 300)}`);

  const raw = response.choices?.[0]?.message?.content ?? '';
  let parsed = null;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  } catch { /* keep parsed = null; the console shows raw */ }

  const record = {
    model: response.model || MODEL,
    requested_model: MODEL,
    endpoint: ENDPOINT,
    timestamp: new Date().toISOString(),
    image: imageRel.replace(/\\/g, '/'),
    prompt: PROMPT,
    raw,
    parsed,
    response,
  };
  const file = path.join(ROOT, 'cache', 'hf_ocr.json');
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  console.log(`saved → ${path.relative(ROOT, file)} (${record.model})`);
  console.log(raw);
  return record;
}

function readJson(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

export async function run(ctx) {
  const beat = ctx.beat ?? 2;
  let record = readJson('cache/hf_ocr.json');
  if (!record && ctx.mode === 'live') record = await runLive(DEFAULT_IMAGE);
  if (!record) return readJson('fixtures/hf_ocr.json');
  return {
    events: [{
      id: `evt_${String(beat).padStart(2, '0')}01`,
      beat,
      t: '2026-10-03T10:05:20+05:30',
      source: 'hf',
      label: 'SAMPLE RUN',
      type: 'ocr_card',
      title: `Sample run · Hugging Face · ${record.requested_model ?? record.model}`,
      body: 'Pipeline proof — the demo data on the dashboard is illustrative.',
      src: record.image,
      json: record.parsed ?? record.raw,
    }],
    statePatch: {},
    artifacts: { image: record.image },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env; rely on the environment */ }
  const args = process.argv.slice(2);
  if (!args.includes('--live')) {
    console.log('Usage: node server/integrations/hf_ocr.js --live [image]');
    process.exit(1);
  }
  if (!process.env.HF_TOKEN) {
    console.error('HF_TOKEN is not set (add it to .env)');
    process.exit(1);
  }
  const image = args.find((a) => !a.startsWith('--')) || DEFAULT_IMAGE;
  runLive(image).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
