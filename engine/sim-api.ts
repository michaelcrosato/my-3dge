/**
 * @file The public API for sim-side game code (PLAN.md §6.1, §6.9, WP 1.6; doctrine: Quality under the hood): what a
 * scene, a cast member or a behaviour imports, and all it may import (ESLint's public-API rule), so `x sim` runs it
 * in Node and its play is reproducible. engine/index.ts re-exports all of it for pages.
 *
 * What is here: scenes, the world and its components, the registries and settings, the intents vocabulary,
 * three.js's math classes with the engine's angle helpers, seeded randomness, and the event types. docs/API.md
 * lists every name with the first sentence of its doc comment; `node x describe` lists the registries.
 *
 * Invariants: a flat list of `export … from` lines, one name per line, grouped by area, and append-only: each WP adds
 * its public names at the end of their area, so parallel lanes merge cleanly (§11.3). Only sim-side modules are
 * re-exported (ESLint's layer rule for this file). Each name is documented where it is declared, and
 * `x docs --check` fails a public export without its doc comment. Game code reaches three.js only through these
 * re-exports.
 *
 * @example
 * // fixtures/scenes/kernel/index.ts
 * // import { defineScene, defineComponent, held, type World } from '../../../engine/sim-api';
 * @see fixtures/scenes/kernel/index.ts
 */

// Scenes: defined as data with a setup and a step, run by x sim, x replay and createHeadless.
export { defineScene } from './sim/scene';
export type { Scene } from './sim/scene';
export type { SceneSpec } from './sim/scene';
export type { SceneAction } from './sim/scene';

// The world: entities, components, systems, timers, events.
export type { World } from './sim/world';
export type { SimRng } from './sim/world';
export type { WorldTimers } from './sim/world';
export type { WorldEvents } from './sim/world';
export { defineComponent } from './sim/state';
export type { Entity } from './sim/state';
export type { With } from './sim/state';
export type { SpawnSpec } from './sim/state';
export type { ComponentOf } from './sim/state';
export { PHASES } from './sim/systems';
export type { Phase } from './sim/systems';
export type { SystemFn } from './sim/systems';

// Registries and settings: content as data, one schema for every setting.
export { defineKind } from './core/registry';
export { def } from './core/registry';
export type { Entry } from './core/registry';
export type { Kind } from './core/registry';
export type { KindSpec } from './core/registry';
export type { Field } from './core/schema';
export type { Schema } from './core/schema';
export { defineSettings } from './core/settings';
export type { SimSettings } from './core/settings';
export type { SettingValue } from './core/settings';

// Intents: what the sim reads from outside each step.
export { held } from './input/intents';
export { pressed } from './input/intents';
export { fromCamera } from './input/intents';
export { INTENT_KEYS } from './input/intents';
export type { Intents } from './input/intents';
export type { IntentValue } from './input/intents';
export type { CustomIntentKey } from './input/intents';

// Math: three.js's math classes and the engine's helpers (MathUtils covers clamp, lerp, damp, smoothstep).
export { Vector3 } from './core/math';
export { Quaternion } from './core/math';
export { Matrix4 } from './core/math';
export { Euler } from './core/math';
export { Box3 } from './core/math';
export { Sphere } from './core/math';
export { Ray } from './core/math';
export { Plane } from './core/math';
export { Color } from './core/math';
export { MathUtils } from './core/math';
export { approach } from './core/math';
export { angDiff } from './core/math';
export { lerpAng } from './core/math';
export { approachAng } from './core/math';
export { smoothDamp } from './core/math';
export { ease } from './core/math';
export { swingTwist } from './core/math';

// Randomness: seeded streams (the world's are w.rng('<stream>')).
export { Rng } from './core/rng';

// Events: emitted with w.emit, heard with w.events.on.
export type { EventMap } from './core/events';
export type { Listener } from './core/events';
export type { TraceRecord } from './core/events';
