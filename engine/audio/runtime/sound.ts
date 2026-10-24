/**
 * @file One sound playing (PLAN.md WP 9.3): a rendered effect's `AudioBuffer` through its own gain, then, when it
 * has a position, a lowpass for occlusion and a `PannerNode` (engine/audio/runtime/spatial.ts), into a mixer bus.
 * `createVoice` wires it and starts it; the runtime (engine/audio/runtime/audio.ts) hands out the `Sound` side.
 *
 * Invariants: a voice's gain is its `vol` (`volume` changes it), times the gain of the walls muffling it
 * (engine/audio/runtime/spatial.ts `muffling`); `stop` fades it to 0 over
 * `STOP_FADE` seconds, then stops the source (once: stopping again does nothing); it reports `playing: false` from
 * then on. When the source ends, the voice disconnects every node it made and calls `onEnded`. Options are checked
 * before anything is made: a value out of range throws `AUDIO_BAD_OPTION`.
 *
 * @example
 * // browser: Web Audio's nodes exist only in a page (tests/e2e/examples.spec.ts; tests/e2e/audio.spec.ts plays them)
 * import { createMixer } from './mixer';
 * const context = new OfflineAudioContext(2, 44100, 44100);
 * const input = createMixer(context).input('effects');
 * const buffer = new AudioBuffer({ length: 4410, sampleRate: 44100 });
 * const options = { position: [2, 1, 0] as const };
 * const voice = createVoice(context, { id: 'sfx:hit', bus: 'effects', buffer, input, when: 0, options });
 * voice.move([3, 1, 0]);
 * voice.stop();
 * @see tests/e2e/audio.spec.ts
 */
import { codeError, defineCodes } from '../../core/log';
import type { AudioBus } from './mixer';
import { muffling, OCCLUSION, PANNER, placePanner, type Vec3 } from './spatial';

/** The codes of a sound's options, with their fixes. */
export const SOUND_CODES = defineCodes('audio', {
  AUDIO_BAD_OPTION: {
    template: '{option} is {value}, not {expected}',
    fix: 'pass {expected} as {option}',
    doc: 'Raised by `audio.play` and `Sound.move` (engine/audio/runtime/sound.ts) for a volume, pitch, variant or position out of range.',
  },
});

/** Seconds a sound fades out over when it is stopped or makes room for another. */
export const STOP_FADE = 0.02;

/** How `play` plays one effect. */
export interface PlayOptions {
  /** Gain, 0 to 4; 1 by default. */
  vol?: number;
  /** Playback rate (pitch and speed together), 0.1 to 10; 1 by default. */
  pitch?: number;
  /** The variant; in turn by default. */
  variant?: number;
  /** The bus; the entry's by default. */
  bus?: AudioBus;
  /** Where it sounds, world space, m: placed and occluded; unplaced (in the head) by default. */
  position?: Vec3;
  /** The context time it starts at; now by default. */
  when?: number;
  /** Loops until stopped (ambience). */
  loop?: boolean;
  /** Ducks the music and ambience while it plays. */
  duck?: boolean;
}

/** A sound playing. */
export interface Sound {
  readonly id: string;
  readonly bus: AudioBus;
  /** The context time it starts at. */
  readonly start: number;
  /** Whether it loops until stopped. */
  readonly loop: boolean;
  /** Where it sounds, or null when it is not placed. */
  readonly position: Vec3 | null;
  /** True until it ends or is stopped. */
  readonly playing: boolean;
  /** Whether a wall stands between it and the listener, and how many (up to `OCCLUSION.walls`). */
  readonly occluded: boolean;
  readonly walls: number;
  /** Moves a placed sound. */
  move(position: Vec3): void;
  /** Fades it out over `fade` seconds (`STOP_FADE`) and stops it. */
  stop(fade?: number): void;
  /** Sets its gain, 0 to 4, easing over `ease` seconds (`OCCLUSION.ease`): a bed's level, the wind's. */
  volume(vol: number, ease?: number): void;
}

/** A sound as the runtime holds it: it can be occluded. */
export interface RuntimeSound extends Sound {
  /** Muffles it behind `walls` walls (0 opens it), easing with `OCCLUSION.ease` or at once. */
  occlude(walls: number, ease: boolean): void;
}

