# Sanjeevani Demo — Team Split & Merge Plan

**Team:** Pursharth (P) and Kavish (K).

**Read with:** `sanjeevani-agent-demo-plan.md` (the 13 beats, the real-vs-scripted table, the integrations), `sanjeevani-dashboard-spec.md`, `design.md` and `sanjeevani-logo.png`.

**Goal:** both people build in parallel without touching each other's files, then merge in one step, dry-run, and record.

---

## 1. Who owns what

The proposed split gave P five pieces and K three small ones, and left four shared pieces with no owner (the orchestrator, the agent console, dashboard wiring, and the cue page). Without an owner for those, the merge breaks. Balanced version:

| Area | Owner | Why |
|---|---|---|
| Hugging Face OCR sample run (beat 2) | **P** | as proposed |
| Hugging Face agent reasoning (beat 6) | **P** | as proposed |
| Onboarding animation (beats 1–3) | **P** | as proposed |
| WhatsApp script + cue page | **P** | P writes the messages; the cue page is tiny |
| Gnani clinic call (beat 8) + Hindi TTS voice note (beat 11) | **P** | highest-risk item, so start it first |
| Pine Labs order + payment + webhook (beat 9) | **K** | as proposed |
| Delhivery pincode check (beat 10) | **K** | as proposed |
| FHIR bundle + ABHA "push" (beat 3) | **K** | as proposed |
| **Orchestrator core** (beats runner, `state.json`, SSE, controls, replay cache) | **K** | K's integrations are lighter, and the orchestrator is the glue |
| **Agent console UI** (renders every event type) | **K** | it renders P's events from fixtures P supplies |
| **Dashboard ↔ `state.json` wiring** (patch per beat) | **K** | the dashboard is already built; this is wiring only |
| Final recording and edit | P records, K operates the laptop | see section 8 |

**Estimated load:** P about 6.5h, K about 6.5h.

---

## 2. Shared contracts (agree these in the first 30 minutes, together)

Everything below is fixed before anyone splits off. **If a contract needs to change later, message the other person first.**

### 2.1 Repo and folder ownership

```
sanjeevani-demo/
  server/
    orchestrator.js          K
    beats.js                 K   (calls modules below; never edits them)
    state.js                 K
    cache.js                 K
    integrations/
      gnani.js               P
      hf_ocr.js              P
      hf_reason.js           P
      pinelabs.js            K
      delhivery.js           K
      fhir.js                K
  web/
    dashboard/               K (wiring only; don't restyle)
    console/                 K
    onboarding/              P
    cue/                     P
  data/
    state.initial.json       K
    beats/                   K   (state patch per beat: beat01.json … beat13.json)
    docs/                    P   (4 demo document images)
    audio/                   P   (clinic_call.mp3, maa_voice_note.mp3)
    whatsapp_script.json     P
  cache/                     written by each module's CLI (one file per beat)
  fixtures/                  shared fake outputs, used until the real ones exist
  .env.example               both
```

**Rule:** only edit files you own. The only shared files are `fixtures/` and `.env.example`.

### 2.2 The module contract (every integration follows this)

Each integration file exports one function and also runs on its own from the command line:

```js
// server/integrations/<name>.js
export async function run(ctx) {
  // ctx = { state, mode: "live" | "replay", beat }
  return {
    events: [ /* console events, see 2.3 */ ],
    statePatch: { /* partial state.json changes, or {} */ },
    artifacts: { /* optional file paths, e.g. { audio: "data/audio/maa_voice_note.mp3" } */ }
  };
}

// CLI: `node server/integrations/<name>.js --live`
//   → calls the real API once and writes cache/<name>.json
// In replay mode, run() reads cache/<name>.json and makes no network call.
```

The orchestrator only ever calls `run(ctx)`. **This is what makes the merge a drop-in.**

### 2.3 Console event schema

```json
{
  "id": "evt_0907",
  "beat": 9,
  "t": "2026-10-06T10:13:04+05:30",
  "source": "pinelabs | gnani | hf | delhivery | whatsapp | agent | abha",
  "label": "LIVE | SANDBOX | SCRIPTED | SAMPLE RUN | SIMULATED | CACHED",
  "type": "info | request | response | stream | transcript | countdown | audio | ocr_card | plan | checklist_tick",
  "title": "Order created · ₹184",
  "body": "optional one-line detail",
  "json": { "optional": "request or response payload, secrets masked" },
  "stream": "optional text to type out (reasoning)",
  "lines": [ { "speaker": "Agent", "text": "..." } ],
  "src": "optional media path"
}
```

