# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: stage G12 of Phase 13, alive (ADR-0025)

- Gate G11 passed (PR #27, 2026-10-22; its row in PLAN.md §14). First the upgrades that qualified, each its own WP
  and commit: U-1 Vitest 4 (2026-10-22); upload-artifact v5 (2026-10-24) and checkout v6 (2026-11-20) when they do.
- G12 runs on `claude/pensive-cray-9pa1n6` from the updated main (PLAN.md §11.1), in Phase 13's table order: 13.27
  (the follow cameras indoors, from WP 13.18), 10.4, 13.19, 13.20, 10.2, 10.1, 13.21, 13.22, 11.1, 11.2, 11.5, 13.23,
  11.3, 13.24, 8.8, 10.8. Then G13, the tech demo.
- The owner's: the Quaternius GLBs (WP 8.8), model access for WP 12.2's live evals (`node x esc` when reached).

## Where things stand (2026-10-22)

- Phases 0–9 are done (PR #2–#11); Phase 13's G10 (#22, #26) and G11 (#27) are merged. The playground (`npm run
  dev`, /labs/playground/?scene=site) has Apex's movement, rides, five cameras, planted locomotion, traversal, first
  person, and the block: a house of four storeys, yards, a street, the gym, a hill, a range and a ring, lit, with
  the cut by storey, doors, windows, switches and pickups, the gallery (`node x gallery`) and the agent eye (`node x
  eye`): ADR-0025 amendments 15–21. Games: lean/ (ADR-0024, docs/HANDOFF.md).
- CI (ADR-0023): merges wait on the quick gate; main's full run after each. Vercel is paused: ignore its statuses.

## What waits, by design

- WP 13.27: the shooter and the platformer indoors (in the soak the shooter loses the player in 7% of frames, the
  platformer in most; settled, both see him in every room). WP 13.23: the crawlspace's light, the street lamps' group.
  QA baseline entries wait on WPs 10.2 and 8.8. Not verifiable here: speakers, touch (ADR-0021), pads, real GPUs; not
  run in a browser: the starter game's best-round HUD line (labs/game/main.ts).
- At their size cap (395–400 lines), split on the next change: engine/sim-api.ts, app/engine.ts, world/siteNav.ts,
  anim/{poses,humanoid,locomotion,clip/layer,traversal/plant}.ts, gfx/{sky,instancing,puppets/draw,puppets/crowd}.ts,
  labs/box/menu.ts, tools/{cmd/audio,lib/browser,qa/anim}.ts. The feel kit poses apart from the page: share one.

## Open issues

- Owner: in random play the shooter's camera loses the chest in 4–5% of frames, against or over a wall (not courses).
- Owner, for the G11 playtest (its checklist is in PR #27): amendment 20's calls (the block 113 m deep for the gym as
  built; the slide-jump under a 0.1 s hop window; §2.3's risers dropped; an up-and-over garage door); G10's items.
- The bot presses use at every drop (in the house only ladders' tops); under load a full `npm test` can exit 1 on
  Vitest's worker RPC timeouts with every test passed (the house's soak takes 40–100 s).
