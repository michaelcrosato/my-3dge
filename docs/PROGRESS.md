# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: main green, then U-8, the rest of stage G12 and G13 (Phase 13, ADR-0025)

- Main is red, unseen (found 2026-10-24): its full runs on 39e06b0 (#27) and 9b988aa (#28) hit the job's 120 min limit
  in T2 (86 min at G10, parity.spec.ts 42 of them), and both failed `x engine --test`: tools/qa/{level,anim/points}.ts
  import fixtures/, which games never get. `x ci --status` passes over cancelled runs, so it still names 14e1810's
  pass. Fix all three first, in a PR of their own.
- U-8 fired: the container's Chromium is 153 since 2026-10-22, while the pins and GitHub's run stay on 141. On 153 the
  drift test fails (18 Math functions), the starter's replay parts in Chromium and hello.spec.ts fails: its ledger
  row. Its own PR, the drift test first; till then `CHROMIUM_PATH` can point T2 at 141 (scripts/setup.sh's download).
- Then G12's stage PR: WP 13.24 (its ledger row lists what is left: specs, the verifier); WP 8.8 (`node x esc open`
  for the owner's Quaternius GLBs, 15 minutes on the alternative, then decide); WP 10.8 (lab pages); gate G12 (the
  verifier, the ledger, this file, docs/PLAYGROUND.md §9.3's checklist, `node x ci --local`, the merge, main's run);
  then G13 (13.25, 7.5, 11.4, 12.1, 12.2, 7.6, 13.26). `node x deps --qualify` listed no upgrade on 2026-10-24.
- The owner's: the GLBs (WP 8.8), model access for WP 12.2's live evals, the new dependencies U-8 and WPs 7.6 and
  12.2 name, ESC-0002's call. Their go-ahead (2026-10-22): a bot may play with infinite health and ammo.

## Where things stand (2026-10-24)

- Phases 0–9 are done; Phase 13's G10 (PR #22, #26), G11 (#27) and G12's first part (#28) are merged: the playground
  (`npm run dev`, /labs/playground/?scene=site) moves as Apex in five cameras on the block (doors, pickups, melee, guns,
  ragdolls, neighbours, a dog, sound, day and night, GPU rain, cel and pixel looks). Games: lean/. Vercel paused.

## What waits, and the open issues

- The box's sound map reads its actors when it reads, not where an event says (amendment 29). Amendment 22 proposes
  triangle-mesh terrain. QA baselines: the timelines' knockdown slide, WP 8.8's. Not verifiable here: speakers, touch
  (ADR-0021), pads, real GPUs (`stats().gpuMs` on the owner's: the rain's 1 ms), the pixel look's glide on a screen.
- At their size cap (395–400 lines), split on the next change: engine/world/siteNav.ts, gfx/{sky,stage,instancing}.ts,
  anim/{poses,humanoid,locomotion,clip/layer,traversal/plant}.ts, gfx/puppets/{draw,crowd}.ts, sim/actors.ts,
  labs/box/menu.ts, tools/{cmd/audio,lib/browser}.ts. The feel kit poses apart from the page: share one.
- Owner: random play lost the shooter's chest in 4–5% of frames (before WP 13.27); playtests: #28, #27, #26.
- The quick gate is over its 5 min (CI_BUDGET: 6 min 48 s at G11, 8 min 7 s here on 2026-10-24): the house's soak,
  the eye's tour and the bot's tours stay in T1. Under load `npm test` can exit 1 on Vitest's RPC timeouts.
- The box room's page budget is over (35 pipelines, 43 textures, a compute call: WP 11.5's row). `x shot` and `x film`
  never ready the playground's page (they freeze its clock). The bot uses at each drop. Untested: shafts in cascades.
