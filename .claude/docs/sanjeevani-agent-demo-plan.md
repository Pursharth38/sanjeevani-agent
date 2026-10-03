# Sanjeevani — Agentic Demo: Build Plan

**For:** the coding agent building the demo.

**Read alongside:**
- `sanjeevani-dashboard-spec.md` (the caregiver dashboard; reuse it, don't redesign it)
- `design.md` (Blend design tokens)
- `sanjeevani-logo.png`

**Today's deliverable:** a **recorded, scripted walkthrough** of one complete agent flow. It is not a live production system. Where an integration is real (Gnani, Pine Labs, one Hugging Face OCR run), it must actually run. Everything else is scripted, and labelled as scripted.

---

## 1. Aim

Show judges one use case, end to end, proving the product thesis:

> A family's health care runs on one person's memory. Sanjeevani takes that load: it reads the family's records, watches medicine stock and trends, and books and pays for care while the caregiver is away. It **tells the caregiver before acting** and tells the elderly parent **only about finished outcomes**.

**The one story:** Maa's BP medicine (Amlodipine) is about to run out and her cardiology follow-up is due, while the caregiver (Pursharth) is travelling.

**The judges must see:**
1. Records consolidated into one dashboard
2. The agent thinking and planning
3. A trust message, with a window to stop the action, before it acts
4. A **real Gnani voice call** booking the appointment
5. A **real Pine Labs sandbox order and payment**
6. Delivery routing
7. A **real Gnani Hindi voice note** for Maa, sent only after delivery
8. The caregiver landing to "0 things missed"

---

## 2. What is real and what is scripted

| Piece | Status | Notes |
|---|---|---|
| Dashboard data | **Scripted (ideal demo data)** | Driven by `state.json` |
| Onboarding animation (classify → extract → dashboard) | **Scripted** | Animation over the ideal data |
| Hugging Face OCR | **Real, one document** | Run once on one prescription and saved as `ocr_sample.json`. The console replays it as "Sample run". **Never feeds the dashboard.** |
| Agent reasoning + plan in the console | **Real (Hugging Face LLM, recorded run)** | An open model on HF gets the story state, the caregiver's limits and the tool list. It returns its reasoning and a JSON action plan. Run until valid, save as `agent_reasoning.json`, and replay in beat 6 as `LIVE · Hugging Face (recorded)`. See section 9. |
| WhatsApp messages | **Scripted** | Sent from a teammate's number saved on the caregiver's phone as "Sanjeevani", using the cue page (section 6) |
| Gnani clinic booking call | **Real** | Outbound call to a teammate acting as the clinic receptionist |
| Gnani Hindi voice note for Maa | **Real TTS audio** | Generated through Gnani, then sent on WhatsApp as audio |
| Pine Labs order + payment | **Real (UAT sandbox)** | Real requests and responses shown in the console |
| Delhivery pincode check | Real if a token is available; otherwise a saved response | Label it accordingly |
| ABHA push | **Simulated** | The FHIR JSON can be real (generated in code); the push is labelled simulated |

**Honesty rules — required in the build:**
- Every console event carries a source chip: `LIVE`, `SANDBOX`, `SCRIPTED`, `SAMPLE RUN` or `SIMULATED`.
- The recording opens with a title card: *"Scripted walkthrough of the Sanjeevani flow · Agent reasoning is real Hugging Face model output (recorded) · Gnani & Pine Labs calls are live sandbox · OCR shown is a real sample run."*

---

## 3. Canonical story data

**These values override any conflicting dates or numbers in the dashboard spec.** Compute weekday labels from the dates in code; never hardcode them.

| Item | Value |
|---|---|
| Caregiver | Pursharth (primary) |
| Backup | Rohan (brother) |
| Parent | Maa, 68, Lucknow (pincode 226001). ABHA `91-xxxx-xxxx-4821` |
| Pharmacy | Apollo Pharmacy, Lucknow |
| Doctor | Dr. Mehta, Cardiology |
| Medicines | Telmisartan 40mg OD (24 days) · Metformin 1000mg BD (11 days) · Amlodipine 5mg OD (4 days, then 3 at the trigger) |
| Trends | HbA1c 6.8 → 6.9 → 7.1 → 7.2 → 7.4 (rising) · BP stable around 132/84 · Creatinine 0.9, test due |
| Mandate | Pine Labs, medicines and tests, cap ₹3,000/month. Used ₹1,000 before the demo, ₹1,184 after. |
| Order | Amlodipine 5mg × 30, **₹184** |

The timeline is set in 2026:

| Beat | Date |
|---|---|
| Onboarding | Sat 3 Oct |
| Caregiver flies | Mon 5 Oct, back Sun 11 Oct |
| Stock trigger | Tue 6 Oct 09:58 |
| Delivery | Thu 8 Oct |
| Appointment | **Sat 10 Oct, 11:00** (booked during the demo; shows "Follow-up due · not booked" before beat 8) |
| Lands | Sun 11 Oct |

---

## 4. Architecture

```
┌─────────────────────────────┐     writes      ┌───────────────┐   polls 1s   ┌─────────────────┐
│ orchestrator (Node/Express) │ ──────────────► │  state.json   │ ◄─────────── │ Dashboard (web) │
│  - beats[] in order         │                 └───────────────┘              └─────────────────┘
│  - real API wrappers        │     pushes      ┌───────────────┐   SSE        ┌─────────────────┐
│  - replay cache             │ ──────────────► │ event stream  │ ───────────► │ Agent Console   │
│  - keyboard / HTTP control  │                 └───────────────┘              └─────────────────┘
│                             │     pushes      ┌───────────────┐   SSE        ┌─────────────────┐
│                             │ ──────────────► │ cue stream    │ ───────────► │ Cue page (phone │
└─────────────────────────────┘                 └───────────────┘              │ of teammate)    │
                                                                               └─────────────────┘
```

- **The orchestrator is the single source of truth.** One beat function does all of these together: update `state.json`, emit console events, emit the WhatsApp cue, and call the real API if the beat has one.
- **Controls:**
  - `Space` (or `POST /next`): run the next beat
  - `R`: reset to beat 0
  - `1`–`9`, `0`, `-`, `=`: jump to a beat
  - `P`: pause any typing or streaming animation
- **Replay cache:** each real call saves its response to `cache/<beat>.json` the first time it succeeds. `MODE=live` calls the real API. `MODE=replay` uses the cache, which guards against a failure mid-recording. The console chip still shows `LIVE` or `SANDBOX` in replay mode, because the response is the genuine saved one.

### Folder structure

```
sanjeevani-demo/
  server/
    orchestrator.js      # beats, controls, SSE
    beats.js             # the beat list (section 5)
    state.js             # read/patch state.json
    integrations/
      gnani.js           # outbound call + TTS (wrapper)
      pinelabs.js        # token, order, payment, webhook
      delhivery.js       # pincode serviceability
      hf_ocr.js          # one-off OCR run → ocr_sample.json
      hf_reason.js       # HF LLM reasoning run (validated) → agent_reasoning.json
      fhir.js            # build FHIR bundle from extracted fields
    cache/               # replay responses
  web/
    dashboard/           # from sanjeevani-dashboard-spec.md
    console/             # Agent Console
    cue/                 # teammate cue page
    onboarding/          # onboarding animation
  data/
    state.initial.json
    ocr_sample.json
    agent_reasoning.json
    agent_reasoning_escalate.json   # optional
    docs/                # the 4 demo document images
    audio/maa_voice_note.mp3
  .env
```

### `.env`

```
MODE=replay|live
GNANI_API_KEY=...          GNANI_AGENT_ID=...   CLINIC_PHONE=+91...
PINELABS_CLIENT_ID=...     PINELABS_CLIENT_SECRET=...   PINELABS_MID=...
PINELABS_BASE=https://pluraluat.v2.pinepg.in
DELHIVERY_TOKEN=...        (optional)
HF_TOKEN=...
```

---

## 5. The beats

Each row is one beat. "Dashboard patch" means the change written to `state.json`.

| # | Beat | WhatsApp (teammate sends to caregiver) | Console events | Dashboard patch | Source |
|---|---|---|---|---|---|
| 0 | **Reset** | — | Clear | `state.initial.json` (empty, pre-onboarding) | — |
| 1 | **Documents received** | *Caregiver* forwards 4 documents to Sanjeevani. **Sanjeevani:** "Got 4 documents for Maa. Reading them now 📄" | `whatsapp.inbound · 4 files` | Show the onboarding screen | SCRIPTED |
| 2 | **Onboarding animation** | — | `classify` ×4 → `extract` (fields stream in) → **`ocr.sample_run`** card showing the real `ocr_sample.json` | Onboarding animation plays (section 7) | SCRIPTED + SAMPLE RUN |
| 3 | **Unclear field** | **Sanjeevani:** "One medicine name on Dr. Mehta's prescription is unclear. Is it *Amlodipine* or *Amlokind*?" (with a cropped image). *Caregiver:* "Amlodipine" | `ask_caregiver` → `reply: Amlodipine` → `fhir.bundle built` (show JSON) → `abha.push` | The field turns green. "Pushed to ABHA ✓". **The dashboard assembles** (all cards fade in). | SCRIPTED · ABHA SIMULATED |
| 4 | **Away mode** | *Caregiver:* "Flying to Delhi, back Sunday". **Sanjeevani:** "Got it ✈ Routine refills continue within your limits. Anything new goes to Rohan. Safe travels." | `caregiver.away = true · backup = Rohan` | `caregiver.away=true`. Travel banner shows; Rohan is active in the care circle. | SCRIPTED |
| 5 | **Trigger** (time card: "Tue 6 Oct, 09:58") | — | `monitor.stock · Amlodipine 3 days` · `monitor.trend · HbA1c rising (3)` · `followup due · Dr. Mehta` | Amlodipine `days_left=3`, shown as ■ Out soon. Status pill: "1 needs a look". | SCRIPTED |
| 6 | **Agent plan** | — | Header "Reasoning · Hugging Face · <model id>". Streams the **model's real reasoning** from `agent_reasoning.json`, then its plan JSON. The plan becomes a checklist that ticks as beats 7–12 run. | — | **LIVE · Hugging Face (recorded)** |
| 7 | **Trust message** | **Sanjeevani:** "Maa's Amlodipine runs out in 3 days. I'll reorder from Apollo Pharmacy (₹184, within your ₹3,000 limit) and book Dr. Mehta for Saturday. Reply HOLD in the next 10 minutes to stop me." | `notify_caregiver` · **countdown 10:00 shown compressed to 10s** (on-screen note "demo: compressed") · `no HOLD received → proceed` | Log row "Told you at 09:58" `Asked you` | SCRIPTED |
| 8 | **Book appointment** | — | `gnani.call → clinic` · live transcript lines · `slot confirmed Sat 10 Oct 11:00` | Next appointment = confirmed. Coming up gets the new row. Log row "Confirmed Dr. Mehta, Sat 10 Oct" `Done by Sanjeevani`. | **LIVE · Gnani** |
| 9 | **Order + payment** | — | `pinelabs.token` → `pinelabs.order.create` (request and response JSON) → `payment` → `webhook: PROCESSED` | Delivery stepper reaches "Paid". Mandate goes from ₹1,000 to ₹1,184. Log rows: "Reordered Maa's Amlodipine" and "₹184 paid to Apollo" `Done by Sanjeevani`. | **SANDBOX · Pine Labs** |
| 10 | **Route delivery** | — | `delhivery.pincode 226001` → `route = local_partner (tier-2)` | Stepper reaches "Shipped · Local partner · Tier-2" | LIVE or CACHED |
| 11 | **Delivered** (time card: "Thu 8 Oct") | — | `delivery.delivered` → `gnani.tts (hi-IN)` → audio player in the console | Stepper reaches "Delivered". Amlodipine shows 33 days, ● On track. | **LIVE · Gnani TTS** |
| 12 | **Maa informed** | **Sanjeevani:** "Maa's medicine was delivered ✅. I let her know. Here's what she heard 🔊" + **the Gnani audio file** | `voice_note.sent → Maa` · `ack: "theek hai"` (scripted) | The final stepper step ticks. Log row "Maa was told her medicine arrived" 🔊 | SCRIPTED delivery of real audio |
| 13 | **Caregiver lands** (time card: "Sun 11 Oct") | *Caregiver:* "Landed". **Sanjeevani:** "Welcome back! While you were away: medicine reordered and delivered, Dr. Mehta booked for Sat 11:00, Maa informed. 0 things missed. Nothing needs you right now." | `caregiver.away = false` · `summary` | Travel banner disappears. Toast: "While you were away: 4 actions, 0 missed". KPI **Missed care actions: 0**. Footer: "Nothing else needs you right now." | SCRIPTED |

**Hindi voice note text** (generated by Gnani TTS in beat 11):
> "Namaste Maa. Aapki BP ki dawaai aa gayi hai. Shanivaar subah gyarah baje Dr. Mehta ke paas aapka appointment hai. Pursharth ne yeh sab intezaam kar diya hai."
>
> (Hello Maa. Your BP medicine has arrived. You have an appointment with Dr. Mehta on Saturday at 11am. Pursharth has arranged all of this.)

The note credits the family member, not the system.

---

## 6. Cue page (for the teammate sending as "Sanjeevani")

- **Route:** `/cue`, opened on the teammate's phone or laptop. **It is never on screen in the recording.**
- **What it shows:** the current beat number, the **exact message to send** in large text, a **Copy** button, and attachment hints (e.g. "attach `data/docs/crop_amlodipine.png`" or "attach `data/audio/maa_voice_note.mp3`").
- **When it updates:** whenever the orchestrator advances. It also shows **"Waiting for caregiver reply: 'Amlodipine'"** on beats where the caregiver types first.
- **Optional:** if the team can set up an automation tool on the teammate's number, it can consume the same cue stream and send automatically. The text stays the same either way.

---

## 7. Onboarding animation (beats 1–3)

- **Where it lives:** a full-screen overlay on the dashboard, in the same design tokens. White background, brand blues.
- **Total time:** about 12 seconds. Each stage advances on its own timer, and the presenter can pause it.

| Stage | Duration | Visual |
|---|---|---|
| a. Received | 1.5s | 4 document thumbnails slide in from the right (the real demo images in `data/docs/`), with the header "Reading Maa's documents" |
| b. Classify | 3s | One after another, each thumbnail gets a type chip: `Prescription`, `Lab report`, `Lab report`, `Discharge summary`. The thumbnail runs a thin scan-line animation while it's being processed. |
| c. Extract | 4s | Beside each document, field rows type in with confidence chips (green above 90%). On the prescription, "Amlodipine / Amlokind?" sits **amber at 62%** and pulses. |
| d. Ask | — (waits for beat 3) | A small WhatsApp-styled callout: "Asked Pursharth to confirm" |
| e. Confirmed | 1.5s | The amber chip turns green ("Confirmed by you"). Each document gets a tick: "FHIR record ✓ → ABHA ✓ (simulated)". |
| f. Assemble | 2s | The overlay fades and the dashboard cards stagger in: KPIs, stock, trends, activity, right rail |

---

## 8. Agent console

**Placement:** a right-hand panel beside the dashboard (about 40% width), or its own route `/console` for compositing. Dark theme: background `#0E121B`, text `#E1E4EA`, mono font for JSON.

**Header:** "Sanjeevani agent" + `● running` + the current beat title.

**Each event row contains:**
- a timestamp in story time (e.g. `Tue 09:58:12`)
- an icon and a **source chip**:
  - Gnani: purple
  - Pine Labs: green
  - Delhivery: orange
  - Hugging Face: yellow
  - WhatsApp: teal
  - Agent: blue
- the label (`LIVE` / `SANDBOX` / `SCRIPTED` / `SAMPLE RUN` / `SIMULATED`)
- a one-line summary
- an expandable `▸ request / response` JSON block

**Special event types:**
- **`ocr.sample_run`:** a card showing the image thumbnail on the left and the real model JSON on the right. Header: "Sample run · Hugging Face · <model id>". Subtitle: "Pipeline proof — the demo data on the dashboard is illustrative."
- **`agent.plan`:** reasoning text streams at about 40 characters per second, then a checklist of planned actions appears and ticks as later beats run.
- **`countdown`:** a large timer, 10:00 shown compressed to 10s, with the note "HOLD window · compressed for demo".
- **`gnani.transcript`:** call lines appear one by one, with alternating Agent and Clinic speakers. Include an audio waveform if a recording exists.
- **`audio`:** an inline player for the Maa voice note.

**Expected reasoning (beat 6).** The real text comes from the HF model (section 9). The passage below is the **target**: use it to judge whether a run is valid, and as a last-resort fallback labelled `SCRIPTED` if no model run validates.

> Amlodipine 5mg for Maa: 3 days of stock left. Usual pharmacy: Apollo, Lucknow. Price ₹184, within the ₹3,000 monthly mandate (₹1,000 used).
>
> Pursharth is away until Sunday. This is a routine refill of an existing prescription at the usual pharmacy, inside his limits, so I can act after informing him. I'm not escalating to Rohan.
>
> Dr. Mehta follow-up is due, and HbA1c has risen across the last 3 readings. I'll book the earliest Saturday slot and add a note to mention the trend. I won't interpret the result.
>
> Maa should hear only the outcome, after delivery. No pending-action messages to her.

**Plan JSON:**

```json
[
  { "step": "notify_caregiver", "hold_window_min": 10 },
  { "step": "book_appointment", "via": "gnani_call", "target": "Dr. Mehta clinic", "pref": "Saturday AM" },
  { "step": "create_order", "via": "pinelabs", "amount_inr": 184, "within_mandate": true },
  { "step": "route_delivery", "via": "delhivery", "pincode": "226001" },
  { "step": "notify_parent", "via": "gnani_tts", "lang": "hi-IN", "when": "after_delivery" }
]
```

---

## 9. Real integrations

Keep each integration behind its own wrapper in `server/integrations/`. **Check exact endpoints and payloads against each provider's current docs**; the paths below are starting points, not guarantees.

### Gnani (do this first; it has the highest setup risk)

- **Clinic call:** set up a voice agent on Gnani's platform (Inya.ai) with this goal: *"Call Dr. Mehta's clinic, request the earliest Saturday morning cardiology follow-up for Mrs. Sharma (68), confirm the time, thank them."* The outbound call goes to `CLINIC_PHONE` (a teammate's phone). Capture the transcript and, if available, the call recording, then save both to `cache/beat8.json` and `data/audio/clinic_call.mp3`.
- **Voice note:** call Gnani's text-to-speech with the Hindi script from section 5, language `hi-IN`. Save the output as `data/audio/maa_voice_note.mp3`.
- **Fallback:** if the outbound call can't be configured in time, record a real Gnani agent conversation from their playground and play it as cached, labelled `LIVE · recorded`.

### Pine Labs (UAT sandbox)

1. **Get a token:** `POST {BASE}/api/auth/v1/token` with `client_id`, `client_secret` and `grant_type=client_credentials`.
2. **Create the order:** `POST {BASE}/api/pay/v1/orders` with amount `18400` (paise), INR, merchant reference `SNJ-AMLO-0610`, and customer Pursharth.
3. **Complete the payment** using UAT test credentials (a payment link or checkout, per the docs).
4. **Catch the webhook** with an ngrok URL or webhook.site, then show the `PROCESSED` event.
5. **Mandate (optional):** the subscriptions/mandate API exists in their docs. If time allows, create the ₹3,000 standing mandate. Otherwise show the order and payment, and label the mandate "configured".

Show real request and response JSON in the console, with secrets masked.

### Delhivery (optional)

Call the pincode serviceability check for `226001`. If no token is available, use a saved response labelled `CACHED`.

### Hugging Face OCR (one-off script, not used by the dashboard)

- `node server/integrations/hf_ocr.js data/docs/prescription.jpg`
- **Model:** a vision-language model on HF Inference Providers, e.g. Qwen2.5-VL-7B-Instruct. Use any vision model available on the free tier if that one isn't.
- **Prompt:** *"Extract every medicine from this prescription. Return only JSON: [{name, dose, frequency, duration, confidence_0_to_1}]. If unsure of a name, give your best reading and a low confidence."*
- Save the raw response to `data/ocr_sample.json`. The console renders it in beat 2.

### Hugging Face agent reasoning (powers beat 6)

**Script:** `node server/integrations/hf_reason.js`. It writes `data/agent_reasoning.json`.

**Model:** an open instruct model through HF Inference Providers, e.g. `Qwen/Qwen2.5-7B-Instruct` or `meta-llama/Llama-3.1-8B-Instruct`. HF offers an OpenAI-compatible chat endpoint (`https://router.huggingface.co/v1/chat/completions`); verify it against the current docs. Use `temperature: 0.2`.

**Input:** build it from `state.json` at beat 5, so the model reasons over the same data the dashboard shows.

**System prompt:**

```
You are Sanjeevani, a family health agent acting for a caregiver.

Rules you must follow:
- Routine refill of an EXISTING prescription, at the USUAL pharmacy, within the monthly mandate cap
  → you may act after informing the caregiver, with a 10-minute window to reply HOLD.
- Anything new (new medicine, new pharmacy, over cap) → do NOT act; escalate to the caregiver,
  or to the backup if the caregiver is away.
- Never diagnose or interpret test results. You may suggest the caregiver "mention a trend to the doctor".
- The elderly parent is told ONLY about completed outcomes, after delivery. Never send them pending actions.
- Use only these tools: notify_caregiver, escalate_to_backup, book_appointment (gnani_call),
  create_order (pinelabs), route_delivery (delhivery), notify_parent (gnani_tts).

Return ONLY JSON:
{
  "reasoning": ["short sentence", "..."],
  "decision": "act_and_inform" | "escalate",
  "plan": [{ "step": "<tool>", ...args }]
}
```

**User message:** the state facts.

```
Patient: Maa, 68, Lucknow (226001). Caregiver: Pursharth, AWAY until Sun 11 Oct. Backup: Rohan.
Medicine: Amlodipine 5mg OD — existing prescription, 3 days of stock left. Usual pharmacy: Apollo Lucknow.
Price ₹184. Mandate: medicines & tests, cap ₹3,000/month, ₹1,000 used.
Follow-up with Dr. Mehta (Cardiology) is due; not booked.
Trend: HbA1c 6.8, 6.9, 7.1, 7.2, 7.4 (last 5 readings).
Decide what to do now.
```

**Validation:** the script re-runs, up to 5 times, until all of these hold.
- The output is valid JSON.
- `decision == "act_and_inform"`.
- The plan contains `notify_caregiver`, `book_appointment`, `create_order`, `route_delivery` and `notify_parent`, with `notify_parent` last.
- The reasoning contains no diagnostic words ("abnormal", "diabetic", "dose change" and similar).

Save the **first valid run unedited**, together with the model id, timestamp and raw response. Don't hand-edit the text: the console says it's real model output.

**Optional second call (gives judges a stronger point):** run the same prompt with a **new** medicine (e.g. "Rosuvastatin 10mg — new prescription from Dr. Rao"). The model should return `decision: "escalate"` → `escalate_to_backup`. Save it as `agent_reasoning_escalate.json`. In the console, show it collapsed under beat 6 as "Same agent, different case: a new medicine → escalates to Rohan". It proves the limits are enforced by the agent's reasoning, not hardcoded.

### FHIR

`fhir.js` builds a FHIR R4 Bundle with a Patient resource and one MedicationRequest per medicine, from the dashboard's demo medicines. Show it in beat 3 as `SIMULATED push` and real JSON. The open-source `krama-core` (`create_prescription_bundle`) or the `adaptnxt/abdm-m1-m2-fhir-fastapi` repo can serve as references.

---

## 10. Recording setup

- **Screen:** 1920×1080.

```
┌──────────────────────────────────────┬────────────────────┐
│                                      │                    │
│        DASHBOARD (60%)               │  AGENT CONSOLE     │
│                                      │  (40%)             │
│                                      │                    │
│                         ┌──────────┐ │                    │
│                         │ Caregiver│ │                    │
│                         │ WhatsApp │ │                    │
│                         │ (scrcpy) │ │                    │
│                         └──────────┘ │                    │
└──────────────────────────────────────┴────────────────────┘
```

- **The caregiver's phone** is mirrored with `scrcpy` as a floating window, bottom-left of the dashboard area. Only the caregiver's chat with "Sanjeevani" is visible.
- **During beat 8**, play the clinic call audio over the recording.
- **During beats 11–12**, play Maa's voice note audio.
- **Record beat by beat** and stitch the clips together in editing. Do a full run in `MODE=replay` as a backup take.
- **Title card** first (see section 2), then the beats, then an end card: "Missed care actions: 0".

---

## 11. Build order and time boxes

| # | Task | Time |
|---|---|---|
| 1 | **Gnani:** voice agent and outbound test call; generate the TTS voice note | 2h |
| 2 | **Pine Labs UAT:** token, order and payment, with the webhook received | 1.5h |
| 3 | Orchestrator skeleton: beats, state.json, SSE, keyboard controls, replay cache | 1.5h |
| 4 | Agent console UI and event types | 1.5h |
| 5 | Wire the dashboard (existing spec) to `state.json` patches per beat | 1h |
| 6 | Onboarding animation | 1h |
| 7 | Cue page | 30m |
| 8 | HF OCR one-off run, then `ocr_sample.json` in the console | 30m |
| 8b | **HF reasoning run:** `hf_reason.js` with validation, then `agent_reasoning.json` (plus the optional escalate run), streamed in beat 6 | 45m |
| 9 | FHIR bundle; Delhivery call (optional) | 30m |
| 10 | Full dry run in replay mode, then record | 1.5h |

Tasks 1 and 2 come first because they depend on external accounts. Everything else is local.

---

## 12. Done when

- [ ] `Space` steps beats 0 → 13. The dashboard, console and cue page stay in sync at every beat.
- [ ] `R` resets cleanly, and the full run works offline in `MODE=replay`.
- [ ] Beat 8 shows a real Gnani call transcript (live or cached from a real run).
- [ ] Beat 9 shows real Pine Labs UAT request and response JSON and a webhook event.
- [ ] Beat 11 plays real Gnani Hindi TTS audio.
- [ ] Beat 2 shows the real HF OCR sample, labelled "Sample run".
- [ ] Beat 6 streams real HF model reasoning and plan from `agent_reasoning.json` (unedited, model id shown). The plan checklist ticks as beats 7–12 run.
- [ ] Every console event has a source chip. The title card is present.
- [ ] The dashboard ends at: Missed care actions **0**, Amlodipine **33 days ● On track**, Dr. Mehta **Sat 10 Oct 11:00 ● Confirmed**, mandate **₹1,184 / ₹3,000**, travel banner gone, and the footer "Nothing else needs you right now."
- [ ] Maa is never shown a pending-action message. Her only touchpoint is the post-delivery voice note.
