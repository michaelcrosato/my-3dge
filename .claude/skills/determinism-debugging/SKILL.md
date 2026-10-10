---
name: determinism-debugging
description: How to find and fix a determinism bug in my-3dge — a replay that misses its golden hashes, Node and Chromium giving different hashes, two runs of the same replay disagreeing, or a capture that does not continue exactly. Bisect with node x replay --bisect to the first step, entity and field, then check the usual causes (Math aliases, **, iteration order, view settings, async inside withSimMath, module state, presentation leaking into the sim). Use whenever x replay, a replay test or a hash comparison fails.
---

# Determinism debugging

The contract is PLAN.md §6.5 (ADR-0006): identical inputs and seed give identical hashes, in Node and in Chromium,
run after run. The hash covers everything a capture holds (engine/sim/state.ts says what), so a mismatch is real.

## 1. Bisect to the first step, entity and field

```sh
node x replay tests/replays/<name>.replay.json --browser sim --bisect --runs 1
```

It hashes every step of a Node run, a second Node run and a Chromium run, and replays the first pair that parts to
that step. Read the lines (or `out/replay/<target>/report.json`, metrics `<name>.bisect.*`). With several replays
failing, each failure carries the bisect's first line (`…; bisect: Node and Chromium part after step 92: …; first
field …`); the field lines follow only when one replay fails, so bisect one file for the detail.

- `Node and Chromium part after step 92: parts entities; entities 2; first field entities.2.mover.heading (Node …,
  Chromium …)` → a runtime difference: go to 2.
- `Node and Node again part …` → state that survives between runs in one process: module-level variables, caches,
  a registry entry mutated, a listener left on a shared emitter. Each run must start from the scene alone.
- `every run agrees step by step, but they part from the goldens between step 300 (matches) and 360` → not a drift:
  the code, data or a dependency changed what the sim does. Intended → `--browser sim --update` and say why in the
  commit; otherwise compare with the commit that recorded the goldens (`git log -1 -- <file>`).
- `at step 0 (after setup)` → the scene's `setup` already differs (spawn positions, seeds).
- `inputs just before (at k)` names the change-point applied before the step: a `set` or `dev` action there is the
  first suspect.

`--swap none` (or `--swap sin,pow`) runs Chromium with fewer fdlibm ports: a replay that depends on the swap must
then fail. Use it to check that a new scene really exercises the swap, never to make a test pass.

## 2. What to check, in this order

1. **Math aliases.** The swap replaces `Math.sin`, `Math.cos`, `Math.pow` only while the sim runs, so sim-side code
   calls them by name. `const { sin } = Math`, `const pw = Math.pow` and `**` / `**=` keep the native function
   (they drift between Node and Chromium, or between Node releases). ESLint bans them sim-side; code outside
   `SIM_SIDE` (tools/eslint/simSide.ts) called from the sim is not covered: move it, or call by name.
2. **A Math function that newly differs.** `npm run e2e -- tests/e2e/drift.spec.ts` names any function that differs
   natively; its stdlib port joins `SIM_MATH` (engine/core/simMath.ts).
3. **Iteration order.** Entities iterate in id order (`w.query`); never iterate a `Map`, `Set` or object whose
   insertion order depends on timing or on another runtime's order. Sort with a total comparator (one that never
   returns NaN; `a < b ? -1 : a > b ? 1 : 0` for text, never `localeCompare`).
4. **View settings and presentation.** The sim reads settings through `w.settings` (view ones are refused there).
   A presentation fact the sim needs (camera heading, a screen-space aim) arrives as an intent, so it is recorded;
   nothing from the renderer, the DOM, the clock or `Math.random` reaches the sim (ESLint's sim bans).
5. **Async inside the sim.** `withSimMath` only covers synchronous code: an `await`, a promise or a callback that
   runs later leaves the swap (`CORE_SIM_ASYNC`). Systems, timers, listeners and dev actions are synchronous.
6. **Inputs recorded differently from what the sim got.** Step through `session.step(intents)`, never
   `world.step()` (`SIM_OFF_RECORD`). Setting changes are recorded whether they go through `session.set` or the
   session's own store (`session.settings`: set, setText, load, fromUrl, reset, override): the session compares the
   store's non-view values before each step, set and dev action and records each difference at that step. A store the
   session does not own (another `createSettings()`) never reaches its world. Dev actions run through `session.act`,
   all or nothing (one that throws is rolled back and not recorded). `-0` and `0` are different inputs, and replay
   text keeps `-0`.
7. **Captures.** A value outside the declared component fields is refused (`SIM_UNDECLARED_FIELD`); timers restore
   only into their own world (`SIM_NO_CALLBACKS`). Keep delays that must survive text in component fields.

## 3. Prove the fix

The bisect line is gone; `node x replay tests/replays --browser sim` passes three times in each runtime; a replay
or unit test that reproduces the bug stays in the suite (a behaviour bug becomes a replay, PLAN.md §8.4).
