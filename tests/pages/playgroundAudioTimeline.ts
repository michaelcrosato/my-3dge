/**
 * @file A playground replay's sound timeline (PLAN.md WP 13.22), shared by Node (labs/playground/sounds/
 * events.test.ts) and Chromium (tests/pages/playground-audio.ts): `soundTimeline(text, ground)` plays a playground
 * replay's text step by step, as the page's real-time playback does (engine/app/playback.ts), and reads its sim events
 * as the playground's sounds after the setup and after every step (labs/playground/sounds/events.ts), so each sound
 * carries the step it happened at. `SITE_TIMELINE` is the house replay's golden: one set, which Node and the browser
 * must both give.
 *
 * Invariants: the scene module must be imported first (the caller's: the playground's scenes register themselves);
 * the run is the replay's own, so its last hash is the replay's golden there; the ground is the scene's (the site's,
 * labs/playground/sounds/ground.ts `SITE_GROUND`); nothing here reads a clock.
 *
 * @example
 * // import '../../labs/playground/scenes/site';
 * // import { SITE_GROUND } from '../../labs/playground/sounds/ground';
 * // soundTimeline(readFileSync(SITE_TIMELINE.replay, 'utf8'), SITE_GROUND).hash === SITE_TIMELINE.hash
 */
import { createPlayback } from '../../engine/app/playback';
import { createSession } from '../../engine/sim/session';
import { createSoundReader, timelineHash, type PlaygroundGround, type PlaygroundSound } from '../../labs/playground/sounds/events'; // prettier-ignore

/** The house replay (tests/replays/playground-site.replay.json) and its timeline's golden: how many sounds, their hash. */
export const SITE_TIMELINE = {
  replay: 'tests/replays/playground-site.replay.json',
  sounds: 55,
  hash: '017481cb37c16edc',
};

/** A replay's sound timeline: its sounds, their hash, the world's hash at the end, the events missed (0) and where the
 * player's feet are at the end (the room the page's reverb is then in). */
export interface Timeline {
  events: PlaygroundSound[];
  hash: string;
  worldHash: string;
  missed: number;
  player: [number, number, number] | null;
}

/** Plays a replay's text and reads its sounds after every step, on its scene's `ground` (see the file comment). */
export function soundTimeline(text: string, ground: PlaygroundGround): Timeline {
  const playback = createPlayback(JSON.parse(text));
  const { scene, seed, settings } = playback.replay;
  const session = createSession(scene, { seed, settings });
  const reader = createSoundReader(ground);
  const events = reader.read(session.world);
  while (!playback.done) {
    playback.step(session);
    events.push(...reader.read(session.world));
  }
  type Feet = { actor: { player?: boolean; x: number; y: number; z: number } };
  const feet = (session.world.query('actor') as unknown as Feet[]).find((e) => e.actor.player)?.actor;
  const player: Timeline['player'] = feet ? [feet.x, feet.y, feet.z] : null;
  return { events, hash: timelineHash(events), worldHash: session.world.hash(), missed: reader.missed, player };
}
