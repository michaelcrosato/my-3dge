# ADR-0025: The owner's direction of 2026-10-17: the Playground, a character-first vertical slice

Status: accepted · 2026-10-17 · Records PLAN.md Phase 13 (WPs 13.1 to 13.26, gates G10 to G13), §1, §2, §6.2, §9.1,
§9.2, §11.2, §11.3, §13.1 and §14, and the Trigger lines of the 21 on-demand WPs the playground fires; amends ADR-0018
(amendment 4)

## Decision
1. **The playground is the next integration target.** `labs/playground/`: a house (basement, ground and upper floors,
   attic, walkable roof) on a block with a yard, a street, a gym of calibrated features, a hill, a firing range and a
   sparring ring (docs/PLAYGROUND.md). It is to Phase 13 what the Stress Box was to Phases 2 to 7: every capability the
   phase builds is shown there, and its content stays sample content (PLAN.md §5.7).
2. **The character first.** The player moves as in Apex Legends: walk, run, sprint, crouch, slide, slide-jump, air
   strafing, mantle, vault, wall-climb, the superglide, ziplines, ladders, launchers and the door kick, with Apex's
   numbers where they are known (docs/PLAYGROUND.md §3.2 cites each) and every one checked headless by `node x feel`.
   Stage 1 (G10) builds the character, its animation and its cameras in the gym, before any of the house.
3. **Five cameras, two looks.** First person, a third-person shooter camera, a third-person platformer camera,
   isometric and top-down, switched live with a blend; a cel-shaded look and a pixel-art look done properly in each. We
   compete on gameplay, features and content, where agents excel, not on graphics; the simple asset system
   (procedural, then text) is an advantage.
4. **The long aim for gameplay.** The engine grows to play like Red Dead Redemption 2, GTA V, Apex Legends and
   Cyberpunk 2077: their gameplay, not their graphics. docs/PLAYGROUND.md §11 maps the road; each later slice is its
   own ADR and phase, chosen after the owner plays this one.
5. **The playground fires the on-demand WPs it needs.** All 21 (5.6, 7.5, 7.6, 7.7, 8.8, 10.1 to 10.6, 10.8, 10.9,
   11.1 to 11.5, 12.1 to 12.3) have a need in the playground, named in their Trigger lines, and Phase 13's stages
   schedule them. Two run on the owner's order rather than a measured need: 7.6 (an agent playtester through MCP) and
   12.2 (usability tasks over the playground, and mutation testing).
6. **What the owner's full permission covers** ("I am giving you full permission to take the plan further so that it
   is fully complete"): the devDependencies WPs 7.6 and 12.2 name (`@modelcontextprotocol/sdk`; `@stryker-mutator/core`
   and `@stryker-mutator/vitest-runner`), each pinned by PLAN.md §6.10's rule with its reason in tools/deps.json; and
   WP 8.8's downloads of public sources into `.cache/`, never committed. Still the owner's, escalated when reached: the
   Quaternius GLBs (WP 8.8 does everything else without them), model access for WP 12.2's live evals (its dry run
   stands until then), money, repository settings, and binary assets other than fonts.
7. **Nothing that passes today changes.** New movement, cameras, level formats and looks are opt-in:
   `movement:platformer` is today's controller, and a format-1 level compiles to the same data and hash, so every
   existing golden holds.

## Why
The owner's direction of 2026-10-17: the foundation is proven (G0 to G9), but there was nothing to touch and feel, and
that left them stuck. A vertical slice that shows the engine's flexibility, its animation and everything a player can
do, built around a character that moves, looks and feels right, gives the owner and agents a place to decide what to
build next. Movement, cameras and animation come first because if the core character does not feel and look good,
nothing built on it matters.

The doctrine's North Star still holds: every Phase 13 WP serves a need of the playground, and the on-demand WPs start
because the playground needs them (the trigger rule of PLAN.md §9.1), not in anticipation. Apex's movement is
Titanfall 2's, whose air strafing is Quake's: the community has measured and reconstructed it in detail, so its numbers
are known and emulating it is common ground rather than invention.

## Enforced by
PLAN.md Phase 13 and the ledger (§14); docs/PLAYGROUND.md, the design and its reference values; `node x feel` (WP 13.4)
and the playground's README test (WP 13.1); the verifier at each of G10 to G13.
