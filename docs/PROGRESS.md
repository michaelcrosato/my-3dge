# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: gate G12's merge, then G13 (Phase 13, ADR-0025)

- Stage G12 is built: WP 13.24 (the two looks; its review's shimmer fixed: the shadows' noise and the shading's
  quads stay on the world as the pixel look's pans cross whole pixels, amendment 35), WP 8.8 (Mesh2Motion and CMU
  re-imported in format 2: hands, spine, foot roll, contacts and events; the review's hand pops and legacy import
  fixed, ADR-0010 amendment 7) and WP 10.8 (seven lab pages, their index and `x lab`, amendment 36). Next: the gate's
  verifier, `node x ci --local`, the stage PR (with docs/PLAYGROUND.md §9.3's checklist), the merge and main's run.
- Then G13: 13.25, 7.5, 11.4, 12.1, 12.2, 7.6, 13.26. `node x deps --qualify` listed no upgrade on 2026-10-24.
- The owner's: the Quaternius GLBs (ESC-0003: its clips stay format 1 until they come), model access for WP 12.2's
  live evals, the new dependencies WPs 7.6 and 12.2 name, ESC-0002's call; for the playtest, the accent weak from
  isometric in both looks and the cel look's dark night there. Their go-ahead (2026-10-22): a bot may play with
  infinite health and ammo.

## Where things stand (2026-10-24)

- Phases 0–9 are done; Phase 13's G10 (PR #22, #26), G11 (#27) and G12's first part (#28) are merged: the playground
  (`npm run dev`, /labs/playground/?scene=site) moves as Apex in five cameras on the block (doors, pickups, melee, guns,
  ragdolls, neighbours, a dog, sound, day and night, GPU rain, cel and pixel looks). Games: lean/. Vercel paused.

## What waits, and the open issues

- The box's sound map reads its actors when it reads, not where an event says (amendment 29). Amendment 22 proposes
  triangle-mesh terrain. QA baselines: the timelines' knockdown slide, WP 8.8's. Owner: top-down's pixel look panned
  across a whole pixel changes 7–10 pixels of a soft shadow band (0 without shadows; amendment 35). Clip contacts:
  hands read as holds in walks, idles and a dozen more (WP 8.8's row); no foot lock reads a clip's foot contacts yet.
  Not verifiable here: speakers, touch (ADR-0021), pads, real GPUs (`stats().gpuMs` on the owner's: the rain's 1 ms),
  the pixel look's glide on a screen.
- At their size cap (395–400 lines), split on the next change: engine/world/siteNav.ts, gfx/{sky,stage,instancing}.ts,
  anim/{poses,humanoid,locomotion,clip/layer,traversal/plant}.ts, gfx/puppets/{draw,crowd}.ts, sim/actors.ts,
  labs/box/menu.ts, tools/{cmd/audio,lib/browser}.ts. The feel kit poses apart from the page: share one.
- Owner: random play lost the shooter's chest in 4–5% of frames (before WP 13.27); playtests: #28, #27, #26.
- The quick gate is over its 5 min (CI_BUDGET: 6 min 48 s at G11, 8 min 7 s here on 2026-10-24): the house's soak,
  the eye's tour and the bot's tours stay in T1. Under load `npm test` can exit 1 on Vitest's RPC timeouts.
- The box room's page budget is over (35 pipelines, 43 textures, a compute call: WP 11.5's row). `x shot` and `x film`
  never ready the playground's page (they freeze its clock). The bot uses at each drop. Untested: shafts in cascades.
