# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: stage G12 of Phase 13, alive (ADR-0025)

- Gate G11 passed (PR #27, 2026-10-22; its row in PLAN.md §14). U-1 Vitest 4 is in (4eb7b89); upload-artifact v5
  (2026-10-24) and checkout v6 (2026-11-20) between stages, when they qualify.
- G12 runs on `claude/pensive-cray-9pa1n6` from the updated main (PLAN.md §11.1), in Phase 13's table order: 13.27
  to 13.23 done (twelve WPs), then 11.3, 13.24, 8.8, 10.8. Then G13.
- The owner's: the Quaternius GLBs (WP 8.8), model access for WP 12.2's live evals (`node x esc` when reached). Their
  go-ahead (2026-10-22): a bot may play with infinite health and ammo to get through content faster and more surely.

## Where things stand (2026-10-23)

- Phases 0–9 are done; Phase 13's G10 (PR #22, #26) and G11 (#27) are merged. The playground (`npm run dev`,
  /labs/playground/?scene=site) moves as Apex, with five cameras, on the block (a house, yards, a street, the gym, a
  hill, a range, a ring): doors, switches, pickups, melee, guns, ragdolls, neighbours, a dog, sound, lamps lit at dusk.
  Games: lean/ (ADR-0024). CI: the quick gate, then main's full run (ADR-0023). Vercel paused.

## What waits, by design

- Night in both looks is dim and flat (WP 13.23's row): WP 13.24 tunes it. The box's sound map reads its actors when
  it reads, not where an event says (amendment 29). Amendment 22 proposes triangle-mesh terrain. QA baselines: the
  timelines' knockdown slide, WP 8.8's. Not verifiable here: speakers, touch (ADR-0021), pads, real GPUs
  (`stats().gpuMs` on the owner's: SwiftShader's is a CPU's), labs/game's HUD line.
- At their size cap (395–400 lines), split on the next change: engine/app/engine.ts, world/siteNav.ts, sim/actors.ts,
  anim/{poses,humanoid,locomotion,clip/layer,traversal/plant}.ts, gfx/{instancing,puppets/draw,puppets/crowd}.ts,
  labs/box/menu.ts, tools/{cmd/audio,lib/browser}.ts. The feel kit poses apart from the page: share one.

## Open issues

- Owner: in random play the shooter's camera lost the chest in 4–5% of frames (before WP 13.27; not measured since).
- Owner, for the G11 playtest (its checklist is in PR #27): amendment 20's calls (the block 113 m deep for the gym;
  the slide-jump's 0.1 s hop window; §2.3's risers dropped; an up-and-over garage door); G10's items (PR #26).
- The quick gate took 6 min 48 s at G11, over its 5 min (CI_BUDGET): the house's soak (70 s), the eye's tour (52 s)
  and the bot's tours (100 s) stay in T1. Under load `npm test` can exit 1 on Vitest's RPC timeouts, every test passed.
- The box room's page budget is over (35 pipelines, 43 textures, a compute call: WP 11.5's row). `x shot` and `x film`
  never ready the playground's page (they freeze its clock). The bot uses at each drop. Untested: shafts in cascades.
