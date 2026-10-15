/**
 * @file A replay's sound timeline (PLAN.md WP 9.5), shared by Node (labs/box/sounds/events.test.ts) and Chromium
 * (tests/pages/box-audio.ts): `soundTimeline(text)` plays a box replay's text step by step, as the page's real-time
 * playback does (engine/app/playback.ts), and reads its sim events as the box's sounds after the setup and after
 * every step (labs/box/sounds/events.ts), so each sound carries the step it happened at. `FIGHT_TIMELINE` is the
 * fight replay's golden: one set, which Node and the browser must both give.
 *
 * Invariants: the scene module must be imported first (the caller's: the box's scenes register themselves); the run
 * is the replay's own, so its last hash is the replay's golden there; the level is the scene's, compiled by the caller
 * (the page registers the box's levels from their files, Node has the scenes' own: `HALL_LEVEL`); nothing here reads a
 * clock.
 *
 * @example
 * // import '../../labs/box/scenes/fight';
 * // import { HALL_LEVEL } from '../../labs/box/scenes/hall';
 * // soundTimeline(readFileSync(FIGHT_TIMELINE.replay, 'utf8'), HALL_LEVEL).hash === FIGHT_TIMELINE.hash
 */
import { createPlayback } from '../../engine/app/playback';
import { createSession } from '../../engine/sim/session';
import type { CompiledLevel } from '../../engine/world/level/types';
import { createSoundReader, timelineHash, type BoxSoundEvent } from '../../labs/box/sounds/events';

/**
 * The fight replay (tests/replays/box-5-fight.replay.json) and its timeline's golden: how many sounds, their hash.
 * Re-recorded with the replay's goldens at gate G7's review: the fight's blows go through the walkers' reactions
 * (WP 7.8): the big ones knock walkers down for a while, so the run changes and gives 79 sounds where it gave 81.
 * Again after G9 (WP 5.7, ADR-0020 amendment 9): the hero shoves the crowd aside instead of steering round it, so
 * his path through the foes changes and the run gives 77 sounds; and once more for the hits' gain (at most 0.5, so
 * `x audio --replay` hears the fight's worst moment unclipped, labs/box/sounds/events.ts): the same 77 sounds.
 */
export const FIGHT_TIMELINE = { replay: 'tests/replays/box-5-fight.replay.json', sounds: 77, hash: '288bca340783f86f' };

/** A replay's sound timeline: its sounds, their hash, the world's hash at the end and the events missed (0). */
export interface Timeline {
  events: BoxSoundEvent[];
  hash: string;
  worldHash: string;
  missed: number;
}

/** Plays a replay's text and reads its sounds after every step, on its scene's `level` (see the file comment). */
export function soundTimeline(text: string, level: CompiledLevel | null): Timeline {
  const playback = createPlayback(JSON.parse(text));
  const { scene, seed, settings } = playback.replay;
  const session = createSession(scene, { seed, settings });
  const reader = createSoundReader();
  const events = reader.read(session.world, level);
  while (!playback.done) {
    playback.step(session);
    events.push(...reader.read(session.world, level));
  }
  return { events, hash: timelineHash(events), worldHash: session.world.hash(), missed: reader.missed };
}
