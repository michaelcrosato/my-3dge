# ADR-0015: Docs: the comment is the manual

Status: accepted · 2026-10-10 · Records PLAN.md §13.1, §6.8, §8.12

## Decision
- JSDoc file comments and export comments are the manual (§6.8).
- `docs/INDEX.md`, `docs/API.md` and `docs/ERRORS.md` are generated from them (`x docs --write`).
- Prose is never duplicated: a fact lives in one place.
- Pinned knowledge is the packages' own sources and types in `node_modules`, `docs/THREE-DELTA.md`, and the TSL
  reference as it stood for the pinned three.js.

## Why
Doctrine Agent-readable: docs generated from the code cannot drift, and agents read the pinned release's own sources
rather than their memory of another.

## Enforced by
`x docs --check` in T0 (WP 0.6); `eslint-plugin-jsdoc`'s file-overview rule (WP 0.4).

## Amendment 1 (2026-10-10, WP-0.6)
Calls made where the plan is silent, and WP 0.6's paths widened:
- **Paths.** `x docs` is a thin command, `tools/cmd/docs.ts` (the checks and the `x check` plugin), over
  `tools/lib/docs.ts` (the reader), `docsCodes.ts` (`defineCodes`), `docsExamples.ts` (the runner), `docsGenerate.ts`
  (INDEX, API, ERRORS) and `docsPaths.ts` (the path checks). As one file it measured about 1,200 lines, over the hard
  cap of 600 (doctrine: Agent-readable). WP 0.6 also extends the `@example` blocks of `tests/setup/adviceTrap.ts`,
  `tools/lib/depsCheck.ts` and `tools/lib/depsUpdate.ts`, doc comments only: written before anything ran them, two
  used free names (`root`, `fixture`) and one threw on purpose.
- **Modules** are the code under `engine/`, `tools/`, `labs/` and `tests/` (where ESLint requires file comments)
  plus the root's `*.config.{ts,js}`; tests, `fixtures/` directories and `tools/templates/` are left out. `x.js`, a
  six-line launcher whose line comment points at `tools/x.ts`, is not a module.
- **Every export** has a doc comment, not only the public ones (§6.8, §9.3 item 3); a default export is documented by
  its file comment, a re-export by its declaration. A file comment over 40 lines fails (§6.8).
- **Examples** run as the body of an async function whose parameters are the module's named exports; `import` lines
  resolve from the module. Browser examples (page code, modules that import Playwright, or a first line
  `// browser`) are flagged, and listed in the report's `examples.t2List`; no WP owns a T2 runner for them yet. The
  `x check` plugin leaves the examples out, so T0 stays fast; `x docs --check` and T1 run them.
- **Path checks** also cover README.md, Markdown links, and the names `node x <cmd>` and `npm run <script>`. A path
  that does not exist yet passes while a WP whose ledger status is not `done` owns it (PLAN.md §9 **Owns**), or
  §6.2's layout lists it: AGENTS.md and the ADRs name what later WPs build, and once that WP is done the path must
  exist. The generated docs are checked through the comments they come from; `@example` blocks are run instead.
- **API.md** lists the public API first (`engine/index.ts`, `engine/sim-api.ts`, each export followed to its
  declaration), then every other module's exports with their first sentences; INDEX lists the names.
- **Codes.** `defineCodes('<area>', { <AREA>_<NAME>: { template, fix, doc } })`, read statically, so written with
  literals; a code starts with its area in upper case, as the advice trap reads `[CODE]`; `template` and `fix` are
  required, `doc` optional; a code registered twice fails. WP 1.2's `defineCodes` takes this form.
- **`x new`.** A kind's manifest is `tools/templates/<kind>/template.json` (`describe`, `id`, `pattern`, `sample`,
  `files`, `checks`: `types`, `lint`, `test`, `docs`). Template files are `.tmpl` text, so tsc, ESLint and Vitest never
  read their placeholders; `--test` writes the sample into the repository, checks it and removes it.

## Amendment 2 (2026-10-10, WP-1.2 review fixes)
- **Kinds.** `defineKind('<kind>', { description: '…', … })` is read statically by `tools/lib/docsKinds.ts`, as
  `defineCodes` is, and `docs/INDEX.md` opens with a table of kinds (kind, description, declaring module), PLAN.md
  §6.6's row per kind. A declaration with a literal kind but no literal description fails (`DOCS_KIND`), and so does
  a kind declared twice; a call whose kind is not a literal (the registry's forwarding functions) is skipped.
- **Generated paths.** A path inside a git-ignored directory that tools generate (`node_modules/.cache/`, `out/`,
  `.cache/`, `dist/`) always passes the path checks: a fresh checkout has none of them, and `x docs --check` failed
  there on the caches that eslint.config.js and tools/checkAll.ts cite.
