/**
 * @file The audio runtime (PLAN.md WP 9.3, §6.4, I-23; doctrines: Assets, Common ground): a page's sound. It plays
 * the effects and songs the DSP renders (engine/audio/data) through Web Audio: mixed on buses with ducking and voice
 * limits (mixer.ts, voices.ts), placed in 3D and muffled behind walls (spatial.ts), in a room's reverb (reverb.ts),
 * with music in layers that change on the beat (music.ts). `createAudio()` makes it; the frame loop calls
 * `update(cameraPose, queries)` once per rendered frame, after the render.
 *
 * The context: a page's runtime starts `locked`, with no `AudioContext`, and makes one inside the first user gesture
 * (gesture.ts: a key, a click, the end of a touch), so the browser lets it run and prints no warning; a later gesture
 * resumes it when the browser suspended it. Its `state` is then the context's (`running`, `suspended`, `closed`).
 * Without Web Audio it is `off` and says so once (`AUDIO_OFF`); the game plays on in silence. A test passes its own
 * context (`OfflineAudioContext`), which needs no gesture.
 *
 * Playing: `play(id, { vol, pitch, variant, bus, position, when, loop, duck })` plays an `sfx` entry on its bus (the
 * entry's `bus` by default), its variants in turn unless one is named, placed at `position` when given; it returns
 * the `Sound` (move it, stop it), or null when the voice limits drop it or there is no running context yet (sounds
 * asked for while locked are dropped, music is remembered). `duck` ducks the music and ambience for the sound's
 * length. `footstep(surface, position)` plays the effect `footsteps` maps the level's surface tag to (WP 4.2's
 * `surfaceAt`), `'*'` for any other, `sfx:step` without one. `event(type, payload)` plays a sim event: a sound event
 * (`{ sfx, vol?, variant?, position? }`, as `x audio --replay` reads them) plays its effect, and a type bound with
 * `bind(type, id)` plays its stinger on the beat.
 *
 * Invariants: presentation only: nothing here changes the sim, and the QueryView only answers occlusion rays. An
 * unknown id throws `CORE_NO_ENTRY` naming the closest, when it is asked for, locked or not. Renders are cached per
 * effect and variant at the context's rate (played looped, an effect with a `loop` pass is its render folded onto it:
 * buffers.ts `foldLoop`, so it has no seam); a voice disconnects its nodes when it ends.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3708-3786` (`ChipAudio`: the lazy context, resume on a gesture, the
 * buses and their levels, `sfx` with its per-sound rule, `music`), on pre-rendered buffers.
 *
 * @example
 * // browser: Web Audio plays only in a page (tests/e2e/examples.spec.ts runs it; tests/e2e/audio.spec.ts the rest)
 * const audio = createAudio({ footsteps: { iron: 'sfx:stomp', '*': 'sfx:step' } });
 * audio.music('song:dungeon', { intensity: 0 }); // starts on the first gesture
 * audio.bind('bossSeen', 'sfx:secret');
 * // each frame, after the render: audio.update(camera.pose, queryViewOf(world));
 * audio.event('hit', { sfx: 'sfx:hit', position: [2, 1, 5] });
 * @see tests/e2e/audio.spec.ts
 */
import { defineCodes, log as sharedLog, type Log } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { QueryView } from '../../sim/queryView';
import { getSfx, renderSfx, sfxKind, type Sfx } from '../data/sfx';
import { getSong, songKind } from '../data/song';
import { onGesture, type GestureTarget } from './gesture';
import { BUS_VOLUMES, createMixer, type AudioBus, type Mixer, type MixerInfo } from './mixer';
import { createMusic, type Music, type MusicChange, type MusicPosition } from './music';
import { roomSpec, type RoomName, type RoomSpec } from './reverb';
import { foldLoop, toBuffer } from './buffers';
import { checkPlay, createVoice, type PlayOptions, type Sound, type RuntimeSound } from './sound';
import { placeListener, wallsBetween, type ListenerPose, type Vec3 } from './spatial';
import { createVoicePool, type VoiceLimits } from './voices';

/** The runtime's codes, with their fixes. */
export const AUDIO_CODES = defineCodes('audio', {
  AUDIO_OFF: {
    template: 'sound is off: {reason}',
    fix: 'open the page in a browser with Web Audio (every current one has it); the game runs on in silence',
    doc: 'Advice from `createAudio` (engine/audio/runtime/audio.ts) when there is no Web Audio, or the context could not be made.',
  },
});

/** The runtime's state: `locked` until a gesture, then the context's; `off` without Web Audio. */
export type AudioState = 'locked' | 'off' | AudioContextState;

