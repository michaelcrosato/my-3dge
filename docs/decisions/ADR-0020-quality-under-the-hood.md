# ADR-0020: Quality under the hood, behind a public API

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §3 (Quality under the hood), §6.1, §6.10 rule 7

## Decision
- Game code imports only `engine/index.ts` (pages) and `engine/sim-api.ts` (sim-side code).
- Every public export is documented, and every error names its fix in API terms, so game agents never need to read
  the internals.
- Behind that boundary, internals use the highest-quality approach their builder can execute well, newer releases
  included when a measurement on the platform shows better quality (§6.10, rule 7).

## Why
Doctrines Quality under the hood and Common ground: the engine is built once and used many times; its complexity
stays behind a familiar API.

## Enforced by
ESLint's public-API rule for game code (WP 0.4); `x docs --check` (every export documented, every error code with a
fix); the `verifier`.

## Amendment 1 (2026-10-10, WP-1.1)
three.js's `Color` joins the math classes `core/math` re-exports (§6.1's list; `THREE_MATH` in
tools/eslint/layers.ts, with a layer test). WP 1.1 asks for `color`'s sRGB ↔ linear conversion "over three.js's
`Color` where it fits", and `core/math.ts` is the one file outside `gfx/` that may import three.js, so the plan needs
`Color` there to be consistent. It lives in three.js's `src/math/`, agents know it, and going through it makes
`toLinear('#808080')` equal what a material holds for the same hex (engine/core/color.test.ts checks every reference
colour against `Color.set`). Nothing else from three.js's colour management (`ColorManagement`, the colour-space
constants) is allowed.

## Amendment 2 (2026-10-10, WP-1.6): the barrels and the public-API rule
- **What the barrels hold.** engine/sim-api.ts: scenes (`defineScene` and its types), the world's types,
  `defineComponent`, the phases, `defineKind` and `def`, the schema and settings types, `defineSettings`, the intents
  vocabulary (`held`, `pressed`, `fromCamera`, `INTENT_KEYS` and types), three.js's math classes with core/math's
  helpers, `Rng`, and the event types. engine/index.ts re-exports it with `export * from './sim-api'` (so names
  appended there reach pages unedited) and adds `createHeadless` and the inspector's types. Both are flat lists of
  `export … from` lines, one name per line, grouped by area under a line comment; each name is documented where it
  is declared, which `x docs --check` enforces, so the barrels never restate a doc comment.
- **The rule is on** (`SWITCHES.publicApi`), and the kernel fixture imports only engine/sim-api.ts.
- **What G0 deferred to WP 1.6**, each with failing and passing fixtures in tools/eslint/*.test.ts:
  - every engine layer refuses the barrels (`../index`, `../sim-api`, and `..` however spelt): they re-export the
    engine, so such an import is a cycle;
  - side-effect and dynamic imports go through `public-api/no-unnamed-imports`, a local rule that resolves relative
    sources from the importing file as the named-import rule does (`./../../engine/core/x` is
    `../../engine/core/x`); it replaces the `no-restricted-syntax` selectors, which matched the source as written;
  - a banned three.js name read off a namespace goes through `banned/no-namespace-names`
    (tools/eslint/namespaceNames.ts), which follows the bindings: any namespace name (`import * as T`), computed reads
    (`T['screen']`), destructuring (`const { screen } = TSL`), three.js's `TSL` object (`import { TSL }`,
    `THREE.TSL.x`), and the docs' names unbound; a namespace passed through another variable is not followed. The
    syntax selectors keep the names imported or re-exported by name;
  - Node's `Buffer` global is banned sim-side, with the other Node globals.