**Event types each person produces:**
- **P:** `ocr_card` · `stream` + `plan` (reasoning) · `transcript` + `audio` (Gnani) · `whatsapp` info rows
- **K:** `request` / `response` (Pine Labs, Delhivery, ABHA) · `countdown` · `checklist_tick`

### 2.4 `state.json` schema

Use the schema in `sanjeevani-agent-demo-plan.md` section 3 and the dashboard spec's section 10, with the canonical dates from the plan. K owns the file; P only reads it.

**P's modules may return a `statePatch`** (e.g. Gnani sets `next_appointment.status = "confirmed"`). K's orchestrator merges it.

### 2.5 Fixtures, created in the first 30 minutes

Each person drops **fake** outputs into `fixtures/`, matching the schema, so the other can build against them immediately:

| Fixture | Created by | Used by |
|---|---|---|
| `fixtures/hf_ocr.json` · `hf_reason.json` · `gnani_call.json` · `gnani_tts.json` | P | K's console |
| `fixtures/pinelabs.json` · `delhivery.json` · `fhir.json` | K | K's console, plus P can preview |

When the real `cache/<name>.json` exists, it replaces the fixture. No code changes.

---

## 3. Pursharth's task list

| # | Task | Done when | Time |
|---|---|---|---|
| P1 | **Gnani clinic call:** create the voice agent on Gnani's platform (goal and script in the demo plan, section 9). Do an outbound test call to K's phone (K plays the receptionist). | A real call completes. The transcript and recording are saved to `cache/gnani_call.json` and `data/audio/clinic_call.mp3`. `gnani.js` returns `transcript` + `audio` events and a statePatch that confirms Sat 10 Oct 11:00. | 2h |
| P2 | **Gnani Hindi TTS voice note** (script in plan section 5) | `data/audio/maa_voice_note.mp3` exists; `gnani.js --tts` writes `cache/gnani_tts.json` and emits an `audio` event | 30m |
| P3 | **HF OCR sample:** `hf_ocr.js` on one clearly written prescription | `cache/hf_ocr.json` holds the real model JSON plus the model id; the module emits one `ocr_card` event labelled `SAMPLE RUN` | 30m |
| P4 | **HF reasoning:** `hf_reason.js` with the validation loop (plan section 9) | `cache/hf_reason.json` is the first valid run, unedited. It emits `stream` (reasoning) and `plan` events. Optional: `cache/hf_reason_escalate.json`. | 45m |
| P5 | **Demo documents:** make the 4 documents match the dashboard data, plus the cropped "Amlodipine/Amlokind" image | `data/docs/` contains 4 images and the crop | 30m |
| P6 | **WhatsApp script:** every message in `data/whatsapp_script.json`, keyed by beat, with attachment paths and "waiting for caregiver reply" flags | The wording matches the plan exactly | 20m |
| P7 | **Cue page** `/cue`: subscribes to the orchestrator's beat stream and shows the current message, a Copy button and an attachment hint | It advances when K's orchestrator advances (works against a mocked stream first) | 40m |
| P8 | **Onboarding animation** (plan section 7): a standalone component that receives a `start` signal at beat 1, a `confirm` signal at beat 3, and fires an `assembled` callback | It runs standalone with fixture data; K mounts it over the dashboard | 1.5h |

**P's order:** P1 → P2 (Gnani first, while support hours exist) → P3 → P4 → P5 → P6 → P8 → P7.

---

## 4. Kavish's task list