/** How `createAudio` is set up; in a page every field has its default. */
export interface AudioOptions {
  /** The context to play into (an `OfflineAudioContext` in a test); one is made on the first gesture by default. */
  context?: BaseAudioContext;
  /** Where gestures arrive (`window`). */
  window?: GestureTarget;
  /** Where the effects and songs come from (the shared registry). */
  registry?: Registry;
  /** The voice limits over the defaults (voices.ts). */
  limits?: Partial<VoiceLimits>;
  /** Surface tag → `sfx` id for footsteps; `'*'` for any other tag. */
  footsteps?: Readonly<Record<string, string>>;
  /** The seed the effects render from (0). */
  seed?: number;
  /** Where advice goes (the shared log). */
  log?: Log;
}

/** What `info()` reports: plain data. */
export interface AudioInfo {
  state: AudioState;
  /** The context's sample rate, once there is one. */
  rate: number | null;
  /** The ids of the voices playing, oldest first. */
  voices: string[];
  mixer: MixerInfo | null;
  music: MusicPosition | null;
  listener: ListenerPose | null;
  /** Event type → the stinger it plays. */
  bindings: Record<string, string>;
}

/** A page's sound (see the file comment). */
export interface Audio {
  readonly state: AudioState;
  /** The context, once there is one. */
  readonly context: BaseAudioContext | null;
  play(id: string, options?: PlayOptions): Sound | null;
  footstep(surface: string, position?: Vec3, options?: PlayOptions): Sound | null;
  event(type: string, payload?: unknown): Sound | null;
  bind(type: string, id: string | null): void;
  /** Plays a song (null stops), on the next bar line of the one playing (music.ts). */
  music(id: string | null, options?: MusicChange & { intensity?: number }): void;
  /** Sets the music's intensity, 0 to 1, on the next beat (music.ts). */
  intensity(value: number, options?: MusicChange): void;
  /** Plays an effect or a song once on the music bus, on the next beat (music.ts). */
  stinger(id: string, options?: MusicChange & { vol?: number }): void;
  /** Once per rendered frame: the listener follows `pose`, and placed sounds are occluded through `queries`. */
  update(pose?: ListenerPose, queries?: QueryView): void;
  volume(bus: AudioBus | 'master', value?: number): number;
  mute(on?: boolean): boolean;
  /** `true` holds a duck of the music and ambience, `false` lets it go, a number ducks for that many seconds. */
  duck(on: boolean | number): void;
  room(room: RoomName | RoomSpec): void;
  info(): AudioInfo;
  /** Stops listening and closes the context it made. */
  close(): Promise<void>;
}