/** Throws `AUDIO_BAD_OPTION` unless `value` is undefined or a number (whole when `whole`) in [min, max]. */
function checkRange(option: string, value: unknown, min: number, max: number, whole = false): void {
  const fine = typeof value === 'number' && value >= min && value <= max && (!whole || Number.isInteger(value));
  if (value === undefined || fine) return;
  const expected = `${whole ? 'a whole number' : 'a number'} from ${min} to ${max}`;
  throw codeError('AUDIO_BAD_OPTION', { option, value: String(value), expected });
}

/** Throws `AUDIO_BAD_OPTION` unless `position` is three finite numbers. */
function checkPosition(position: unknown): asserts position is Vec3 {
  if (Array.isArray(position) && position.length === 3 && position.every(Number.isFinite)) return;
  const value = JSON.stringify(position);
  throw codeError('AUDIO_BAD_OPTION', { option: 'position', value, expected: '[x, y, z] in metres' });
}

/** Checks `options` for an effect with `variants` variants; throws `AUDIO_BAD_OPTION` naming the first bad one. */
export function checkPlay(options: PlayOptions, variants: number): void {
  checkRange('vol', options.vol, 0, 4);
  checkRange('pitch', options.pitch, 0.1, 10);
  checkRange('variant', options.variant, 0, variants - 1, true);
  if (options.position !== undefined) checkPosition(options.position);
}

/** What `createVoice` wires. */
export interface VoiceSpec {
  id: string;
  bus: AudioBus;
  buffer: AudioBuffer;
  /** Where it connects: the bus's input. */
  input: AudioNode;
  /** The context time it starts at. */
  when: number;
  options: PlayOptions;
  /** Called once when it ends. */
  onEnded?: () => void;
}

/** Wires and starts one voice (see the file comment). */
export function createVoice(c: BaseAudioContext, spec: VoiceSpec): RuntimeSound {
  const { id, bus, buffer, input, when, options } = spec;
  let vol = options.vol ?? 1;
  const loop = options.loop ?? false;
  const source = new AudioBufferSourceNode(c, { buffer, loop, playbackRate: options.pitch ?? 1 });
  const gain = new GainNode(c, { gain: vol });
  const open = Math.min(OCCLUSION.open, c.sampleRate / 2);
  let where = options.position ?? null;
  const filter = where ? new BiquadFilterNode(c, { type: 'lowpass', frequency: open, Q: OCCLUSION.q }) : null;
  const panner = where ? new PannerNode(c, PANNER) : null;
  if (panner && where) placePanner(panner, where, when);
  const chain: AudioNode[] = filter && panner ? [source, gain, filter, panner] : [source, gain];
  chain.forEach((node, i) => node.connect(chain[i + 1] ?? input));
  let playing = true;
  let stopping = false;
  const voice: RuntimeSound = {
    id,
    bus,
    start: when,
    loop,
    occluded: false,
    walls: 0,
    get playing() {
      return playing;
    },
    get position() {
      return where;
    },
    move(to) {
      checkPosition(to);
      if (!panner || !playing) return;
      where = to;
      placePanner(panner, to, c.currentTime);
    },
    stop(fade = STOP_FADE) {
      if (stopping) return;
      stopping = true;
      playing = false;
      const now = c.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + fade);
      source.stop(Math.max(now + fade, when));
    },
    occlude(walls, ease) {
      if (!filter || stopping) return;
      Object.assign(voice, { walls, occluded: walls > 0 });
      const { cutoff, gain: through } = muffling(walls, open);
      if (!ease) {
        filter.frequency.value = cutoff;
        gain.gain.value = vol * through;
        return;
      }
      filter.frequency.setTargetAtTime(cutoff, c.currentTime, OCCLUSION.ease);
      gain.gain.setTargetAtTime(vol * through, c.currentTime, OCCLUSION.ease);
    },
    volume(to, ease = OCCLUSION.ease) {
      checkRange('vol', to, 0, 4);
      if (stopping) return;
      vol = to;
      gain.gain.setTargetAtTime(vol * muffling(voice.walls, open).gain, c.currentTime, Math.max(ease, 1e-3));
    },
  };
  source.addEventListener('ended', () => {
    playing = false;
    for (const node of chain) node.disconnect();
    spec.onEnded?.();
  });
  source.start(when);
  return voice;
}
