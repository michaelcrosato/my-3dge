# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: Phase 13, the Playground (the owner's direction of 2026-10-17, ADR-0025)

- `labs/playground/`: a house (basement, two floors, attic, roof) on a block with a yard, a street, a gym, a hill, a
  range and a ring, where the player moves as in Apex Legends, in five cameras and two looks. docs/PLAYGROUND.md is
  its design and its reference values; PLAN.md Phase 13 holds its WPs in four stages: feel (G10), the house (G11),
  alive (G12), the tech demo (G13). The character comes first: WPs 13.1–13.6 built the lab and its gym (`npm run
  dev`, /labs/playground/), the player, Apex's movement (`movement:apex`), the feel kit (`node x feel labs/playground`:
  13 courses; F opens the feel panel), the crouch and the slide (C), the mantle, the wall-climb and the superglide
  (jump at a ledge or a wall); 13.7 the rides, 13.8 the five camera modes (T, X). Next: 13.9–13.12, 5.6, 10.6, 10.9.
- It fires all 21 on-demand WPs (Phase 13's table places them); the owner's: the Quaternius GLBs, WP 12.2's models.

## Where things stand (2026-10-17, after G9: the cleanup, then games from one URL, lean by default)

- Phases 0–9 are done (PR #2–#11), and the cleanup after G9 closed every loose end (the ledger's row C1).
- Games (ADR-0024 and amendment 1): lean/ is the default handoff, a game as one HTML page loading lean/my3dge.js from
  jsDelivr; the full workspace (tools/game/new-game.mjs) stays for coding agents; docs/HANDOFF.md has both prompts.
- CI (ADR-0023): merges wait on the quick gate, `node x ci --local` (about 5 minutes, no T2); the full run goes on
  main after each merge, nobody waiting; `node x ci --status` says how the last one went: fix a red one first.

## What waits, by design

- U-1 Vitest 4 qualifies 2026-10-22 (it also clears the 4 Dependabot alerts on dev-only vitest and tinypool); U-2 to
  U-5 wait for the one-year rule (tools/deps.json holds each date); U-6 Rapier, U-7 three r184+, U-8 Chromium wait
  for a measurement or a platform change. The workflow's actions: upload-artifact v5 qualifies 2026-10-24,
  checkout v6 2026-11-20 (ADR-0016 amendment 1; `x deps` does not track them).
- QA baseline entries wait on WP 10.2 and WP 8.8; the foot slides (the anim QA's, the courses' watched 0.36 m a
  contact at a run) on WP 13.10's stance locks (ADR-0009 amendment 8); the mantle's and the climb's poses on WP
  13.11.
- Not verifiable here: speakers, Firefox and Safari, phones' touch (ADR-0021), pads, real-GPU performance (Phase H):
  the owner's playtest at each gate covers how it feels. The owner's: lean/ stays off npm and ships no type
  declarations (ADR-0024 amendment 1); Vercel is paused until the owner tests: ignore its statuses (ADR-0023).

## Open issues

- Owner: in random play the shooter's camera loses the chest in 4–5% of frames, most against a wall (courses: never).
