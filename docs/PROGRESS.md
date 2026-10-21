# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: gate G10, then stages G11–G13 of Phase 13, the Playground (ADR-0025)

- Every WP of stage G10 is done on `claude/pensive-cray-9pa1n6`, draft PR #26 (handed off 2026-10-19; rechecked
  2026-10-21: check, 3,914 unit tests, the hello spec). First a `deps:` commit: `x deps --update` (typescript-eslint
  8.72.0), Node 24.22.1 (.nvmrc, tools/deps.json, the docs naming 24.22.0, setup.sh). Then the gate, in order: the
  verifier on G10; rewrite this page; PR #26's body with docs/PLAYGROUND.md §9.3's playtest checklist; `x ci --local`
  green; squash-merge; main's full run (`x ci --status`), fixed if red; G11 from the updated main (PLAN.md §11.1).
- After G10, in Phase 13's table order: G11 the house (13.13, 13.14, 10.5, 13.15, 10.3, 13.16, 13.17, 7.7, 13.18,
  12.3), G12 alive (10.4, 13.19, 13.20, 10.2, 10.1, 13.21, 13.22, 11.1, 11.2, 11.5, 13.23, 11.3, 13.24, 8.8, 10.8),
  G13 the tech demo (13.25, 7.5, 11.4, 12.1, 12.2, 7.6, 13.26). Upgrades fit between stages once they qualify: U-1
  Vitest 4 (2026-10-22), upload-artifact v5 (2026-10-24), checkout v6 (2026-11-20).
- The owner's: the Quaternius GLBs (WP 8.8), model access for WP 12.2's live evals: `node x esc` when reached.

## Where things stand (2026-10-19)

- Phases 0–9 are done (PR #2–#11), 13.1–13.6 merged in #22. The playground (`npm run dev`, /labs/playground/;
  `node x feel labs/playground`: 19 courses, 1,425 measures pass) has Apex's movement, rides, five cameras, animation
  and first person (ADR-0025 amendments 1–12); the bot (`__engine.bot`), dev actions (`__engine.actions`, recorded:
  amendment 13), UI widgets (amendment 14) and the store are the engine's. Games: lean/ (ADR-0024, docs/HANDOFF.md).
- CI (ADR-0023): merges wait on the quick gate; main's full run after each. Vercel is paused: ignore its statuses.

## What waits, by design

- QA baseline entries wait on WPs 10.2 and 8.8; the gun's viewmodel and the punch's arm on WPs 13.20 and 13.19. Not
  verifiable here: speakers, Firefox and Safari, phones' touch (ADR-0021), pads, real-GPU performance (Phase H). Not
  run in a browser: the starter game's best-round HUD line (labs/game/main.ts; its logic: labs/game/best.test.ts).
- At their size cap, split on the next change: anim/traversal/{plant,pose}.ts, sim/actors.ts, tools/qa/anim.ts
  (392–400 lines), tests/e2e/box.spec.ts (399), engine/sim/world.ts (394).

## Open issues

- Owner: in random play the shooter's camera loses the chest in 4–5% of frames, against or over a wall (not courses).
- Owner, for the G10 playtest: the feet's slide with the heel roll, the toes into a 17 cm riser (WP 13.10); the
  stepping knees swung wide, the pull's hands off the top, a ladder knee at the rung plane (WP 13.11); the arms' pose
  numbers, tuned by eye (WP 13.12); the box's and the playground's menus are still their own, not the Menu widget.
