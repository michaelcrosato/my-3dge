# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: nothing scheduled; the owner's playtest of the tech demo

- Gate G13 (PR #34): Phase 13 is done, with every WP it fired: the front end (WP 13.25), the governor (7.5),
  GPU-driven crowds' stage 1 (11.4), templates and skills (12.1), the usability evals and mutation testing (12.2),
  `x mcp` (7.6), the tour with its attract mode and a film per look (13.26). What follows waits: upgrades U-2 to U-7
  from their dates (`node x deps --qualify`), on-demand WPs for their triggers (§9.1), Phase H for a game to ship.
- The owner's, all in the playground's Owner checks (title screen; WP 13.28), each in plain words with Go there: the
  playtest (docs/PLAYGROUND.md §9.3), the looks to judge (the accent weak from isometric, the cel look's dark night
  there, its near-black brick), the sound and a pad, and ESC-0002 to ESC-0006's calls (the Quaternius GLBs, model
  access for the live evals, the crowd's CPU render, the mutants outside the sample). Their answers come back pasted
  from Copy my answers. Their go-ahead (2026-10-22): a bot may play with infinite health and ammo.

## Where things stand (2026-10-28)

- Phases 0–9 and 13 are done (G10: PR #22, #26; G11: #27; G12: #28, #33; G13: #34). The playground (`npm run dev`,
  /labs/playground/) opens on its title screen and moves as Apex in five cameras on the block (doors, pickups, melee,
  guns, ragdolls, neighbours, a dog, sound, day and night, GPU rain, cel and pixel looks); Watch the tour plays it all.
  Agents drive it through `node x`, `__engine` or `x mcp`. Games: lean/. Vercel on again; the site opens the playground.
- Tidied after G13 (ADR-0025 amendment 45): the cast floods its ways lazily, the cap's 15 files split, the box's sounds
  where their events say, `x shot`/`x film` on the playground, the box room's page budget re-recorded and held.

## What waits, and the open issues

- Amendment 22 proposes triangle-mesh terrain. QA baselines: the timelines' knockdown slide, WP 8.8's. Owner:
  top-down's pixel look panned across a whole pixel changes 7–10 pixels of a soft shadow band (amendment 35). Clip
  contacts: hands read as holds in walks, idles and more (WP 8.8's row); no foot lock reads a clip's foot contacts yet.
  Not verifiable here: speakers, touch (ADR-0021), pads, real GPUs (`stats().gpuMs`: the rain's 1 ms), the pixel
  look's glide, a desktop MCP client.
- Mutation (WP 12.2, ESC-0006): the run's tenth catches 94.40%, the rest 74.3%; rotate its seed and redraw each gate.
- Near the size cap (392–394 lines), split on the next change: sim/world.ts, anim/{quadruped,clip/validate}.ts,
  tools/cmd/replay.ts; four tests at 399–400. The feel kit poses apart from the page: share one.
- The quick gate is over its 5 min (CI_BUDGET), its long pole the playground's soak and site tests; under load
  `npm test` can fail on RPC timeouts; audio.spec's spatial test hung once in an offline render on GitHub (e6f38ba).
- The tour's page goldens come from its spec (amendment 41). Random play lost the shooter's chest in 4–5% of frames
  (before WP 13.27). Untested: shafts in cascades.
