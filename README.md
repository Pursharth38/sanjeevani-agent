# Sanjeevani Agent

Recorded, scripted walkthrough of one complete Sanjeevani agent flow — records consolidated, the agent plans, books a clinic visit by voice (Gnani), pays in the Pine Labs UAT sandbox, routes delivery, and sends Maa a Hindi voice note only after delivery.

- **Plan:** `.claude/docs/sanjeevani-agent-demo-plan.md`
- **Who does what:** `.claude/docs/sanjeevani-team-split.md`
- **Working rules for Claude Code:** `CLAUDE.md`

## Branches

| Branch | Owner |
|---|---|
| `main` | merged at checkpoints only |
| `pursharth` | Gnani, Hugging Face, onboarding animation, cue page, WhatsApp script |
| `kavish` | orchestrator, Pine Labs, Delhivery, FHIR, agent console, dashboard wiring |

## Run

```
cp .env.example .env
MODE=replay npm run demo
```

`web/dashboard/` is the existing caregiver dashboard, copied from the `sanjeevani` site repo (commit a7c9d41). It polls `data/state.json`.
