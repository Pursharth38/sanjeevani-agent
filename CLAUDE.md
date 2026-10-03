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

## Ownership — only edit files you own

Two people build in parallel on separate branches. **Check the current branch before editing** and stay inside that owner's files:

- Branch `pursharth` → **P** owns: `server/integrations/gnani.js`, `hf_ocr.js`, `hf_reason.js`, `web/onboarding/`, `web/cue/`, `data/docs/`, `data/audio/`, `data/whatsapp_script.json`
- Branch `kavish` → **K** owns: `server/orchestrator.js`, `beats.js`, `state.js`, `cache.js`, `server/integrations/pinelabs.js`, `delhivery.js`, `fhir.js`, `web/dashboard/` (wiring only, don't restyle), `web/console/`, `data/state.initial.json`, `data/beats/`
- Shared: `fixtures/`, `.env.example`. `cache/<name>.json` is written by each module's own CLI.

If a task needs a change in the other person's files or in a shared contract (section 2 of the team split), stop and say so instead of editing. Contract changes must be agreed with the other person first.

## Contracts (summary; full text in team split section 2)

- Every integration exports `async function run(ctx)` with `ctx = { state, mode: "live" | "replay", beat }` and returns `{ events, statePatch, artifacts }`.
- Every integration also runs from the CLI: `node server/integrations/<name>.js --live` calls the real API once and writes `cache/<name>.json`. In replay mode `run()` reads the cache and makes no network call.
- The orchestrator only ever calls `run(ctx)`. Data falls back fixture → cache → live.
- Console events follow the schema in team split 2.3. ESM modules (`"type": "module"`).

## Honesty rules (required)

- Every console event carries a source label: `LIVE`, `SANDBOX`, `SCRIPTED`, `SAMPLE RUN`, `SIMULATED` or `CACHED`.
- Never fake a real result. Saved model output (`hf_reason`, `hf_ocr`) is stored **unedited** with the model id. Don't fake a Pine Labs `PROCESSED` webhook.
- The OCR sample never feeds the dashboard.
- Maa is never sent a pending-action message. Her only touchpoint is the post-delivery voice note.
- Copy uses family names ("Maa") and never diagnostic language ("abnormal", "diabetic", "high risk").

## Secrets

Never read, print or commit `.env`. Mask secrets in any request/response JSON shown in the console. `.env.example` lists the keys.

## Commands

- `MODE=replay npm run demo` — run the orchestrator offline from `cache/` (exists once K4 is built)
- `MODE=live npm run demo` — call real APIs
- `/checkpoint` — pre-merge checks before a checkpoint
- `/done-check` — walk the plan's "Done when" list

## Git

- `main` is merged into only at the checkpoints (team split section 5). Work on your own branch.
- Commit `cache/*.json` and `data/audio/*` — the recording depends on them.
