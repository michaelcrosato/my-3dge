# Progress

Read this first: where things stand, what is next and the open issues, on one screen (`node x docs --check` fails it
past 40 lines). The integrator rewrites it at each gate; every WP's status and notes are in the ledger, PLAN.md §14.

## Next: nothing scheduled; the owner's playtest of the tech demo

- Gate G13 (PR #34): Phase 13 is done, with every WP it fired: the front end (WP 13.25), the governor (7.5),
  GPU-driven crowds' stage 1 (11.4), templates and skills (12.1), the usability evals and mutation testing (12.2),
  `x mcp` (7.6), the tour with its attract mode and a film per look (13.26). What follows waits: upgrades U-2 to U-7
  from their dates (`node x deps --qualify`), on-demand WPs for their triggers (§9.1), Phase H for a game to ship.
- The owner's: the playtest (docs/PLAYGROUND.md §9.3, items 1–14); the Quaternius GLBs (ESC-0003: its clips stay
  format 1 until they come); model access for WP 12.2's live evals (ESC-0004: the baseline pass rate waits); the
  crowd's CPU render at 5,000, its posing and not its draws (ESC-0005: stage 2 or the animator's garbage first);
  ESC-0002's call. Looks to judge: the accent weak from isometric, the cel look's dark night there and its near-black
  brick shades (WP 13.26's films). Their go-ahead (2026-10-22): a bot may play with infinite health and ammo.

## Where things stand (2026-10-25)

- Phases 0–9 and 13 are done (G10: PR #22, #26; G11: #27; G12: #28, #33; G13: #34). The playground (`npm run dev`,
  /labs/playground/) opens on its title screen and moves as Apex in five cameras on the block (doors, pickups, melee,
  guns, ragdolls, neighbours, a dog, sound, day and night, GPU rain, cel and pixel looks); Watch the tour plays it all.
  Agents drive it through `node x`, `__engine` or `x mcp`. Games: lean/. Vercel paused.

## What waits, and the open issues

- The box's sound map reads its actors when it reads, not where an event says (amendment 29). Amendment 22 proposes
  triangle-mesh terrain. QA baselines: the timelines' knockdown slide, WP 8.8's. Owner: top-down's pixel look panned
  across a whole pixel changes 7–10 pixels of a soft shadow band (amendment 35). Clip contacts: hands read as holds in
  walks, idles and more (WP 8.8's row); no foot lock reads a clip's foot contacts yet. Not verifiable here: speakers,
  touch (ADR-0021), pads, real GPUs (`stats().gpuMs`: the rain's 1 ms), the pixel look's glide, a desktop MCP client.
- Mutation (WP 12.2, ESC-0006): the run's fixed tenth of sim's and anim's functions catches 94.40%, a fresh draw of
  the rest 74.3%: rotate the sample's seed a stage at a time and report a fresh draw at each gate.
- At their size cap (395–400 lines), split on the next change: engine/world/siteNav.ts, gfx/{sky,stage,instancing}.ts,
  anim/{poses,humanoid,locomotion,clip/layer,traversal/{plant,pose}}.ts, sim/actors.ts, labs/box/menu.ts,
  tools/{cmd/audio,cmd/anim,lib/browser}.ts. The feel kit poses apart from the page: share one.
- The quick gate is over its 5 min (CI_BUDGET: 8 min 2 s at G13); under load `npm test` can fail on RPC timeouts.
- The box room's page budget is over (35 pipelines, 43 textures, a compute call: WP 11.5's row). `x shot` and `x film`
  never ready the playground's page (they freeze its clock); the tour's page goldens come from its spec (amendment 41).
  Random play lost the shooter's chest in 4–5% of frames (before WP 13.27). Untested: shafts in cascades.
