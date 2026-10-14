# Handing off my-3dge

For the owner and for an agent picking the engine up somewhere new. Where things stand is docs/PROGRESS.md.

## Starting in a new environment

```bash
git clone https://github.com/michaelcrosato/my-3dge && cd my-3dge && bash scripts/setup.sh
```

setup.sh installs Node 24.22.0, clones the read-only sources at their pinned commits and runs `npm ci`; CLAUDE.md
says where Chromium comes from (the cloud container's, or setup.sh's download, ADR-0014 amendment 8). GitHub's
`integration` branch holds the same files as `main` with every lane's commit; `main` has them squashed, one commit per
stage PR. The owner's testing budget is ADR-0022, with what the stage runs learned in its amendment 1.

## Handing the engine to an agent to try

The engine's repository holds no game (PLAN.md §5.7), and the game template that scaffolds one (WP 10.7,
`node x new game`) waits for the owner to start a game. Before building it, a cheap trial shows whether a fresh agent
can make a game from the docs alone: give it a throwaway branch that is never merged.

```bash
git worktree add ../my-3dge-trial -b trial/first-game origin/main
cd ../my-3dge-trial && bash scripts/setup.sh
```

Then, in any coding agent (all of them read AGENTS.md):

```text
You are a game developer trying out the my-3dge engine for the first time. This
checkout is a throwaway trial branch: nothing here gets merged.

Goal: build one small playable game in labs/<game>/ (a folder of your own), for example a 2-minute arena
survival: the player fights waves of enemies, with a score and a game-over screen.
Use only what a game would: import from engine/index.ts and engine/sim-api.ts,
never engine internals. Do not edit engine/; if the engine blocks you, write down
what you needed and work around it.

Learn the engine the way a game agent would: docs/INDEX.md (start here),
docs/API.md, docs/ERRORS.md, `node x new` for templates, `window.__engine.help()`
in the page, and labs/box as a worked example. Run it with `npm run dev` and open
/labs/<game>/. Prove it with one recorded replay that gives the same hashes twice
(`node x replay`).

Keep it small: stop after about 2 hours of work. Finish with a short report:
1. What you built, and how to open it.
2. A friction log: every place the docs, errors, templates or API slowed you
   down, confused you or were missing, most costly first.
3. What you would want the engine to add before building a real game.
```

The friction log is the result: it says what to fix before agents build real games (a light form of WP 12.2's
fresh-agent evals). If the trial goes well, WP 10.7 makes the standard handoff: a separate game repository with the
engine as a pinned submodule, its own AGENTS.md and a scene with its replay test and bot.

## What a person sees, against my-3d2dge's stress-world

https://my-3d2dge.vercel.app/stress-world (about 2,600 lines, a temporary lab built in hours) shows most of what the
box shows: the hall, the hero's moves, the walker, slime and wisp crowd with flow fields and attack tokens, the cel,
pixel, bloom and FXAA filters, 5,000 bodies. It is the better demo for a person: a full panel with presets, live fps
and a bottleneck readout, a benchmark button, monster skins, waves, the card characters and a WebGL fallback. What
my-3dge adds is underneath: audio, the 1,218-clip animation library with reactions, replays with the same golden
hashes in Node and Chromium, about 3,400 tests, and a documented public API for game code. That only pays off once
agents build games on it. The box's menu (labs/box/menu.ts) is the first step toward the panel.
