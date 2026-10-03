// Gnani: the clinic booking call (beat 8) and Maa's Hindi voice note (beat 11).
//
// CLI:
//   node server/integrations/gnani.js --tts    real Gnani TTS (hi-IN) → data/audio/maa_voice_note.mp3
//                                             + cache/gnani_tts.json
//   node server/integrations/gnani.js --import <transcript.txt> [--date YYYY-MM-DD] [--audio <file>]
//                                             a call placed from the Gnani dashboard: saves the transcript
//                                             copied from Conversation logs (verbatim) → cache/gnani_call.json
//   node server/integrations/gnani.js --call   real outbound call from the Inya agent to CLINIC_PHONE (a
//                                             whitelisted number); waits for it to end, then saves the
//                                             transcript → cache/gnani_call.json, recording → data/audio/clinic_call.mp3
//
// run(ctx): ctx.step "book_appointment" or beat 8 → the call; "notify_parent" or beat 11 → the voice note.
// Live mode places the call for real (and generates the voice note if missing). Replay reads the cache,
// falling back to the fixture.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TTS_ENDPOINT = 'https://api.vachana.ai/api/v1/tts/inference';
const TTS_MODEL = 'timbre-v2.5';
const TTS_VOICE = process.env.GNANI_TTS_VOICE || 'Nalini';
const TTS_LANGUAGE = 'hi-IN';
const VOICE_NOTE = 'data/audio/maa_voice_note.mp3';
const APPT = '2026-10-10T11:00:00+05:30';

const INYA = 'https://api.inya.ai/platform/v1';
const INYA_ENV = 'development';
const CALL_AUDIO = 'data/audio/clinic_call.mp3';
const CALL_NAME = "Dr. Mehta's clinic";
const POLL_MS = 5000;
const CALL_TIMEOUT_MS = 6 * 60 * 1000;
const STORY_CALL_START = Date.parse('2026-10-06T10:09:00+05:30');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const maskPhone = (s) => String(s).replace(/\d(?=\d{3})/g, '•');
const storyTime = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().replace(/\.\d+Z$/, '+05:30');

// The plan's voice-note script (section 5), in Devanagari. The weekday comes from the appointment date.
// The note credits the family member, not the system.
function voiceNoteText() {
  const weekday = new Intl.DateTimeFormat('hi-IN', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(new Date(APPT));
  const hour = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date(APPT)));
  const dayPart = hour < 12 ? 'सुबह' : hour < 17 ? 'दोपहर' : 'शाम';
  const clock = hour % 12 || 12;
  return `नमस्ते माँ। आपकी बीपी की दवाई आ गई है। ${weekday} ${dayPart} ${clock} बजे डॉक्टर मेहता के पास आपका अपॉइंटमेंट है। पुरुषार्थ ने यह सब इंतज़ाम कर दिया है।`;
}

