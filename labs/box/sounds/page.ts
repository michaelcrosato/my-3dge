/**
 * @file The box's sound in its page (PLAN.md §9.0, WP 9.5, I-23): `createBoxSound()` makes the page's audio runtime
 * (engine/audio/runtime/audio.ts: locked, silent, until the first key, click or end of a touch) and returns `frame`,
 * which the page runs once per rendered frame after the draw (labs/box/main.ts hands it to `createEngine`'s
 * `onFrame`). Each frame it:
 * - puts the listener at the camera, and gives the runtime the sim's read-only `QueryView`, so walls muffle sounds;
 * - plays the sim's new events as their sounds (labs/box/sounds/events.ts), each placed where it happened;
 * - sets the room's reverb from the scene's level (`BOX_ROOMS`: the hall's, the room's);
 * - keeps the torch ambience going: `sfx:boxTorch` looped on the `TORCH.voices` torches nearest the listener (the
 *   level's light spots tagged `torch`), a voice staying on its torch until another is `TORCH.keep` m nearer;
 * - plays the demo song `song:boxHall` (asked for at once, heard from the first gesture), at intensity 1 while
 *   blows land (`hit`, `shot`, `slam`, `slain`) and back to 0 once `MUSIC.calm` seconds pass without one.
 *
 * `info()` reports it as plain data: the runtime's own `info()`, what the events asked for and what played. In a page
 * it is published as `window.__boxSound`, which tests/e2e/box-audio.spec.ts reads; nothing else reads it.
 *
 * Invariants: presentation only: it reads the frame and never changes the sim, so the box's hashes are the same with
 * sound or without. Every event is asked for once, played or not (still locked, or dropped by the voice limits).
 *
 * Game code: it imports only the engine's public API (engine/index.ts) and the box's own files.
 *
 * @example
 * // labs/box/main.ts
 * // const sound = createBoxSound();
 * // await createEngine({ canvas, scenes, levels, onFrame: sound.frame });
 * // window.__boxSound.info().audio.state; // 'locked' until a key, then 'running'
 * @see labs/box/sounds/page.test.ts
 */
import {
  createAudio,
  getLevel,
  type Audio,
  type AudioInfo,
  type CompiledLevel,
  type ListenerPose,
  type QueryView,
  type RoomName,
  type Sound,
} from '../../../engine';
import './boxHall';
import './effects';
import { createSoundReader, type Point, type SoundWorld } from './events';

/** What `frame` reads each rendered frame (the engine's `onFrame` gives it): never a way to change play. */
export interface SoundFrame {
  /** The run's world: its step, its events and its entities. */
  readonly world: SoundWorld;
  /** The running scene: the level it loads. */
  readonly scene: { readonly level?: string };
  /** The camera, where the listener goes. */
  readonly camera: ListenerPose;
  /** The sim's physics queries, read-only, in a physics scene; null without one. */
  readonly queries: QueryView | null;
  /** Seconds since the last frame. */
  readonly dt: number;
}

/** What `info()` reports: plain data. */
export interface BoxSoundInfo {
  audio: AudioInfo;
  /** The room the reverb is set to. */
  room: RoomName;
  /** The music's intensity now: 0 calm, 1 while blows land. */
  intensity: number;
  /** The light spots whose torch sounds now, by their index in the level's `lights`. */
  torches: number[];
  /** Effect → how many times the run's events asked for it, played or not. */
  asked: Record<string, number>;
  /** How many of them played. */
  played: number;
  /** The run's sound events in order, as `type sfx` (the latest `LOG_SIZE`): what the spec compares with a replay's. */
  log: string[];
  /** Events that left the sim's trace before a frame read them. */
  missed: number;
}

/** The box's sound in a page (see the file comment). */
export interface BoxSound {
  readonly audio: Audio;
  /** Once per rendered frame, after the draw. */
  frame(frame: SoundFrame): void;
  info(): BoxSoundInfo;
}

/** The reverb by level id; any other level, or none, is dry. */
export const BOX_ROOMS: Readonly<Record<string, RoomName>> = Object.freeze({
  'level:hall': 'hall',
  'level:room': 'room',
});

/** The torch ambience: voices at once, the margin before a nearer torch takes a voice (m), and its gain. */
export const TORCH = Object.freeze({ sfx: 'sfx:boxTorch', voices: 2, keep: 2, vol: 0.9 });

