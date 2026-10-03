# Sanjeevani Agent — demo build

A recorded, scripted walkthrough of one complete Sanjeevani agent flow: Maa's Amlodipine is running out and her cardiology follow-up is due while the caregiver (Pursharth) is travelling. The agent books the appointment (Gnani call), orders and pays (Pine Labs UAT), routes delivery (Delhivery), and tells Maa only after delivery (Gnani Hindi TTS). It is not a production system.

## Source documents (read before working)

| File | What it is |
|---|---|
| `.claude/docs/sanjeevani-agent-demo-plan.md` | **The build plan.** Story data, the 14 beats (0–13), real vs scripted, architecture, integrations, "Done when" |
| `.claude/docs/sanjeevani-team-split.md` | **Who owns what**, shared contracts (module, event schema, state), fixtures, timeline, git workflow |
| `.claude/docs/sanjeevani-dashboard-spec.md` | The caregiver dashboard spec. Reuse it; don't redesign it |
| `.claude/docs/design.md` | Blend design tokens |
| `.claude/docs/sanjeevani-logo.png` | Logo |

The plan's section 3 (canonical story data) overrides any conflicting dates or numbers in the dashboard spec. Compute weekday labels from dates in code; never hardcode them.

**Scope change (agreed by P and K, 2026-10-03), overrides the plan and team split where they conflict:** the demo is one automatic end-to-end agent run, not 14 scripted beats. Trigger → `hf_reason` plans → the orchestrator executes each plan step through its module (WhatsApp → Gnani call → Pine Labs → Delhivery → Gnani TTS + WhatsApp audio to Maa). **WhatsApp is manual (updated 2026-10-04; Twilio dropped):** a teammate's phone is "Sanjeevani" and sends each message from the cue page (`/cue`, same Wi-Fi); the run waits for their Sent ✓ / Received ✓ tap. The dashboard is **not** synced; dashboard wiring (K5, K7) and `data/beats/` patches are dropped.

## Ownership — only edit files you own

Two people build in parallel on separate branches. **Check the current branch before editing** and stay inside that owner's files:

- Branch `pursharth` → **P** owns: `server/integrations/whatsapp.js` (manual cue), `gnani.js`, `hf_ocr.js`, `hf_reason.js`, `web/cue/`, `web/onboarding/`, `data/docs/`, `data/audio/`, `data/whatsapp_script.json`
- Branch `kavish` → **K** owns: `server/orchestrator.js`, `beats.js` (step → module map, limits, story anchors), `state.js`, `cache.js`, `server/integrations/pinelabs.js`, `delhivery.js`, `fhir.js`, `web/console/`, `data/state.initial.json`. `web/dashboard/` is served static and unsynced; don't edit it.
- Shared: `fixtures/`, `.env.example`. `cache/<name>.json` is written by each module's own CLI.

If a task needs a change in the other person's files or in a shared contract (section 2 of the team split), stop and say so instead of editing. Contract changes must be agreed with the other person first.

## Contracts (the header of `server/orchestrator.js` is the source of truth)

- Every integration exports `async function run(ctx)` with `ctx = { state, mode: "live" | "replay", phase, step, emit, cue, signal }` and returns `{ events, statePatch, artifacts, result }`.
  - `step` is the step with its arguments: plan steps, plus WhatsApp-only steps `documents_received`, `confirm_medicine_name`, `away_mode` (pre-roll) and `caregiver_lands` (after a completed run). `null` for `hf_ocr`, `fhir`, `hf_reason`. Gnani and WhatsApp run for several steps; branch on `ctx.step.step`.
  - `run()` resolves only when the step has really finished (call ended, payment confirmed, the teammate tapped Sent ✓). Use `ctx.emit(event)` for progress while waiting, and respect `ctx.signal` (timeout or reset; WhatsApp calls get 10 minutes).
  - `result` per step: any step `{halt: true}` stops the run (HOLD tapped) · `notify_caregiver {hold, reply}` · `book_appointment {confirmed, slot}` · `create_order {status: PROCESSED | SIMULATED, order_id}` · `route_delivery {serviceable, route}` · `hf_reason {decision, plan, model}`. For `notify_parent`, Gnani returns `artifacts.audio` and the orchestrator hands it to WhatsApp as `ctx.step.audio`.