function readJson(rel) {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

async function synthesize() {
  const text = voiceNoteText();
  const request = {
    text,
    voice: TTS_VOICE,
    model: TTS_MODEL,
    language: TTS_LANGUAGE,
    speed: 0.95,
    audio_config: { container: 'mp3', sample_rate: 44100, num_channels: 1, bitrate: '128k' },
  };
  const res = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key-ID': process.env.GNANI_API_KEY },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`Gnani TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const audio = Buffer.from(await res.arrayBuffer());

  fs.writeFileSync(path.join(ROOT, VOICE_NOTE), audio);
  const record = {
    endpoint: TTS_ENDPOINT,
    timestamp: new Date().toISOString(),
    request,
    response: { status: res.status, content_type: res.headers.get('content-type'), bytes: audio.length },
    audio: VOICE_NOTE,
  };
  fs.writeFileSync(path.join(ROOT, 'cache/gnani_tts.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`saved → ${VOICE_NOTE} (${audio.length} bytes, ${record.response.content_type}) + cache/gnani_tts.json`);
  return record;
}

function ttsEvents(record, beat) {
  return {
    events: [{
      id: `evt_${String(beat).padStart(2, '0')}g1`,
      beat,
      t: '2026-10-08T15:40:12+05:30',
      source: 'gnani',
      label: 'LIVE',
      type: 'audio',
      title: `gnani.tts · ${record.request.language} · ${record.request.model} · voice note for Maa`,
      body: record.request.text,
      src: record.audio,
      json: { request: record.request, response: record.response },
    }],
    statePatch: {},
    artifacts: { audio: record.audio },
  };
}

// ---- clinic call (Inya platform API) ----------------------------------------

async function inya(method, pathAndQuery, body) {
  const res = await fetch(`${INYA}${pathAndQuery}`, {
    method,
    headers: { 'x-api-key': process.env.INYA_API_KEY, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return res;
}

async function inyaJson(method, pathAndQuery, body) {
  const res = await inya(method, pathAndQuery, body);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Inya ${method} ${pathAndQuery.split('?')[0]} → ${res.status}: ${json?.message ?? 'no body'}`);
  return json;
}

function splitPhone(full) {
  // The national number is the last 10 digits (India); everything before it is the country code.
  const m = String(full).replace(/[\s-]/g, '').match(/^\+(\d{1,3})(\d{10})$/);
  if (!m) throw new Error('CLINIC_PHONE must look like +91XXXXXXXXXX');
  return { countryCode: `+${m[1]}`, phone: m[2] };
}

// Places the call, waits for it to end, then saves the transcript and recording.
async function placeCall(emit = () => {}) {
  const botId = process.env.GNANI_AGENT_ID;
  const { countryCode, phone } = splitPhone(process.env.CLINIC_PHONE);
  const triggerRequest = { phone, countryCode, name: CALL_NAME, clientReferenceId: `SNJ-APPT-${Date.now()}` };
  const startedAt = Date.now();
  const trigger = await inyaJson('POST', `/agents/${botId}/trigger_call?environment=${INYA_ENV}`, triggerRequest);
  const shownRequest = { ...triggerRequest, phone: maskPhone(phone) };
  emit(callTriggerEvent({ request: shownRequest, response: trigger }));
  console.log(`call triggered (${trigger.requestId}); waiting for it to end…`);

  // Find this call in the logs once it has an end time.
  let convo;
  for (const deadline = Date.now() + CALL_TIMEOUT_MS; !convo; await sleep(POLL_MS)) {
    if (Date.now() > deadline) throw new Error('call did not finish within 6 minutes');
    const logs = await inyaJson('POST', `/conversations/logs?environment=${INYA_ENV}&botId=${botId}`, {
      pageNo: 1,
      pageSize: 10,
      filter: { botId, startDate: new Date(startedAt - 60e3).toISOString() },
    });
    convo = logs.response?.data?.find((c) => c.startTime * 1000 >= startedAt - 30e3 && c.endTime);
  }

  // Stats carry the full transcript; analytics can lag the end of the call by up to a minute.
  let stats;
  for (let i = 0; i < 24; i++, await sleep(POLL_MS)) {
    const json = await inyaJson('GET', `/conversations/${convo.conversationId}/stats`);
    stats = json.response?.[0];
    if (stats?.callStatus && stats.callStatus !== 'ANSWERED') break;
    if (stats?.utteranceAnalytics?.length) break;
  }
  if (!stats) throw new Error('no stats for the call');

  let audioSaved = null;
  for (let i = 0; i < 12 && stats.callStatus === 'ANSWERED'; i++, await sleep(POLL_MS)) {
    const res = await inya('GET', `/conversations/${convo.conversationId}/audio`);
    if (res.ok) {
      fs.writeFileSync(path.join(ROOT, CALL_AUDIO), Buffer.from(await res.arrayBuffer()));
      audioSaved = CALL_AUDIO;
      break;
    }
  }

  const record = {
    endpoint: INYA,
    environment: INYA_ENV,
    botId,
    timestamp: new Date().toISOString(),
    trigger: { request: shownRequest, response: trigger },
    conversationId: convo.conversationId,
    stats,
    audio: audioSaved,
  };
  // Only an answered call replaces the saved one, so a missed call mid-recording can't wipe a good take.
  if (stats.callStatus !== 'ANSWERED') {
    console.log(`call ${stats.callStatus}; cache/gnani_call.json left unchanged`);
    return record;
  }
  fs.writeFileSync(path.join(ROOT, 'cache/gnani_call.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`saved → cache/gnani_call.json (${stats.callDuration}s, ${stats.utteranceAnalytics?.length ?? 0} turns)` +
    (audioSaved ? ` + ${audioSaved}` : ' (no recording available)'));
  return record;
}

// trigger is { request, response } for an API call, or { via } for a call placed from the dashboard.
function callTriggerEvent(trigger) {
  return {
    id: 'evt_08g1',
    beat: 8,
    t: storyTime(STORY_CALL_START),
    source: 'gnani',
    label: 'LIVE',
    type: 'request',
    title: `gnani.call → ${CALL_NAME}`,
    body: trigger.via ? `Outbound call · Inya voice agent · recorded (${trigger.via})` : 'Outbound call · Inya voice agent',
    json: trigger.via
      ? { via: trigger.via }
      : { request: { url: `${INYA}/agents/{botId}/trigger_call`, ...trigger.request }, response: trigger.response },
  };
}

// The slot is only announced if the transcript itself shows it; nothing is assumed.
function callEvents(record) {
  const s = record.stats;
  const turns = s.utteranceAnalytics ?? [];
  const offset = (ts) => STORY_CALL_START + (ts - s.startTime) * 1000;
  const events = [callTriggerEvent(record.trigger)];

  if (s.callStatus !== 'ANSWERED') {
    events.push({ id: 'evt_08g2', beat: 8, t: storyTime(STORY_CALL_START), source: 'gnani', label: 'LIVE', type: 'info', title: `Call not answered (${s.callStatus})` });
    return { events, statePatch: {}, artifacts: {} };
  }

  events.push({
    id: 'evt_08g2',
    beat: 8,
    t: storyTime(offset(turns[0]?.timestamp ?? s.startTime)),
    source: 'gnani',
    label: 'LIVE',
    type: 'transcript',
    title: s.callDuration ? `Call transcript · ${s.callDuration}s` : 'Call transcript',
    lines: turns.map((u) => ({ speaker: u.role === 'assistant' ? 'Agent' : 'Clinic', text: u.content })),
    json: { conversationId: record.conversationId, callStatus: s.callStatus, disposition: s.overallCallDisposition },
  });
  if (record.audio) {
    events.push({ id: 'evt_08g3', beat: 8, t: storyTime(offset(s.endTime)), source: 'gnani', label: 'LIVE', type: 'audio', title: 'Call recording', src: record.audio });
  }
  const said = turns.map((u) => u.content).join(' ');
  const confirmed = /saturday|shanivaar|शनिवार/i.test(said) && /\b11\b|eleven|ग्यारह/i.test(said);
  events.push({
    id: 'evt_08g4',
    beat: 8,
    t: storyTime(offset(s.endTime)),
    source: 'gnani',
    label: 'LIVE',
    type: 'info',
    title: confirmed ? 'Slot confirmed on the call · Sat 10 Oct 11:00' : 'Call ended · see transcript for the slot',
    body: 'Dr. Mehta · Cardiology',
  });
  return { events, statePatch: {}, artifacts: record.audio ? { audio: record.audio } : {} };
}

// A call placed from the dashboard (Test → Trigger Agent Call): import the transcript copied from
// Conversation logs. The pasted text is kept verbatim in the cache; turns are parsed from it unedited.
// Format: "<speaker>\n<h:mm:ss.mmmAM>\n<text>", where the speaker is "You" (the clinic) or the agent's
// name. Text before the first speaker line is the agent's greeting.
function importCall(file, date, audioFile) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const TIME = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*([AP]M)$/i;
  const toEpoch = (m) => {
    const h = (Number(m[1]) % 12) + (m[5].toUpperCase() === 'PM' ? 12 : 0);
    const hms = `${String(h).padStart(2, '0')}:${m[2]}:${m[3]}.${(m[4] ?? '0').padEnd(3, '0').slice(0, 3)}`;
    return Date.parse(`${date}T${hms}+05:30`) / 1000;
  };

  const turns = [];
  let current = { role: 'assistant', content: '', timestamp: null };
  for (let i = 0; i < lines.length; i++) {
    const speaker = lines[i].toLowerCase();
    const isLabel = (speaker === 'you' || speaker === 'sanjeevani') && TIME.test(lines[i + 1] ?? '');
    if (isLabel) {
      if (current.content) turns.push(current);
      current = { role: speaker === 'you' ? 'user' : 'assistant', content: '', timestamp: toEpoch(lines[i + 1].match(TIME)) };
      i++;
      continue;
    }
    current.content = current.content ? `${current.content} ${lines[i]}` : lines[i];
  }
  if (current.content) turns.push(current);

  const times = turns.map((t) => t.timestamp).filter(Boolean);
  let audio = null;
  if (audioFile) {
    fs.copyFileSync(audioFile, path.join(ROOT, CALL_AUDIO));
    audio = CALL_AUDIO;
  }
  const record = {
    imported_from: 'Gnani dashboard · Conversation logs (transcript copied as shown)',
    timestamp: new Date().toISOString(),
    trigger: { via: 'triggered from the Gnani dashboard' },
    conversationId: null,
    raw_transcript: raw,
    stats: {
      callStatus: 'ANSWERED',
      callDuration: null,
      startTime: Math.min(...times),
      endTime: Math.max(...times),
      utteranceAnalytics: turns,
    },
    audio,
  };
  fs.writeFileSync(path.join(ROOT, 'cache/gnani_call.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`saved → cache/gnani_call.json (${turns.length} turns)${audio ? ` + ${audio}` : ' (no recording)'}`);
  return record;
}

// ---- run ---------------------------------------------------------------------

export async function run(ctx) {
  const step = ctx.step?.step;
  const isTts = step === 'notify_parent' || (!step && ctx.beat === 11);
  if (isTts) {
    let record = readJson('cache/gnani_tts.json');
    if (!record && ctx.mode === 'live') record = await synthesize();
    return record ? ttsEvents(record, ctx.beat ?? 11) : readJson('fixtures/gnani_tts.json');
  }
  // The clinic call: placed through the API in live mode when a platform key exists. Without one, the
  // call is triggered by hand from the Gnani dashboard and the saved real call is used, else the fixture.
  if (ctx.mode === 'live' && process.env.INYA_API_KEY) {
    const out = callEvents(await placeCall(ctx.emit));
    // The trigger row was already streamed through ctx.emit; don't return it twice.
    if (ctx.emit) out.events = out.events.filter((e) => e.id !== 'evt_08g1');
    return out;
  }
  const record = readJson('cache/gnani_call.json');
  return record ? callEvents(record) : readJson('fixtures/gnani_call.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* no .env; rely on the environment */ }
  const args = process.argv.slice(2);
  if (args.includes('--tts')) {
    if (!process.env.GNANI_API_KEY) {
      console.error('GNANI_API_KEY is not set (add it to .env)');
      process.exit(1);
    }
    console.log(`text: ${voiceNoteText()}`);
    synthesize().catch((err) => { console.error(err.message); process.exit(1); });
  } else if (args.includes('--import')) {
    // node server/integrations/gnani.js --import <transcript.txt> [--date YYYY-MM-DD] [--audio <recording.mp3>]
    const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
    const file = at('--import');
    const date = at('--date') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    if (!file) {
      console.error('Usage: node server/integrations/gnani.js --import <transcript.txt> [--date YYYY-MM-DD] [--audio <file.mp3>]');
      process.exit(1);
    }
    const record = importCall(file, date, at('--audio'));
    for (const e of callEvents(record).events) {
      console.log(`${e.label} · ${e.type} · ${e.title}`);
      for (const l of e.lines ?? []) console.log(`    ${l.speaker}: ${l.text}`);
    }
  } else if (args.includes('--agents')) {
    if (!process.env.INYA_API_KEY) {
      console.error('INYA_API_KEY is not set (add it to .env)');
      process.exit(1);
    }
    inyaJson('GET', '/agents?pageNo=1&pageSize=20')
      .then((json) => {
        const list = json.response?.data ?? json.response ?? [];
        for (const a of [].concat(list)) console.log(`${a.botId ?? a.id}  ${a.botName ?? a.name ?? ''}`);
        if (![].concat(list).length) console.log(JSON.stringify(json, null, 2).slice(0, 800));
      })
      .catch((err) => { console.error(err.message); process.exit(1); });
  } else if (args.includes('--call')) {
    const missing = ['INYA_API_KEY', 'GNANI_AGENT_ID', 'CLINIC_PHONE'].filter((k) => !process.env[k]);
    if (missing.length) {
      console.error(`missing in .env: ${missing.join(', ')}`);
      process.exit(1);
    }
    placeCall()
      .then((record) => {
        for (const e of callEvents(record).events) {
          console.log(`${e.label} · ${e.type} · ${e.title}`);
          for (const l of e.lines ?? []) console.log(`    ${l.speaker}: ${l.text}`);
        }
      })
      .catch((err) => { console.error(err.message); process.exit(1); });
  } else {
    console.log('Usage: node server/integrations/gnani.js --tts | --import <transcript.txt> | --agents | --call');
    process.exit(1);
  }
}
