# Sanjeevani Agent

One automatic, recorded run of the Sanjeevani agent: Maa's Amlodipine is running out while her caregiver (Pursharth) is travelling. The agent reasons over the family's records (Hugging Face), tells Pursharth first and waits for a HOLD, books Dr. Mehta by voice (Gnani), creates the order in the Pine Labs UAT sandbox, routes delivery, and sends Maa a Hindi voice note only after delivery. Every step shows live in the agent console with its source label.

- **Working rules and contracts:** `CLAUDE.md` (overrides the plan and team split where they conflict)
- **Original plan:** `.claude/docs/sanjeevani-agent-demo-plan.md`
- **Original split of work:** `.claude/docs/sanjeevani-team-split.md`

## Branches

| Branch | Owner |
|---|---|
| `main` | merged at checkpoints only |
| `pursharth` | WhatsApp (cue page, `whatsapp.js`, script), Gnani call + Hindi TTS, Hugging Face OCR + reasoning, onboarding animation |
| `kavish` | orchestrator (agent runner), agent console, Pine Labs, Delhivery, FHIR, payment window, clinic portal |

## Run

Needs Node 22.

```
cp .env.example .env        # fill in keys for live mode; replay needs none
MODE=replay npm run demo    # offline, from cache/ (the backup take)
MODE=live npm run demo      # calls the real APIs
```

Open the console and press **Space** to start the run.

| Page | URL | Who |
|---|---|---|
| Agent console | http://localhost:4000/console/ | the laptop (recorded screen) |
| Cue page | `http://<laptop-ip>:4000/cue` | the teammate's phone sending WhatsApp as "Sanjeevani" (same Wi-Fi) |
| Clinic portal | http://localhost:4000/clinic (or `http://<laptop-ip>:4000/clinic`) | a clinic adding a patient's prescription by photo or typed |
| Payment window | http://localhost:4000/pay/ | opens over the console during the payment step |

The orchestrator prints the cue and clinic URLs with the laptop's address when it starts. From other devices only the cue page, the clinic portal, `/data/*` and `/webhooks/*` answer; the console and the run controls are laptop-only.

**Controls** (in the console window or the terminal): `Space` start · `R` reset · `P` pause · `J` open the latest JSON (console) · `H` hide key hints (console) · `Q` quit (terminal).

**Demo clinic accounts:** `mehta@clinic.demo` / `mehta-demo-2026` and `rao@clinic.demo` / `rao-demo-2026`. Patient lookup takes a 14-digit ABHA number starting `91` and ending `4821` (Maa).

## Settings (`.env`)

| Key | Default | What it does |
|---|---|---|
| `MODE` | `replay` | `live` calls the real APIs |
| `PREROLL` | `1` | `0` starts at the stock trigger, skipping the records step |
| `HOLD_WINDOW_S` | `10` | the 10-minute HOLD window, compressed for the demo |
| `PINELABS_PAYMENT` | `simulated` | `checkout` runs a real Pine Labs Hosted Checkout payment |
| `PAY_AUTO_S` | `5` | the payment window confirms itself after this many seconds; `PAY_AUTO=0` waits for a click |
| `DELHIVERY_TOKEN` | — | with a token, the serviceability check is real instead of simulated |

API keys (Pine Labs, Gnani, Hugging Face) are listed in `.env.example`. Never commit `.env`.

## What is real and what is simulated

| Step | Status |
|---|---|
| Agent reasoning and plan | real Hugging Face model output (recorded run) |
| WhatsApp | real messages, sent by a teammate from the cue page |
| Clinic call, Hindi voice note | live Gnani |
| Pine Labs | real UAT token and order; payment simulated (card processing isn't enabled on our UAT account) |
| Delivery | real pincode check (India Post); Delhivery serviceability and the delivery itself simulated |
| FHIR record | real FHIR R4 bundle built in code; the ABHA push is simulated |
| Clinic portal | real login and FHIR record; ABHA lookup and linking simulated |

The orchestrator also enforces the caregiver's limits on every plan step (order amount and mandate, pincode, caregiver told first, Maa told only after delivery); a blocked or failed step escalates to the backup.

## Integrations on their own

Each integration runs from the command line; `--live` makes one real run and writes its cache:

```
node server/integrations/pinelabs.js --live
node server/integrations/delhivery.js --live
node server/integrations/fhir.js
```

`web/dashboard/` is the earlier caregiver dashboard (copied from the `sanjeevani` site repo, commit a7c9d41). It is served unchanged at `/dashboard/` and is not synced to the run.
