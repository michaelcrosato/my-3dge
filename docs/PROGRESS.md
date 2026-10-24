# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: the rest of stage G12, then gate G12 (Phase 13, ADR-0025)

- G12's first part (U-1, 13.27 to 13.24: fourteen WPs) merged in PR #28. Next: restart `claude/pensive-cray-9pa1n6`
  from main (PLAN.md §11.1), open the stage's draft PR; WP 8.8 (the Quaternius clips: `node x esc open` for the
  owner's GLBs, at most 15 minutes on the alternative, then decide) and WP 10.8 (lab pages); gate G12 (the verifier,
  the ledger, this file, the PR with docs/PLAYGROUND.md §9.3's checklist, `node x ci --local`, the merge, main's run);
  then G13 (13.25, 7.5, 11.4, 12.1, 12.2, 7.6, 13.26). `node x deps --qualify` listed no upgrade on 2026-10-24.
- The owner's: the GLBs (WP 8.8), model access for WP 12.2's live evals, ESC-0002's call to review. Their go-ahead
  (2026-10-22): a bot may play with infinite health and ammo to get through content faster and more surely.

## Where things stand (2026-10-24)

- Phases 0–9 are done; Phase 13's G10 (PR #22, #26), G11 (#27) and G12's first part (#28) are merged. The playground
  (`npm run dev`, /labs/playground/?scene=site) moves as Apex, with five cameras, on the block: doors, pickups, melee,
  guns, ragdolls, neighbours, a dog, sound, day and night, GPU rain, two finished looks (cel and pixel art). Games:
  lean/ (ADR-0024). CI: the quick gate, then main's full run (ADR-0023). Vercel paused.

## What waits, by design

- The box's sound map reads its actors when it reads, not where an event says (amendment 29). Amendment 22 proposes
  triangle-mesh terrain. QA baselines: the timelines' knockdown slide, WP 8.8's. Not verifiable here: speakers, touch
  (ADR-0021), pads, real GPUs (`stats().gpuMs` on the owner's: the rain's 1 ms), the pixel look's glide on a screen.
- At their size cap (395–400 lines), split on the next change: engine/world/siteNav.ts, gfx/{sky,stage,instancing}.ts,
  anim/{poses,humanoid,locomotion,clip/layer,traversal/plant}.ts, gfx/puppets/{draw,crowd}.ts, sim/actors.ts,
  labs/box/menu.ts, tools/{cmd/audio,lib/browser}.ts. The feel kit poses apart from the page: share one.

## Open issues

- Owner: in random play the shooter's camera lost the chest in 4–5% of frames (before WP 13.27; not measured since).
- Owner, for the playtests: G12's checklist (PR #28), G11's with amendment 20's calls (#27), G10's items (#26).
- The quick gate took 6 min 48 s at G11, over its 5 min (CI_BUDGET): the house's soak (70 s), the eye's tour (52 s)
  and the bot's tours (100 s) stay in T1. Under load `npm test` can exit 1 on Vitest's RPC timeouts, every test passed.
- The box room's page budget is over (35 pipelines, 43 textures, a compute call: WP 11.5's row). `x shot` and `x film`
  never ready the playground's page (they freeze its clock). The bot uses at each drop. Untested: shafts in cascades.