| # | Task | Done when | Time |
|---|---|---|---|
| K1 | **Pine Labs UAT:** `pinelabs.js` does token, then order (₹184 = 18400 paise), then payment with test credentials, then catches the webhook (ngrok or webhook.site) | `cache/pinelabs.json` holds the real request/response pairs plus the `PROCESSED` webhook. It emits `request`/`response` events (`SANDBOX`, secrets masked) and patches the mandate (₹1,000 → ₹1,184), the stepper (to Paid) and two log rows. | 1.5h |
| K2 | **Delhivery:** `delhivery.js` pincode check for 226001 | It emits a request/response, `LIVE` if a token is available, otherwise `CACHED`, and patches the stepper to "Shipped · Local partner · Tier-2" | 20m |
| K3 | **FHIR + ABHA:** `fhir.js` builds an R4 Bundle (Patient plus 3 MedicationRequests) from the demo medicines | It emits a `response` event with the bundle JSON plus an `abha.push` event labelled `SIMULATED`, and patches records-on-ABHA to 18 | 30m |
| K4 | **Orchestrator core** | Covers all of: `beats.js` with beats 0–13 calling the right modules, each beat merging its patch from `data/beats/` plus the module statePatches into `state.json`; SSE streams (`/events` for the console, `/cue-stream` for the cue page); keyboard and HTTP controls (`Space`/`POST /next`, `R`, jump keys, `P`); `MODE=live|replay`; and fixture → cache → live fallback per module | 1.5h |
| K5 | **Beat state patches** `data/beats/beat01.json` … `beat13.json` | The end state matches the plan's "Done when" list exactly | 45m |
| K6 | **Agent console UI** (plan section 8): renders every event type in 2.3, with source chips, labels, expandable JSON, streaming text, the countdown and an audio player | It renders all fixtures correctly before any real data exists | 1.5h |
| K7 | **Dashboard wiring:** the dashboard polls `state.json` once a second and re-renders the affected cards. Mount P's onboarding overlay at beats 1–3. | Stepping through the beats changes the dashboard exactly as in the plan's beat table | 45m |

**K's order:** K4 (skeleton first, so P can test the cue page against it) → K1 → K6 → K5 → K7 → K3 → K2.

---

## 5. Timeline and merge checkpoints

| Time | What happens |
|---|---|
| **Kickoff, together (30m)** | Create the repo with the folder skeleton and `.env.example`. Agree contracts 2.2–2.4. Each person commits their fixtures. |
| Parallel block 1 (~3h) | P: Gnani + TTS + HF runs. K: orchestrator skeleton + Pine Labs + console. |
| **Checkpoint 1, together (20m)** | P's `cache/*.json` and K's `cache/*.json` exist. K runs beats 0→13 in `MODE=replay` with the console only; confirm every event renders. Fix any schema mismatches **now**. |
| Parallel block 2 (~2.5h) | P: documents, script, onboarding animation, cue page. K: beat patches, dashboard wiring, FHIR, Delhivery. |
| **Checkpoint 2: merge (45m)** | Merge into `main` (section 6). Do a full dry run: dashboard, console, cue page and onboarding all in sync. |
| Dry run with phones (30m) | Real WhatsApp sends from the friend's number, using the cue page, plus scrcpy mirroring of P's phone |
| **Record (1.5h)** | Beat by beat, then one full replay take as a backup |

---

## 6. Git workflow

- **Branches:** `main` (merge only at checkpoints), `pursharth` (P's work) and `kavish` (K's work).
- **No overlapping files** (folder ownership in 2.1), so merges should be conflict-free.
- **Commit cache files and audio.** The recording depends on them. Never commit `.env` or secrets.
- **Before each checkpoint:** pull `main`, run `MODE=replay npm run demo`, and make sure beats 0→13 complete with no errors.

---

## 7. Risks and fallbacks

| Risk | Owner | Fallback |
|---|---|---|
| Gnani outbound call can't be configured | P | Record a real Gnani agent conversation in their playground and replay it labelled `LIVE · recorded` |
| Pine Labs UAT credentials or webhook delayed | K | Show token + order request/response; label payment completion "UAT · pending webhook". Do not fake `PROCESSED`. |
| HF model not available on the free tier | P | Use any vision or instruct model that is available; record the model id honestly |
| No Delhivery token | K | Use a saved response labelled `CACHED` |
| Schema mismatch at merge | both | Fixtures are the contract; whoever deviated from them fixes it |
| WhatsApp send out of sync while recording | P | Record beat by beat; the cue page tells the friend exactly when and what to send |

---

## 8. Recording roles

| Person | Role |
|---|---|
| **Friend** | Sends the "Sanjeevani" WhatsApp messages from their phone, using the cue page (off camera) |
| **P** | Holds the caregiver phone (mirrored via scrcpy) and types the caregiver replies; runs screen recording |
| **K** | Drives the laptop (`Space` per beat) and plays the clinic receptionist on beat 8's Gnani call |

**Final check before recording:** run through the "Done when" list in `sanjeevani-agent-demo-plan.md` section 12.
