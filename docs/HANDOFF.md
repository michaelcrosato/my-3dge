# Handing off my-3dge

For the owner, and for an agent picking the engine up somewhere new. Where things stand is docs/PROGRESS.md; the
decision behind this page is ADR-0024.

## Handing the engine to game agents

**The prompt, lean (the default).** Give every agent, from any lab, the same lines, with the game changed:

```text
Make <the game> with the my-3dge game engine. Read this first:
https://github.com/michaelcrosato/my-3dge/blob/main/lean/README.md
```

That is all, for a chat in a browser as much as for a coding agent. lean/README.md is one file of about 10,000 tokens
(ADR-0024 amendment 1): the model, the rules worth keeping, every public name by area, and game.html, a small game
that plays. The agent writes the game as one HTML page that loads the engine (lean/my3dge.js) from jsDelivr, as a page
loads three.js; the page runs when it is opened in a browser with WebGPU. Nothing is installed, built or tested: the
engine's repository tests the package before every merge, so a game does not have to. An agent that cannot open
links gets the same file attached (lean/README.md).

**The prompt, full workspace.** For a coding agent in a sandbox that should check its work as the engine does
(headless tests, replays, renders read as numbers):

```text
Make <the game> with the my-3dge game engine, in its full workspace: https://github.com/michaelcrosato/my-3dge
Start with the "Make a game with my-3dge" section of its README.
```

The agent runs one command in its workspace (an empty repository you made for the game, or a folder): a shallow
clone of the engine into a temporary folder, then tools/game/new-game.mjs, which writes the game:

- the engine, copied byte for byte and pinned by `engine-lock.json` (the commit and every file's SHA-256);
- the starter game, labs/game/: a small game that plays, is won by its bot on 10 seeds and passes its tests;
- the game's own AGENTS.md (CLAUDE.md and GEMINI.md import it): about 50 lines on making this game, which every
  coding agent loads by itself; docs/GAME-GUIDE.md, the engine for game makers, read once (about 11,000 tokens);
- ENGINE-FEEDBACK.md, where the agent writes what it needed from the engine and did not get.

Then the agent sets up (`bash scripts/setup.sh`, or `npm ci`), runs `npm test`, and grows the game from the starter,
checking its work with `npm run check`, `npm test`, `node x sim` and `node x shot`. The engine is read-only in a game:
`npm run check` fails when an engine file changes without a declared patch. An agent that cannot reach GitHub but can
take a file: the ZIP of main (about 7 MB), https://github.com/michaelcrosato/my-3dge/archive/refs/heads/main.zip, and
"run `node <unzipped folder>/tools/game/new-game.mjs <dir>`"; installing still needs npm's registry.

**Many games at once.**

- Lean games need nothing but a browser that reaches jsDelivr: a chat can write one, and you open it. They take the
  engine at `@main`; a game pins today's engine by putting a commit in place of `main` in its two engine URLs.
- One repository per game in the full workspace. Agents in cloud sandboxes need somewhere to push, and this repository
  takes no games: its AGENTS.md sends a game agent to the README.
- Games share nothing while they run (a workspace carries its own pinned engine, about 15 MB), so ten or a hundred
  agents work in parallel without touching each other.
- A workspace agent's sandbox must reach github.com once (the clone) and npm's registry (the install); most coding-agent
  sandboxes allow both. scripts/setup.sh also downloads, only when missing, Node 24 from nodejs.org and Chromium (Chrome
  for Testing) from storage.googleapis.com; without them a game runs on Node 22.12 or newer (Vite's floor), all but the
  browser commands. Where a platform cuts the network while the agent works, put the command in its setup step.
- Every game made the same day is on the same engine (main, as it was). A game moves to a newer engine only when you
  ask its agent: `node x engine --update`, then `npm ci`, `npm run check`, `npm test`, and its replays' goldens
  recorded again where play changed.
- To improve the engine from many games, give an engine agent in this repository the list of game repositories and
  ask it to read their ENGINE-FEEDBACK.md files and turn what recurs into work packages.

## How it works, and why this way

What a coding agent needs, whoever made it: one obvious first step; instructions that load by themselves and are
about its job (AGENTS.md is read by most agents, CLAUDE.md by Claude Code, GEMINI.md by Gemini CLI); a working example
to change rather than a blank page; checks it runs itself, without a screen; docs to search rather than read whole;
pinned versions; and nothing that loads by itself and misleads.

An agent pays for what it reads, not for what is on disk: a repository's size costs nothing, while every line that
loads each session, and every file opened while finding its way, costs tokens and attention. So a game loads about
50 lines of rules and reads one guide once; docs/API.md (704 KB) and the engine's file comments are there to grep.

Why not the engine's own repository, with the game inside it: a game agent there would load the engine's rules (work
packages, the ledger, escalation records), a setup hook that clones the projects the engine was ported from, an
hour-long CI and 3,380 engine tests, and ten agents pushing games into one repository would collide.

Why lean is the default (the owner's call of 2026-10-16, after a dozen trials): a library ships as three.js, Rapier
or Babylon.js do, as code and docs, without its tests and checks; and a model building in a chat answers in minutes,
often with no sandbox at all, so it cannot run an hour of tests or a toolchain. The engine's repository keeps the
checks for itself and runs them on the package before every merge.

Why not hand-made packages: each would need rebuilding and retesting at every engine change, and would go stale. Here
each comes from the same checkout by rule, and is tested: the lean package is written by `node x docs --write`, held
current by `x docs --check` and played in Chromium by tests/e2e/lean.spec.ts; the full workspace is made by one
command and proved after every merge (`node x engine --test`, in the full run); the repository, or its ZIP, is the
complete one.

Why the engine is copied into each game, not linked: it works offline, with no submodule for a cloud agent to trip
on, and it stays searchable (agents' search tools skip node_modules). The lock does what a pin would.

## Starting in a new environment

```bash
git clone https://github.com/michaelcrosato/my-3dge && cd my-3dge && bash scripts/setup.sh
```

setup.sh installs Node 24.22.1, clones the read-only sources at their pinned commits and runs `npm ci`; CLAUDE.md
says where Chromium comes from (the cloud container's, or setup.sh's download, ADR-0014 amendment 8). `main` holds
every stage, one squashed commit per stage PR (the `integration` branch that kept every lane's commit was deleted on
GitHub on 2026-10-14; the PRs' pages keep each stage's commits; the owner deleted the `game/*` branches, on purpose,
ADR-0023). The owner's testing budget is ADR-0022, with what the stage runs learned in its amendment 1; ADR-0023 keeps
long tests from holding up work: merges wait on the quick gate, and the full run follows on GitHub.

## What a person sees, against my-3d2dge's stress-world

https://my-3d2dge.vercel.app/stress-world (about 2,600 lines, a temporary lab built in hours) shows most of what the
box shows: the hall, the hero's moves, the walker, slime and wisp crowd with flow fields and attack tokens, the cel,
pixel, bloom and FXAA filters, 5,000 bodies. It is the better demo for a person: a full panel with presets, live fps
and a bottleneck readout, a benchmark button, monster skins, waves, the card characters and a WebGL fallback. What
my-3dge adds is underneath: audio, the 1,218-clip animation library with reactions, replays with the same golden
hashes in Node and Chromium, about 3,400 tests, and a documented public API for game code. That only pays off once
agents build games on it. The box's menu (labs/box/menu.ts) is the first step toward the panel.
