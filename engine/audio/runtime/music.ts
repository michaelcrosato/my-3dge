/**
 * @file The music player (PLAN.md WP 9.3, I-23): a `song` (engine/audio/data/song.ts) plays as its intensity layers
 * (engine/audio/runtime/buffers.ts), looped in step on the `music` bus. Raising the intensity brings in the layers
 * that join at it, a new song (a section change) starts on a bar line, and a stinger lands on a beat.
 *
 * Timing is musical: `at` quantizes a change to the playing song's next `bar` line, next `beat`, or `now`. Beats and
 * bars are counted from the song's start, `nextLine(time, start, period)`; with no song playing, every change happens
 * at once. A change happens no earlier than `when` (a context time), or than `MUSIC_LEAD` seconds from now, so it is
 * never scheduled in the past.
 * - `play(id)`: the song starts at the next bar line of the one playing (`at: 'bar'` by default) and the old one
 *   fades out over `fade` seconds from there (`SECTION_FADE`). Asking for the song already playing changes nothing;
 *   `play(null)` stops the music. A song with `loop: false` plays once.
 * - `intensity(value)`: from the next beat by default, each layer whose intensity is at most `value` fades in over
 *   `fade` seconds (`LAYER_FADE`) and the others fade out. The level carries over to the next song.
 * - `stinger(id)`: an effect or a song played once on the `music` bus, on the next beat by default.
 *
 * Invariants: every layer of a song starts at the same sample, so they stay in step whichever are on; layers are
 * rendered once per song and context. Nothing here reads a clock but the context's `currentTime`.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3787-3818` (`music`, `stopMusic`, `_schedule`: one looping song on its
 * own bus, faded out on stop), now pre-rendered loops with layers, quantized changes and stingers.
 *
 * @example
 * const music = createMusic(context, mixer.input('music'), { sfx: (id, when) => audio.play(id, { when }) });
 * music.play('song:dungeon', { intensity: 0 });
 * music.intensity(1); // on the next beat, every layer
 * music.play('song:boss'); // on the next bar line
 * music.stinger('sfx:secret'); // on the next beat
 * @see tests/e2e/audio.spec.ts
 */
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { getSong, renderSong, songKind, songTiming, type Song } from '../data/song';
import { renderLayers, passSamples, toBuffer } from './buffers';

/** Where a change lands: the next bar line, the next beat, or at once. */
export type Quantize = 'now' | 'beat' | 'bar';

/** How far ahead of `currentTime` a change is scheduled at the earliest, s. */
export const MUSIC_LEAD = 0.03;
/** How long the old song fades out at a section change, s. */
export const SECTION_FADE = 0.03;
/** How long a layer takes to fade in or out, s. */
export const LAYER_FADE = 0.25;

/** The first line of a grid of `period` seconds from `start` at or after `time`. */
export function nextLine(time: number, start: number, period: number): number {
  if (time <= start) return start;
  return start + Math.ceil((time - start) / period - 1e-9) * period;
}

/** When and how a change happens. */
export interface MusicChange {
  /** The line it lands on; `bar` for a song, `beat` for the rest. */
  at?: Quantize;
  /** The earliest context time it may happen; now (plus `MUSIC_LEAD`) by default. */
  when?: number;
  /** Seconds of fade. */
  fade?: number;
}

/** Where the music is. */
export interface MusicPosition {
  /** The song's id. */
  song: string;
  /** The context time it started (or will start) at. */
  start: number;
  /** Seconds since it started; negative while it waits for its bar line. */
  seconds: number;
  /** The bar and the beat in it within the pass, from 0. */
  bar: number;
  beat: number;
  /** The intensity, and each layer's: whether it is on. */
  intensity: number;
  layers: { intensity: number; on: boolean }[];
}

/** The music of one context. */
export interface Music {
  /** Plays song `id` (or stops with null) and returns when it starts. */
  play(id: string | null, options?: MusicChange & { intensity?: number }): number | null;
  /** Sets the intensity, 0 to 1. */
  intensity(value: number, options?: MusicChange): void;
  /** Plays effect or song `id` once on the music bus, at `vol`; returns when it starts. */
  stinger(id: string, options?: MusicChange & { vol?: number }): number;
  /** Where the music is, or null when none plays. */
  position(): MusicPosition | null;
}

/** What the player needs beyond its context and output. */
export interface MusicOptions {
  /** Plays an effect on the music bus at `when` (the runtime's `play`, so voice limits hold). */
  sfx(id: string, when: number, vol: number): void;
  /** Where the songs come from; the shared registry by default. */
  registry?: Registry;
}

