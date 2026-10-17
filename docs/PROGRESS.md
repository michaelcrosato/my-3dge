# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: Phase 13, the Playground (the owner's direction of 2026-10-17, ADR-0025)

- `labs/playground/`: a house (basement, two floors, attic, roof) on a block with a yard, a street, a gym, a hill, a
  range and a ring, where the player moves as in Apex Legends, in five cameras and two looks. docs/PLAYGROUND.md is
  its design and its reference values; PLAN.md Phase 13 holds its WPs in four stages: feel (G10), the house (G11),
  alive (G12), the tech demo (G13). The character comes first: WP 13.1 built the lab and its gym (`npm run dev`,
  then /labs/playground/; labs/playground/README.md), WP 13.2 the player (`body:player` on the 1.80 m
  `build:adult`); WP 13.3, the movement profiles and Apex's model, is next.
- The playground fires all 21 on-demand WPs (each Trigger line names its need); Phase 13's table places them.
- The owner's, within it: the Quaternius GLBs (WP 8.8 runs without them) and model access for WP 12.2's live evals.

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
- QA baseline entries wait on WP 10.2 and WP 8.8, and the anim QA's foot slides on a rule for stance locks (ADR-0009
  amendment 8), which WP 13.10 brings.
- Not verifiable in this container: speakers and headphones, Firefox and Safari, touch on phones (ADR-0021),
  physical pads, real-GPU performance (Phase H): the owner's playtest at each gate covers how it feels.
- The owner's: lean/ stays off npm and ships no type declarations (ADR-0024 amendment 1). Vercel is paused until the
  owner tests: ignore its statuses and errors (ADR-0023).

## Open issues

- None. The owner declined branch protection (PLAN.md §11.5).
