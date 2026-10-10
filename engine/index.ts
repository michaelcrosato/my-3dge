/**
 * @file The engine's front page: the public API for pages and tools (PLAN.md §6.1, §6.9, WP 1.6; doctrine: Quality
 * under the hood). A game's pages import only this module, its sim-side code only engine/sim-api.ts, which this module
 * re-exports whole (ESLint's public-API rule enforces both), so game agents never read the internals. docs/API.md is
 * the manual: every public name with its doc comment; docs/ERRORS.md gives every error and advice code with its fix.
 *
 * What is here, beyond the sim API: `createHeadless`, the engine without a page (Node, tests, `x sim`), whose object
 * is the inspector a page publishes as `window.__engine` (`help()` lists its members); `createEngine`, the engine in
 * a page, arrives with WP 2.7.
 *
 * Invariants: a flat list of `export … from` lines, one name per line, grouped by area, and append-only: each WP adds
 * its public names at the end of their area, so parallel lanes merge cleanly (§11.3). Each name is documented where
 * it is declared (`x docs --check` fails one without). No engine module imports this file or engine/sim-api.ts
 * (ESLint's layer rules): the barrels are for game code.
 *
 * @example
 * // labs/box/main.ts
 * // import { createEngine, defineScene } from '../../engine';
 * @see engine/sim-api.ts
 */

// The sim API: everything sim-side game code uses.
export * from './sim-api';

// Headless: the engine without a page, and its inspector (window.__engine in a page).
export { createHeadless } from './app/headless';
export type { Headless } from './app/headless';
export type { HeadlessOptions } from './app/headless';
export type { Inspector } from './dev/inspector';
export type { EngineInfo } from './dev/inspector';
export type { EntitySummary } from './dev/inspector';