/** Makes a page's sound (see the file comment). */
export function createAudio(options: AudioOptions = {}): Audio {
  const registry = options.registry ?? sharedRegistry;
  const out = options.log ?? sharedLog;
  sfxKind(registry);
  songKind(registry);
  /** `id` once it names a song or an effect; else throws `CORE_NO_ENTRY` naming the closest effects. */
  const checkSound = (id: string) => (registry.has('song', id) ? id : getSfx(id, registry).id);
  const footsteps = options.footsteps ?? {};
  const pool = createVoicePool<RuntimeSound>(options.limits);
  const buffers = new Map<string, AudioBuffer>();
  const turns = new Map<string, number>();
  const bindings = new Map<string, string>();
  const volumes = { ...BUS_VOLUMES };
  let muted = false;
  let room: RoomName | RoomSpec = 'none';
  let pose: ListenerPose | null = null;
  let queries: QueryView | undefined;
  let pending: { id: string | null; options: MusicChange & { intensity?: number } } | null = null;
  let level: number | undefined;
  let context: BaseAudioContext | null = null;
  let mixer: Mixer | null = null;
  let player: Music | null = null;
  let state: 'open' | 'off' | 'closed' = 'open';
  let stopListening = () => {};

  const live = (c: BaseAudioContext): c is AudioContext =>
    typeof AudioContext !== 'undefined' && c instanceof AudioContext;
  const stateOf = (): AudioState => (state !== 'open' ? state : context ? context.state : 'locked');
  const begin = (made: BaseAudioContext) => {
    context = made;
    mixer = createMixer(made);
    for (const [bus, value] of Object.entries(volumes)) mixer.volume(bus as AudioBus | 'master', value);
    mixer.mute(muted);
    mixer.room(room);
    if (pose) placeListener(made.listener, pose, made.currentTime);
    player = createMusic(made, mixer.input('music'), {
      registry,
      sfx: (id, when, vol) => void play(id, { when, vol, bus: 'music' }),
    });
    if (pending) player.play(pending.id, { ...pending.options, at: 'now', intensity: level });
    else if (level !== undefined) player.intensity(level, { at: 'now', fade: 0 });
    pending = null;
  };
  const gesture = () => {
    if (state !== 'open') return;
    if (!context) {
      try {
        begin(new AudioContext({ latencyHint: 'interactive' }));
      } catch (error) {
        state = 'off';
        stopListening();
        out.warnOnce('AUDIO_OFF', { reason: (error as Error).message ?? String(error) });
        return;
      }
    }
    if (context && live(context) && context.state !== 'running') void context.resume().catch(() => {});
  };

  if (options.context) begin(options.context);
  if (!options.context || live(options.context)) {
    const target = options.window ?? (typeof window === 'undefined' ? undefined : window);
    if (!options.context && (typeof AudioContext === 'undefined' || !target)) {
      state = 'off';
      out.warnOnce('AUDIO_OFF', { reason: 'this runtime has no Web Audio (AudioContext) or no window for gestures' });
    } else if (target) stopListening = onGesture(target, gesture);
  }

  const bufferOf = (entry: Sfx, variant: number, c: BaseAudioContext, looped: boolean) => {
    const fold = looped && entry.loop > 0 ? Math.max(1, Math.round(entry.loop * c.sampleRate)) : 0;
    const key = `${entry.id}#${variant}${fold ? ' looped' : ''}`;
    let buffer = buffers.get(key);
    if (!buffer) {
      const samples = renderSfx(entry, { variant, seed: options.seed ?? 0, rate: c.sampleRate, registry });
      buffers.set(key, (buffer = toBuffer(c, fold ? foldLoop(samples, fold) : samples, c.sampleRate)));
    }
    return buffer;
  };

  function play(id: string, opts: PlayOptions = {}): RuntimeSound | null {
    const entry = getSfx(id, registry);
    checkPlay(opts, entry.variants);
    const c = context;
    if (!c || !mixer || state !== 'open') return null;
    const when = Math.max(opts.when ?? c.currentTime, c.currentTime);
    const steal = pool.admit(id, when);
    if (!steal) return null;
    for (const voice of steal) {
      voice.stop();
      pool.remove(voice);
    }
    const turn = turns.get(id) ?? 0;
    turns.set(id, turn + 1);
    const buffer = bufferOf(entry, opts.variant ?? turn % entry.variants, c, opts.loop === true);
    const bus = opts.bus ?? entry.bus;
    const input = mixer.input(bus);
    const voice: RuntimeSound = createVoice(c, {
      id,
      bus,
      buffer,
      input,
      when,
      options: opts,
      onEnded: () => pool.remove(voice),
    });
    if (voice.position && pose && queries) voice.occlude(wallsBetween(queries, pose.position, voice.position), false);
    pool.add(voice);
    if (opts.duck && !voice.loop) mixer.duck(buffer.duration / (opts.pitch ?? 1), when);
    return voice;
  }

  return {
    get state() {
      return stateOf();
    },
    get context() {
      return context;
    },
    play,
    footstep(surface, position, opts = {}) {
      const mapped = (tag: string) => (Object.hasOwn(footsteps, tag) ? footsteps[tag] : undefined);
      const id = mapped(surface) ?? mapped('*') ?? 'sfx:step';
      return play(id, position ? { ...opts, position } : opts);
    },
    event(type, payload) {
      const sting = bindings.get(type);
      if (sting) player?.stinger(sting);
      if (typeof payload !== 'object' || payload === null) return null;
      const { sfx, vol, variant, position } = payload as Record<string, unknown>;
      if (typeof sfx !== 'string') return null;
      return play(sfx, { vol, variant, position } as PlayOptions);
    },
    bind(type, id) {
      if (id === null) bindings.delete(type);
      else bindings.set(type, checkSound(id));
    },
    music(id, opts = {}) {
      if (id !== null) getSong(id, registry);
      if (opts.intensity !== undefined) level = opts.intensity;
      if (player) player.play(id, opts);
      else pending = { id, options: opts };
    },
    intensity(value, opts) {
      level = value;
      player?.intensity(value, opts);
    },
    stinger(id, opts) {
      checkSound(id); // also while locked, when the player is not there yet
      player?.stinger(id, opts);
    },
    update(next, view) {
      if (view) queries = view;
      if (next) pose = next;
      if (!context || !pose) return;
      if (next) placeListener(context.listener, pose, context.currentTime);
      if (!queries) return;
      for (const voice of pool.voices) {
        if (!voice.position) continue;
        const now = wallsBetween(queries, pose.position, voice.position);
        if (now !== voice.walls) voice.occlude(now, true);
      }
    },
    volume(bus, value) {
      if (value !== undefined) volumes[bus] = mixer ? mixer.volume(bus, value) : Math.min(1, Math.max(0, value));
      return volumes[bus];
    },
    mute(on = !muted) {
      muted = on;
      mixer?.mute(on);
      return muted;
    },
    duck(on) {
      mixer?.duck(on);
    },
    room(next) {
      roomSpec(next);
      room = next;
      mixer?.room(next);
    },
    info: () => ({
      state: stateOf(),
      rate: context ? context.sampleRate : null,
      voices: pool.voices.map((voice) => voice.id),
      mixer: mixer ? mixer.info() : null,
      music: player ? player.position() : null,
      listener: pose,
      bindings: Object.fromEntries(bindings),
    }),
    async close() {
      stopListening();
      if (state === 'closed') return;
      state = 'closed';
      player?.play(null, { at: 'now' });
      if (context && live(context) && !options.context) await context.close();
    },
  };
}
