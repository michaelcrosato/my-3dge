/**
 * @file The replay page's module (`tests/pages/replay.html`), Chromium's half of `node x replay --browser sim` (PLAN.md
 * §6.5 item 9, WP 1.5): the sim in a page with no renderer. It publishes `window.__replay`, which loads a scene module
 * and plays replays through the very player Node runs (engine/sim/replay.ts), then signals ready through
 * `window.__engine`. It draws nothing and runs nothing until the tool calls it.
 *
 * Scene modules come in through `import.meta.glob` (never a `fetch()`, §6.3), over the same roots `x sim` and `x replay`
 * search: `fixtures/scenes/` and `labs/<name>/scenes/`. Replays arrive as their file's text, so every number reaches the
 * player exactly as JSON wrote it. `swap` narrows the fdlibm swap to the names given (an outer `withSimMath`, inside
 * which the world's own calls swap nothing more): `[]` runs native `Math`, to show a replay depends on the swap.
 */
/// <reference types="vite/client" />
import { withSimMath, type SimMathName } from '../../engine/core/simMath';
import { playReplay } from '../../engine/sim/replay';

/** The scene modules the page can load, by path from this file. */
const SCENES = import.meta.glob(['../../fixtures/scenes/**/*.ts', '../../labs/*/scenes/**/*.ts', '!**/*.test.ts']);

/** How a replay plays in the page: every step hashed or the replay's checkpoints, and the swap's names. */
interface PageOptions {
  every?: boolean;
  swap?: SimMathName[];
}

/** Runs `fn` under the swap the options name (the world's own when they name none). */
function swapped<T>(options: PageOptions, fn: () => T): T {
  return options.swap ? withSimMath(fn, options.swap) : fn();
}

/** What the page offers `x replay`. */
const replay = {
  /** Imports a scene module, given by its repository path (`fixtures/scenes/kernel/index.ts`). */
  async load(file: string): Promise<void> {
    const load = SCENES[`../../${file}`];
    if (!load)
      throw new Error(
        `the replay page cannot load ${file}: scene modules live under fixtures/scenes/ or labs/<name>/scenes/`,
      );
    await load();
  },
  /** Plays a replay's text from step 0; returns the hashes by step. */
  play(text: string, options: PageOptions = {}): Record<string, string> {
    return swapped(
      options,
      () => playReplay(JSON.parse(text), { checkpoints: options.every ? 'every' : undefined }).hashes,
    );
  },
  /** Plays a replay's text to `step`; returns the world's state, trace and hash there. */
  stateAt(text: string, step: number, options: PageOptions = {}) {
    return swapped(options, () => {
      const { world } = playReplay(JSON.parse(text), { until: step, checkpoints: [] }).session;
      return { state: world.state(), trace: world.trace(), hash: world.hash() };
    });
  },
};

declare global {
  interface Window {
    __replay: typeof replay;
  }
}

Object.assign(window, { __replay: replay, __engine: { ready: true, errors: [] } });