/** A song playing. */
interface Playing {
  readonly song: Song;
  readonly start: number;
  readonly beat: number;
  readonly bar: number;
  readonly out: GainNode;
  readonly layers: { intensity: number; source: AudioBufferSourceNode; gain: GainNode; on: boolean }[];
}

/** Makes the music player of `context`, playing into `output` (the mixer's `music` bus). */
export function createMusic(context: BaseAudioContext, output: AudioNode, options: MusicOptions): Music {
  const registry = options.registry ?? sharedRegistry;
  songKind(registry);
  const rate = context.sampleRate;
  const layerCache = new Map<string, { intensity: number; buffer: AudioBuffer }[]>();
  const onceCache = new Map<string, AudioBuffer>();
  let current: Playing | null = null;
  let level = 1;

  const from = (when?: number) =>
    when === undefined ? context.currentTime + MUSIC_LEAD : Math.max(when, context.currentTime);
  const line = (at: Quantize, time: number) => {
    if (!current || at === 'now') return time;
    return nextLine(time, current.start, at === 'bar' ? current.bar : current.beat);
  };
  const layersOf = (song: Song) => {
    let layers = layerCache.get(song.id);
    if (!layers) {
      layers = renderLayers(song, rate, { registry }).map(({ intensity, samples }) => ({
        intensity,
        buffer: toBuffer(context, samples, rate),
      }));
      layerCache.set(song.id, layers);
    }
    return layers;
  };
  const stop = (playing: Playing, time: number, fade: number) => {
    playing.out.gain.setValueAtTime(1, time);
    playing.out.gain.linearRampToValueAtTime(0, time + fade);
    for (const layer of playing.layers) layer.source.stop(time + fade + 0.01);
  };

  return {
    play(id, { at = 'bar', when, fade = SECTION_FADE, intensity = level } = {}) {
      if (id !== null && current?.song.id === id) return current.start;
      const time = line(at, from(when));
      if (current) stop(current, time, fade);
      level = intensity;
      current = null;
      if (id === null) return null;
      const song = getSong(id, registry);
      const pass = passSamples(song, rate);
      const { stepSeconds } = songTiming(song);
      const out = new GainNode(context);
      out.connect(output);
      const layers = layersOf(song).map(({ intensity: from, buffer }) => {
        const on = from <= level;
        const source = new AudioBufferSourceNode(context, { buffer, loop: song.loop });
        if (song.loop) [source.loopStart, source.loopEnd] = [pass / rate, (2 * pass) / rate];
        const gain = new GainNode(context, { gain: on ? 1 : 0 });
        source.connect(gain).connect(out);
        source.start(time);
        return { intensity: from, source, gain, on };
      });
      const playing: Playing = {
        song,
        start: time,
        beat: stepSeconds * song.steps,
        bar: stepSeconds * song.steps * song.beats,
        out,
        layers,
      };
      layers[0].source.addEventListener('ended', () => {
        if (current === playing) current = null;
      });
      current = playing;
      return time;
    },
    intensity(value, { at = 'beat', when, fade = LAYER_FADE } = {}) {
      level = Math.min(1, Math.max(0, value));
      if (!current) return;
      const time = line(at, from(when));
      for (const layer of current.layers) {
        const on = layer.intensity <= level;
        if (on === layer.on) continue;
        layer.on = on;
        layer.gain.gain.cancelScheduledValues(time);
        layer.gain.gain.setValueAtTime(on ? 0 : 1, time);
        layer.gain.gain.linearRampToValueAtTime(on ? 1 : 0, time + fade);
      }
    },
    stinger(id, { at = 'beat', when, vol = 1 } = {}) {
      const time = line(at, from(when));
      if (!registry.has('song', id)) {
        options.sfx(id, time, vol);
        return time;
      }
      let buffer = onceCache.get(id);
      if (!buffer) onceCache.set(id, (buffer = toBuffer(context, renderSong(id, { rate, registry }), rate)));
      const source = new AudioBufferSourceNode(context, { buffer });
      source.connect(new GainNode(context, { gain: vol })).connect(output);
      source.start(time);
      return time;
    },
    position() {
      if (!current) return null;
      const { song, start, layers } = current;
      const { stepSeconds, steps, barSteps } = songTiming(song);
      const seconds = context.currentTime - start;
      const step = Math.max(0, Math.floor(seconds / stepSeconds + 1e-9));
      const inPass = song.loop ? step % steps : step;
      return {
        song: song.id,
        start,
        seconds,
        bar: Math.floor(inPass / barSteps),
        beat: Math.floor((inPass % barSteps) / song.steps),
        intensity: level,
        layers: layers.map(({ intensity, on }) => ({ intensity, on })),
      };
    },
  };
}