- Cue page (WhatsApp): when a WhatsApp step starts, the orchestrator pushes `{"beat": N, "step": "<step>"}` as an unnamed SSE message on `/cue-stream` (N from `CUE_BEAT` in `beats.js`: 1, 3, 4, 7, 12, 13; `{"beat": 0}` on reset). `ctx.cue(payload)` pushes a custom message. `POST /cue/ack` (JSON) → `whatsapp.onCueAck(body)` → its `{ status, type, body }`. Reset (R) calls `whatsapp.resetCue()`. `/cue` serves `web/cue/`, `/data/*` serves `data/`.
- Network: the server listens on all interfaces so the phone can open `http://<laptop-ip>:4000/cue`. Other devices only reach `/cue`, `/cue-stream`, `/cue/ack`, `/data/*` and `/webhooks/*`; the console and run controls are laptop-only.
- Webhooks (only Pine Labs' optional real-payment mode uses them now): any method on `/webhooks/<module>` calls that module's exported `onWebhook({ method, headers, rawBody, body, query, url })`.
- Plan steps allowed: `notify_caregiver`, `book_appointment`, `create_order`, `route_delivery`, `notify_parent`, `escalate_to_backup`. The orchestrator rejects anything else and enforces the limits (amount = price on file and within the mandate, pincode on file, caregiver told before any action, Maa told only after delivery, HOLD stops the run). A blocked or failed step escalates to the backup.
- Every integration also runs from the CLI and writes its cache: `cache/<module>.<step>.json` per plan step (e.g. `cache/gnani.book_appointment.json`), or `cache/<module>.json` for single-use modules. In replay mode `run()` reads the cache and makes no network call.
- Fallback per call: live → replay (cache) → `fixtures/<module>.<step>.json` → `fixtures/<module>.json` → a visible "[missing]" row. Fixtures are `{ events, statePatch, artifacts, result }` and must never reach a recording.
- Console events follow team split 2.3; the orchestrator stamps `id`, story time `t` (the original kept as `t_source`), `phase` and `step`. ESM modules (`"type": "module"`).

## Honesty rules (required)

- Every console event carries a source label: `LIVE`, `SANDBOX`, `SCRIPTED`, `SAMPLE RUN`, `SIMULATED` or `CACHED`.
- Never fake a real result. Saved model output (`hf_reason`, `hf_ocr`) is stored **unedited** with the model id. Don't fake a Pine Labs `PROCESSED` webhook. Card processing isn't enabled on our UAT merchant account, so (decided 2026-10-04) the Pine Labs token and order are real `SANDBOX` calls and the payment confirmation is `SIMULATED`, in our own wording (`PINELABS_PAYMENT=simulated`, the default; `checkout` runs the real Hosted Checkout).
- The OCR sample never feeds the dashboard. Delivery completion is simulated (no real courier) and labelled `SIMULATED`.
- Maa is never sent a pending-action message. Her only touchpoint is the post-delivery voice note.
- Copy uses family names ("Maa") and never diagnostic language ("abnormal", "diabetic", "high risk").

## Secrets

Never read, print or commit `.env`. Mask secrets in any request/response JSON shown in the console. `.env.example` lists the keys.

## Commands

- `MODE=replay npm run demo` — run the agent offline from `cache/` (the backup take); Space starts the run
- `MODE=live npm run demo` — call real APIs. The teammate's phone opens the cue URL the orchestrator prints (`http://<laptop-ip>:4000/cue`).
- `PREROLL=0` starts at the trigger; `HOLD_WINDOW_S=10` sets the compressed HOLD window
- `/checkpoint` — pre-merge checks before a checkpoint
- `/done-check` — walk the plan's "Done when" list

## Git

- `main` is merged into only at the checkpoints (team split section 5). Work on your own branch.
- Commit `cache/*.json` and `data/audio/*` — the recording depends on them.
