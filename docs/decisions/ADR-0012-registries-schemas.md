# ADR-0012: Registries and schemas

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.6, §8.13

## Decision
- "Ask the entry, never the id": shared code reads a registry entry's hooks and never compares ids.
- Every kind gets an `x describe` listing (also `__engine.describe()`) and docs.
- Scaffold templates (`x new`) arrive with use: the WP that writes a kind's third entry by hand adds its template
  (§8.13). `gallery` hooks arrive with the gallery (on demand).
- Kinds with a QA family get its checks (§8.6).

## Why
Doctrines Agent-readable and Agent-operable: content is data, discoverable and checkable by machine, and extended by
adding entries rather than editing shared code.

## Enforced by
Schema validation in the registry (WP 1.2); `x describe`; the QA families; AGENTS.md's rule.

## Amendment 1 (2026-10-10, WP-1.2)
Calls made where the plan is silent:
- **The schema's words are JSON Schema's.** A field is a plain object: `type`, `description` (the plan's "doc"),
  `default`, `minimum` and `maximum` (its "range"), `enum`, `items`, `properties`, with per-field `required: true` as
  Mongoose and Vue props write it, plus the engine's own `unit`, `when` and `view`, and two types JSON Schema lacks:
  `function` (a hook) and `any`. Agents know these words from OpenAPI, tool calling and MCP, `x describe` prints a
  schema as it is, and WP 7.6's MCP schemas become a projection, with no builder library (doctrine: Common ground).
  A misspelt keyword (`min`, `doc`) is an error naming the word to write.
- **A fallback is optional.** A kind that declares one (`fallback: '<id>'`) gets the planned behaviour: a missing id
  warns once (`CORE_UNKNOWN_ID`, naming the closest ids) and returns it. A kind without one (settings, inspector
  members: nothing can stand in) throws `CORE_NO_ENTRY`, naming the closest ids. Defining an id twice is an error
  (`CORE_DUPLICATE_ID`); the source let the last one win.
- **Settings are registry entries** of the kind `setting`, keyed by dotted path (`hero.runSpeed`), so `x describe
  setting` lists them like any kind. Scoped overrides are layers: `dispose()` removes exactly its layer, in any order,
  and `set` writes to the newest layer holding the path. A preset, URL or override with any problem applies nothing.
  Sim-side code reads settings through `settings.sim.get`, which refuses `view` settings (`CORE_VIEW_SETTING`).
- **`x describe` finds kinds by itself**: it imports, in Node, each module under `engine/`, `labs/` and `fixtures/`
  that calls `def(…)` or a `define…(…)` function other than `defineCodes`, then lists the shared registry. A module
  that cannot load in Node is a warning naming it.
- **Built in the review fixes (amendment 2):** §6.6's row per kind in `docs/INDEX.md`. `x docs` reads
  `defineKind('<kind>', { description })` statically (tools/lib/docsKinds.ts), as it reads `defineCodes`, and INDEX.md
  opens with a table of kinds: kind, description, declaring module (ADR-0015 amendment 2).

## Amendment 2 (2026-10-10, WP-1.2 review fixes)
- **Warn-once keys on the code and a subject, never on the filled message.** `log.warnOnce(code, values, subject?)`
  prints once per code and subject (what the advice is about: an id, a path; the code itself by default) and counts
  the repeats, as the source's `warn(key, msg)` did with its fixed key (`my-3d2dge:engine/my-3d2dge.js:65-66`): keyed
  on the message, advice carrying a measured value printed and recorded again for every value. `get`'s
  `CORE_UNKNOWN_ID` names `<kind> <id>`. Advice records are capped like errors (`maxAdvice`, 200); a record pushed
  out and raised again is recorded again, never printed again.
- **Entries are frozen all the way down.** `def` freezes a copy of the parsed entry deeply (schema.ts's
  `freezeValue`), and `parse` copies plain objects given to an `any` field too, so a setting's default, as `get` and
  `sim.get` return it, is frozen, and changing the object a caller passed to `def`, `defineSettings` or `set` changes
  nothing stored.
- **`x describe` loads modules in a child Node process**, which sends the listing over IPC and exits: a module's side
  effects never reach the command, a timer it starts cannot keep the run open, and a module still loading after 60 s
  is stopped and named (`DESCRIBE_HUNG`). Rejected: exiting `x` explicitly once the report is written, which ends a
  run a timer holds open but not one whose import never settles, and leaves side effects in the command's process.
  Discovery reads the syntax (TypeScript's parser): comments, strings and declarations do not count, nor `defineCodes`,
  `defineSchema`, `defineProperty`, `defineProperties` or `defineConfig`; member calls count only as `.def(…)` and
  `.defineKind(…)`.
- **A kind may say how its entries are written** (`defineWith`), for the missing-id messages: settings name
  `defineSettings({ '<path>': { … } })`, other kinds `def('<kind>', '<id>', { … })`.
