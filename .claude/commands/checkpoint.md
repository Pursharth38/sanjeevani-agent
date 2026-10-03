---
description: Pre-checkpoint checks before merging a branch into main
---

Run the checkpoint checks from `.claude/docs/sanjeevani-team-split.md` sections 5–6 for the current branch.

1. Show the current branch. It should be `pursharth` or `kavish`; if it is `main`, stop and say so.
2. Fetch and merge `origin/main` into this branch. Report any conflicts and stop if there are any.
3. List files changed versus `origin/main` (`git diff --name-only origin/main...HEAD`). Flag any file outside this branch's owner's area (ownership in `CLAUDE.md`), other than `fixtures/` and `.env.example`.
4. Check that no `.env` or secret is staged or committed.
5. Check that every module this owner is responsible for exports `run(ctx)` and has either `cache/<name>.json` or `fixtures/<name>.json`.
6. Run `MODE=replay npm run demo` if the orchestrator exists, and confirm beats 0→13 complete with no errors. If it doesn't exist yet, say so.

Finish with a short pass/fail list. Don't push or merge into `main`; that happens together at the checkpoint.