/** The song, and the seconds without a blow before it calms. */
export const MUSIC = Object.freeze({ song: 'song:boxHall', calm: 4 });

/** The events that make the music a fight's. */
const ACTION = new Set(['hit', 'shot', 'slam', 'slain']);

/** How many sound events `info().log` keeps. */
export const LOG_SIZE = 4096;

/**
 * The torches that sound: those of `playing` within `keep` m of the `voices`-th nearest, then the nearest others,
 * up to `voices`; nearest first, ties by index.
 */
export function nearestTorches(
  spots: readonly Point[],
  at: Point,
  playing: Iterable<number>,
  voices: number = TORCH.voices,
) {
  const far = spots.map((p) => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]));
  const order = spots.map((_, i) => i).sort((a, b) => far[a] - far[b] || a - b);
  if (!order.length || voices < 1) return [];
  const reach = far[order[Math.min(voices, order.length) - 1]] + TORCH.keep;
  const held = new Set(playing);
  const kept = order.filter((i) => held.has(i) && far[i] <= reach).slice(0, voices);
  return [...kept, ...order.filter((i) => !kept.includes(i)).slice(0, voices - kept.length)].sort(
    (a, b) => far[a] - far[b] || a - b,
  );
}

/** Makes the box's sound: `audio` to play into (a page's `createAudio()` by default), published unless `publish` is false. */
export function createBoxSound(options: { audio?: Audio; publish?: boolean } = {}): BoxSound {
  const audio = options.audio ?? createAudio();
  const reader = createSoundReader();
  const levels = new Map<string, CompiledLevel>();
  const torches = new Map<number, Sound>();
  let torchLevel: CompiledLevel | null = null;
  const asked: Record<string, number> = {};
  let [played, intensity, calm, room]: [number, number, number, RoomName] = [0, 0, Infinity, 'none'];
  let [log, world]: [string[], SoundWorld | null] = [[], null];
  audio.music(MUSIC.song, { intensity });

  const levelOf = (id: string | undefined) => {
    if (id === undefined) return null;
    if (!levels.has(id)) levels.set(id, getLevel(id));
    return levels.get(id)!;
  };
  const torchesOf = (level: CompiledLevel | null, at: Point) => {
    const lights = level?.lights ?? [];
    const lit = lights.flatMap((light, i) => (light.tag === 'torch' ? [i] : []));
    const playing = [...torches.keys()].map((i) => lit.indexOf(i));
    const wanted = nearestTorches(
      lit.map((i) => lights[i].position),
      at,
      playing,
    ).map((k) => lit[k]);
    for (const [i, voice] of torches) {
      if (level === torchLevel && wanted.includes(i) && voice.playing) continue;
      voice.stop();
      torches.delete(i);
    }
    torchLevel = level;
    for (const i of wanted.filter((k) => !torches.has(k))) {
      const voice = audio.play(TORCH.sfx, { position: lights[i].position, loop: true, vol: TORCH.vol });
      if (voice) torches.set(i, voice);
    }
  };

  const sound: BoxSound = {
    audio,
    frame(frame) {
      if (frame.world !== world) [world, log] = [frame.world, []];
      audio.update(frame.camera, frame.queries ?? undefined);
      const level = levelOf(frame.scene.level);
      const next = BOX_ROOMS[frame.scene.level ?? ''] ?? 'none';
      if (next !== room) audio.room((room = next));
      calm += frame.dt;
      for (const event of reader.read(frame.world, level)) {
        asked[event.sfx] = (asked[event.sfx] ?? 0) + 1;
        if (log.push(`${event.type} ${event.sfx}`) > LOG_SIZE) log.shift();
        if (ACTION.has(event.type)) calm = 0;
        const { vol, position, duck } = event;
        if (audio.play(event.sfx, position ? { vol, position, duck } : { vol, duck })) played++;
      }
      torchesOf(level, frame.camera.position);
      const want = calm < MUSIC.calm ? 1 : 0;
      if (want !== intensity) audio.intensity((intensity = want));
    },
    info: () => ({
      audio: audio.info(),
      room,
      intensity,
      torches: [...torches.keys()],
      asked: { ...asked },
      played,
      log: [...log],
      missed: reader.missed,
    }),
  };
  if (options.publish !== false && typeof window !== 'undefined') Object.assign(window, { __boxSound: sound });
  return sound;
}
