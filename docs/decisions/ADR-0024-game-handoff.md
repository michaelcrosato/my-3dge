# ADR-0024: Handing the engine to game agents: one URL, one command, one guide

Status: accepted · 2026-10-15 · Records PLAN.md WP 10.7 (the game template, built; its store split off as WP 10.9)
and WP 12.4 (built as the guide's generated section); amends §6.2

## Decision

1. **One handoff for every agent, from any lab: the repository's URL.** The owner gives each agent the URL and the
   game to make (docs/HANDOFF.md has the prompt). README.md's first section gives the agent one command. Nothing is
   packaged by hand: when files must be handed, the single archive is GitHub's own ZIP of main (or of a commit), with
   the same command, and the single file is docs/GAME-GUIDE.md.
2. **A game is its own repository**, made by `node tools/game/new-game.mjs <dir>`: plain JavaScript for any Node from
   18, run straight after a shallow clone. It copies the engine's files byte for byte and pins them in
   engine-lock.json (the commit, each file's SHA-256), copies the starter game (labs/game/), and writes the game's root
   files (AGENTS.md, CLAUDE.md, GEMINI.md, README.md, ENGINE-FEEDBACK.md, package.json with the engine's pins,
   .claude/settings.json). It keeps this repository's layout, so the `x` commands, lint rules, templates, baselines
   and configs work unchanged, but for the few that are the engine's own (item 4). The plan, records, CI, suites,
   fixtures and port references stay here (tools/game/files.mjs `RULES`; a test makes every new root file a decision).
3. **The engine is vendored, not a submodule or an npm dependency** (WP 10.7 named either): cloud agents often clone
   without submodules and trip on detached heads; a vendored engine works offline, needs nothing at install time
   beyond npm, and stays searchable (ripgrep skips node_modules, so a dependency's sources and comments would vanish
   from an agent's searches). The lock does a submodule pin's job: `npm run check` fails on an edited engine file
   unless ENGINE-FEEDBACK.md declares the patch, and `node x engine --update` moves a game to a newer engine, keeping
   the game's files and its declared patches.
4. **A game is a game mode of the same tools.** With engine-lock.json at the root, the engine's own commands (ci,
   deps, docs, esc, port, src) are not commands; `x check` runs the asset scan (its approvals the game's own
   APPROVED-BINARIES.json, the owner's answer as the reason, with no escalation record; fonts in labs/game/) and the
   `engine` plugin, which also catches a file the game adds in the engine's folders; `x new` says what a game does
   instead of the box's scene kind; scripts/setup.sh skips the source checkouts; `npm run build` ships the game's pages
   without the box. `--update` replaces nothing of the game's: it stops, having written nothing, on a file or a
   package.json entry of the game's where the newer engine brings its own (`--force` lets the engine's win), keeps
   declared patches, and brings the root files the game never edited to the new templates, naming the edited ones
   whose templates changed (the lock records what new-game.mjs wrote).
5. **The starter game lives here as labs/game/**, at the path it has in every game, so the engine's suites check it on
   every change and a new game needs no renaming. It is sample content, like the box (§5.7), not the game: a scene
   (a level as text, settings, components, systems in the phase `rules`, a named random stream, events), a player, a
   bot, a page with a HUD, and the tests every game keeps (its golden replay, capture and restore, the bot winning on
   10 seeds, a rule). Every lab's `scenes/` and `cast/` are now sim-side game code to the lint rules, not only the
   box's.
6. **docs/GAME-GUIDE.md is the single-file handoff** (WP 12.4, built this way instead of a command of its own):
   hand-written guidance for game agents, ending with the public API by area, which `x docs --write` generates from
   the barrels' area comments and `x docs --check` keeps current; the whole is held to 60 KB (45 KB, about 11,000
   tokens, written).
7. **The proof runs in the full run**: `node x engine --test` makes a game from the checkout and runs its gate (npm
   ci, npm run check, npm test, x sim, x replay in Node and Chromium, x shot, x qa of every family, x help): 2.5 min
   here, 96 s of it x qa. The quick gate is unchanged.
8. **Feedback at scale**: each game keeps ENGINE-FEEDBACK.md (requests, friction, declared patches), which the owner
   collects across games and an engine agent works from.
9. **The store is split off** as WP 10.9, on demand until the first game saves: no game needs it to start.

## Why

The owner's ask of 2026-10-15: many agents from different labs, each making a different game at the same time, with
the least hassle; one file or archive when files are handed, else a URL; packaged tiers only if they pay their upkeep.

- A coding agent reads on demand. What a repository costs it is what loads every session and what misleads it, not
  its size on disk. In the engine's own repository a game agent would load the engine's rules, a hook that clones the
  ported sources, an hour-long CI and 3,380 engine tests. In a game it loads about 50 lines of game rules and one
  guide, and its `npm test` runs its own tests in seconds.
- Hand-made tiers (bare, recommended, full) would need rebuilding and retesting at every engine change. Here each tier
  comes from the same checkout by rule: the guide (one file, generated where it names the API), the game (one
  command, proved in the full run), the whole engine (the URL or its ZIP).
- A model without a shell can only read; for it, one file of about 11,000 tokens beats the 704 KB API.md.

## Enforced by

tools/game/files.mjs, tools/game/new-game.mjs and tools/game/new-game.test.ts; tools/cmd/engine.ts (`x engine`, the
`engine` plugin, `--test`) and its test; tools/x.ts (`ENGINE_ONLY_COMMANDS`, `isGame`) and tools/cmd/help.ts (the
engine's own commands, no commands in a game); tools/cmd/check.ts (a game's binary approvals); tools/cmd/new.ts (the
kinds that make no entry in a game); tools/lib/docsGameApi.ts and tools/cmd/docs.ts (the guide's API section and its
budget); scripts/setup.sh; tools/cmd/ci.ts (`x engine --test` in the full run); labs/game/scenes/play.test.ts and
tests/e2e/game.spec.ts; vite.config.ts (a game's build); tools/eslint/publicApi.ts and tools/eslint/simSide.ts
(`labs/*/scenes/`, `labs/*/cast/`).