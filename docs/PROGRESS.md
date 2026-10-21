# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: stage G11 of Phase 13, the house (ADR-0025)

- Gate G10 passed (PR #26, 2026-10-21; its row in PLAN.md §14). G11 runs on `claude/pensive-cray-9pa1n6` from the
  updated main (PLAN.md §11.1), in Phase 13's table order: 13.13, 13.14, 10.5, 13.15, 10.3, 13.16, 13.17, 7.7, 13.18,
  12.3. In PR #27, done: 13.13 storeys, 13.14 drawn, 10.5 terrain, 13.15 sites (the lot: `?scene=lot`); 10.3 is next.
- Then G12, alive, and G13, the tech demo (Phase 13's table). Upgrades go between stages once they qualify: U-1
  Vitest 4 (2026-10-22), upload-artifact v5 (2026-10-24), checkout v6 (2026-11-20).
- The owner's: the Quaternius GLBs (WP 8.8), model access for WP 12.2's live evals: `node x esc` when reached.

## Where things stand (2026-10-21)

- Phases 0–9 are done (PR #2–#11). Phase 13's first stage is merged (#22, #26): the playground (`npm run dev`,
  /labs/playground/; `node x feel labs/playground`: 19 courses, 1,425 measures pass) has Apex's movement, rides, five
  cameras with their controls, planted locomotion, traversal on contacts and first person's arms (ADR-0025 amendments
  1–12); the bot and dev actions (`__engine.bot`, `__engine.actions`: amendment 13), UI widgets (14) and the store are
  the engine's. Games: lean/ (ADR-0024, docs/HANDOFF.md). `node x new course` writes a playground course.
- CI (ADR-0023): merges wait on the quick gate; main's full run after each. Vercel is paused: ignore its statuses.

## What waits, by design

- QA baseline entries wait on WPs 10.2 and 8.8; the gun's viewmodel and the punch's arm on WPs 13.20 and 13.19; the
  cameras indoors on WP 13.18's roomier house (in the lot's 3 m rooms the shooter loses the player in 931 of 1,398
  frames). Not verifiable here: speakers, Firefox and Safari, phones' touch (ADR-0021), pads, real-GPU performance
  (Phase H). Not run in a browser: the starter game's best-round HUD line (labs/game/main.ts; labs/game/best.test.ts).
- At their size cap, split on the next change: anim/traversal/{plant,pose}.ts, sim/actors.ts, tools/qa/anim.ts,
  physics/bodies.ts (392–400 lines), tests/e2e/box.spec.ts (399), sim/world.ts (394), index.ts (393). The feel kit
  poses apart from the page (engine/dev/feel/anim.ts, engine/gfx/puppets/actors.ts): share one when either changes.

## Open issues

- Owner: in random play the shooter's camera loses the chest in 4–5% of frames, against or over a wall (not courses).
- Owner, for the G10 playtest (its checklist is in PR #26): the feet's slide with the heel roll, the toes into a 17 cm
  riser (WP 13.10); the stepping knees swung wide, the pull's hands off the top, a ladder knee at the rung plane, the
  hang's elbows bent 34° under a 2 m lip (WP 13.11); the arms' pose numbers, tuned by eye, and the hidden body's
  shadow, never checked in a page (WP 13.12); the box's and the playground's menus are still their own.
