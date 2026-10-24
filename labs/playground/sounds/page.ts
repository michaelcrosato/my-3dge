/**
 * @file The playground's sound in its page (docs/PLAYGROUND.md §8.1, PLAN.md WP 13.22): `createPlaygroundSound()`
 * makes the page's audio runtime (engine/audio/runtime/audio.ts: locked, silent, until the first key, click or end of
 * a touch) and returns `frame`, which the page runs once per drawn frame (labs/playground/main.ts's `onFrame`). Each
 * frame it:
 * - puts the listener at the player's head, turned as the camera looks (so every camera hears what he hears: the
 *   isometric one, high over a cutaway, would hear the house through its walls), and gives the runtime the sim's
 *   read-only `QueryView`, so walls between him and a sound muffle it, up to three (engine/audio/runtime/spatial.ts);
 * - plays the sim's new events as their sounds (labs/playground/sounds/events.ts), each where it happened, on the
 *   scene's ground (`groundOf`: the site's, a level's, a terrain's);
 * - sets the reverb from the room he stands in (`roomAcoustics` of its make), the open air's (`outdoor`) out of
 *   doors, only when the room changes;
 * - crossfades the ambience, each bed looped on the ambience bus (`BEDS`): the block's breeze and birds out of doors,
 *   the house's hum in a room, over `BEDS.fade` s;
 * - raises the wind past his ears (`sfx:wind`, looped) with his speed (`WIND`: none below `from` m/s, full at
 *   `full`), and runs the zipline's hum (`sfx:zipRun`, looped where he is) while he rides one.
 *
 * `info()` reports it as plain data: the runtime's own `info()`, the room, the beds' and the wind's levels, what the
 * events asked for and what played, and the log of the sounds in order. In a page it is published as
 * `window.__playgroundSound`, which tests/e2e/playground-audio.spec.ts reads; nothing else reads it.
 *
 * Invariants: presentation only: it reads the frame and never changes the sim, so the playground's hashes are the
 * same with sound or without. Every event is asked for once, played or not (still locked, or dropped by the voice
 * limits); a loop the runtime could not start (locked) is asked for again on a later frame.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * // labs/playground/main.ts: const sound = createPlaygroundSound(); … onFrame: (frame) => sound.frame(frame)
 * // window.__playgroundSound.info().audio.state; // 'locked' until a key, then 'running'
 * @see labs/playground/sounds/page.test.ts
 */
import { createAudio, getLevel, getTerrain, roomAcoustics, type Audio, type AudioInfo, type ListenerPose, type QueryView, type Sound } from '../../../engine'; // prettier-ignore
import './effects';
import { createSoundReader, levelGround, terrainGround, type PlaygroundGround, type SoundReader, type SoundWorld } from './events'; // prettier-ignore
import { SITE_GROUND } from './ground';

/** What `frame` reads each drawn frame (the engine's `onFrame` gives it): never a way to change play. */
export interface SoundFrame {
  /** The run's world: its step, its events and its entities. */
  readonly world: SoundWorld & { query(name: string): unknown[] };
  /** The running scene: its id and what it stands on. */
  readonly scene: { readonly id: string; readonly site?: string; readonly level?: string; readonly terrain?: string };
  /** The camera, which way the listener turns. */
  readonly camera: ListenerPose;
  /** The sim's physics queries, read-only, in a physics scene; null without one. */
  readonly queries: QueryView | null;
  /** Seconds since the last frame. */
  readonly dt: number;
}

/** What `info()` reports: plain data. */
export interface PlaygroundSoundInfo {
  audio: AudioInfo;
  /** The room the reverb is set to: a room's name, or `outdoor`. */
  room: string;
  /** The beds' levels and the wind's, as last set; whether the zipline hums. */
  beds: { outdoors: number; indoors: number };
  wind: number;
  zip: boolean;
  /** Effect → how many times the run's events asked for it, played or not; how many of them played. */
  asked: Record<string, number>;
  played: number;
  /** The run's sounds in order, as `type sfx` (the latest `LOG_SIZE`): what the spec compares with a replay's. */
  log: string[];
  /** Events that left the sim's trace before a frame read them. */
  missed: number;
}

/** The playground's sound in a page (see the file comment). */
export interface PlaygroundSound {
  readonly audio: Audio;
  /** Once per drawn frame. */
  frame(frame: SoundFrame): void;
  info(): PlaygroundSoundInfo;
}

/** The ambience: each place's bed, its level and the seconds a crossfade takes. */
export const BEDS = Object.freeze({ outdoors: 'sfx:playgroundOutdoors', indoors: 'sfx:playgroundIndoors', vol: 0.8, fade: 1.5 }); // prettier-ignore

/** The wind past his ears: none below `from` m/s, full (`vol`) at `full`, in twentieths, eased over `ease` s. */
export const WIND = Object.freeze({ sfx: 'sfx:wind', from: 3, full: 12, vol: 0.9, ease: 0.3 });

/** The zipline's hum while he rides, its level. */
export const ZIP = Object.freeze({ sfx: 'sfx:zipRun', vol: 0.8 });

