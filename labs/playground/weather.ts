/**
 * @file The playground's weather (docs/PLAYGROUND.md §8.2, PLAN.md WP 11.3): rain over the player outdoors and dust
 * motes hanging about him indoors, two running emitters the page runs each drawn frame (`runWeather`, through
 * `EngineFrame.emit`) and draws as GPU particles (`gpu`): the GPU's ring of 65,536 while `feature:gpuParticles` is on,
 * the CPU pool otherwise, which thins the rain to its 4,096 and counts the drops it leaves out. The view settings
 * `playground.rain` and `playground.dust` (0 to 1, 0 by default) say how hard it rains and how thick the dust
 * hangs, as a share of `WEATHER`'s rates; a view setting never reaches the hash.
 *
 * The rain falls over a 36 m square round the player, from 13 m above his feet at 14 m/s, and stops while he is
 * indoors (no drop finds a roof: those falling finish their second); a drop that reaches the ground below him is hidden
 * by it, as the particles are tested against the scene's depth. The dust shows only indoors.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts).
 *
 * @example
 * // onFrame: (frame) => runWeather(frame, (at) => indoorsAt(frame.scene, at)),
 * // __engine.set('playground.rain', 1); // a downpour, from the next frame
 * @see labs/playground/weather.test.ts
 */
import { defineEmitter, defineSettings, type EngineFrame } from '../../engine';

/** The weather's emitters and their rates at full strength (particles a second). */
export const WEATHER = {
  rain: { emitter: 'emitter:playground-rain', rate: 30_000 },
  dust: { emitter: 'emitter:playground-dust', rate: 240 },
} as const;

/** The weather's view settings: how hard it rains and how thick the dust hangs. */
export const PLAYGROUND_WEATHER_SETTINGS = defineSettings({
  'playground.rain': {
    type: 'number',
    minimum: 0,
    maximum: 1,
    default: 0,
    view: true,
    description: "How hard it rains on the playground's block (labs/playground/weather.ts): 0 dry, 1 a downpour.",
  },
  'playground.dust': {
    type: 'number',
    minimum: 0,
    maximum: 1,
    default: 0,
    view: true,
    description: 'How thick the dust motes hang indoors on the playground (labs/playground/weather.ts): 0 none.',
  },
});

defineEmitter(WEATHER.rain.emitter, {
  description: "The playground's rain: streaks falling over a 36 m square from 13 m up, at 14 m/s (shardfall's rain).",
  ...{ area: [18, 0, 18], offset: [0, 13, 0], velocity: [0.4, -14, 0.2], spread: 0.3, life: [0.9, 1.05] },
  ...{ size: [0.016, 0.016], color: ['#dae7ff', '#dae7ff'], alpha: [0.5, 0.3], additive: false, stretch: true },
  ...{ rate: WEATHER.rain.rate, gpu: true },
});

defineEmitter(WEATHER.dust.emitter, {
  description: "The playground's dust: motes drifting and glinting about the player indoors, a few seconds each.",
  ...{ area: [3.5, 1.2, 3.5], offset: [0, 1.3, 0], velocity: [0, 0.03, 0], spread: 0.05, gravity: 0.02 },
  ...{ drag: 0.5, turbulence: 0.15, life: [6, 9], size: [0.006, 0.006], color: ['#fff2d8', '#fff2d8'] },
  ...{ brightness: [1.5, 1.5], alpha: [0.7, 0], additive: true, prewarm: 6, rate: WEATHER.dust.rate, gpu: true },
});

/** A weather setting's strength: its value, 0 to 1. */
const strength = (value: unknown) => Math.min(1, Math.max(0, Number(value) || 0));

/** The player as the frame's world holds him: where his feet are. */
type PlayerActor = { actor: { player: boolean; x: number; y: number; z: number } };

/**
 * Runs the weather for this frame (see the file comment): the rain over the player while he is outdoors, the dust
 * about him while he is in, each at its setting's share of its rate; nothing without a player.
 */
export function runWeather(frame: EngineFrame, indoors: (at: { x: number; y: number; z: number }) => boolean): void {
  const player = (frame.world.query('actor') as unknown as PlayerActor[]).find((one) => one.actor.player)?.actor;
  const [rain, dust] = [strength(frame.setting('playground.rain')), strength(frame.setting('playground.dust'))];
  if (!player || (rain === 0 && dust === 0)) return;
  const inside = indoors(player);
  const at = [player.x, player.y, player.z] as const;
  if (rain > 0 && !inside) frame.emit(WEATHER.rain.emitter, at, 'playground:rain', rain);
  if (dust > 0 && inside) frame.emit(WEATHER.dust.emitter, at, 'playground:dust', dust);
}