/** How high his ears are over his feet, m. */
export const EARS = 1.6;

/** How many sound events `info().log` keeps. */
export const LOG_SIZE = 4096;

/** The ground nothing stands on: no surface tag, no rooms. */
const NO_GROUND: PlaygroundGround = { surface: () => '', room: () => null };

/** A scene's ground: the site's for the block's scenes, else its terrain's or its level's. */
export function groundOf(scene: SoundFrame['scene']): PlaygroundGround {
  if (scene.site) return SITE_GROUND;
  if (scene.terrain) return terrainGround(getTerrain(scene.terrain));
  return scene.level ? levelGround(getLevel(scene.level)) : NO_GROUND;
}

/** The player as the sound reads him: where he is, how fast, and how he moves. */
type Player = { actor: { player?: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number }; motion?: { mode: string } }; // prettier-ignore

/** Makes the playground's sound: `audio` to play into (a page's `createAudio()` by default), published unless told not. */
export function createPlaygroundSound(options: { audio?: Audio; publish?: boolean } = {}): PlaygroundSound {
  const audio = options.audio ?? createAudio();
  const [loops, set] = [new Map<string, Sound>(), new Map<string, number>()];
  const levels = { outdoors: 0, indoors: 0, wind: 0 };
  const asked: Record<string, number> = {};
  let [scene, ground, reader]: [string, PlaygroundGround, SoundReader] = ['', NO_GROUND, createSoundReader(NO_GROUND)];
  let [world, log, played, room, zip]: [SoundWorld | null, string[], number, string, boolean] = [null, [], 0, '', false]; // prettier-ignore

  /**
   * Loop `sfx` at gain `vol`, eased over `ease` s when it changes (a ramp a change, not a frame), started if it is not
   * playing; a loop at 0 that is not, stays off.
   */
  const loop = (sfx: string, vol: number, ease: number, position?: readonly [number, number, number]) => {
    const playing = loops.get(sfx);
    if (playing?.playing && set.get(sfx) !== vol) playing.volume(vol, ease);
    if (playing?.playing || vol <= 0) return void set.set(sfx, vol);
    const started = audio.play(sfx, { loop: true, vol, ...(position ? { position: [...position] as [number, number, number] } : {}) }); // prettier-ignore
    if (!started) return;
    loops.set(sfx, started);
    set.set(sfx, vol);
  };

  const sound: PlaygroundSound = {
    audio,
    frame(frame) {
      if (frame.scene.id !== scene) [scene, ground] = [frame.scene.id, groundOf(frame.scene)];
      if (frame.world !== world) [world, log, reader] = [frame.world, [], createSoundReader(ground)];
      const player = (frame.world.query('actor') as Player[]).find((e) => e.actor.player);
      const a = player?.actor;
      const ears = a ? ([a.x, a.y + EARS, a.z] as const) : frame.camera.position;
      audio.update(
        { position: [...ears], yaw: frame.camera.yaw, pitch: frame.camera.pitch },
        frame.queries ?? undefined,
      );
      for (const event of reader.read(frame.world)) {
        asked[event.sfx] = (asked[event.sfx] ?? 0) + 1;
        if (log.push(`${event.type} ${event.sfx}`) > LOG_SIZE) log.shift();
        const { vol, pitch, position } = event;
        if (audio.play(event.sfx, position ? { vol, pitch, position: [...position] } : { vol, pitch })) played++;
      }
      const inside = a ? ground.room(a.x, a.y, a.z) : null;
      const next = inside?.name ?? 'outdoor';
      if (next !== room) audio.room(inside ? roomAcoustics(inside) : 'outdoor');
      room = next;
      [levels.outdoors, levels.indoors] = inside ? [0, BEDS.vol] : [BEDS.vol, 0];
      loop(BEDS.outdoors, levels.outdoors, BEDS.fade);
      loop(BEDS.indoors, levels.indoors, BEDS.fade);
      const speed = a ? Math.hypot(a.vx, a.vy, a.vz) : 0;
      levels.wind = Math.round(20 * WIND.vol * Math.min(1, Math.max(0, (speed - WIND.from) / (WIND.full - WIND.from)))) / 20; // prettier-ignore
      loop(WIND.sfx, levels.wind, WIND.ease);
      zip = player?.motion?.mode === 'zipline';
      if (zip && a) loop(ZIP.sfx, ZIP.vol, 0.1, [a.x, a.y + EARS, a.z]);
      if (zip && a) loops.get(ZIP.sfx)?.move([a.x, a.y + EARS, a.z]);
      if (!zip && loops.get(ZIP.sfx)?.playing) loops.get(ZIP.sfx)!.stop(0.3);
    },
    info: () => ({
      audio: audio.info(),
      room,
      beds: { outdoors: levels.outdoors, indoors: levels.indoors },
      wind: levels.wind,
      zip,
      asked: { ...asked },
      played,
      log: [...log],
      missed: reader.missed,
    }),
  };
  if (options.publish !== false && typeof window !== 'undefined') Object.assign(window, { __playgroundSound: sound });
  return sound;
}
