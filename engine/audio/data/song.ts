/**
 * @file The `song` kind (PLAN.md WP 9.2, I-23; doctrines: Assets, Agent-operable): a looping tune as data, written
 * in tracker notation, its tracks played on the DSP core's waves and its drums from a kit of `sfx` entries. The
 * engine's five songs (songs.ts) are its entries; a game adds its own with `defineSong`, and `x new song` scaffolds one.
 *
 * A song has a tempo (`bpm`), `steps` per beat and `beats` per bar, and tracks. A track's `notes` hold one token per
 * step: a note (`C4`, `F#3`, `Bb2`), `-` holding the note before it, `.` a rest, and `|` a bar line, which takes no
 * step. A `drums` track writes kit tokens instead (`k s h o c t`, engine/audio/data/drums.ts). Each track loops on its
 * own length; `intensity` is the music intensity from which a track joins (0: always), for the runtime's layers.
 *
 * Invariants:
 * - The checks (`songProblems`, run when a song is defined): every token is a note, a hold after a note, a rest or a
 *   kit token; a `|` falls on a bar line; each track fills whole bars or divides one; every track's length divides the
 *   song's (its longest track's), which is whole bars; a track's voice is one `render` accepts; ranges per field.
 * - A note plays from its step for its held steps times `gate`, on a held envelope with the track's attack, at the
 *   note's pitch times 2^octave. A drum token plays its kit entry's voices (engine/audio/data/sfx.ts), their gain
 *   times the track's `vol` / 0.18, so a track at the default 0.18 plays the kit as written. Holds never wrap round a
 *   track's end. `songVoices` lays out one pass of the song, track by track; `renderSong` renders it with the DSP,
 *   at least a pass long (passes played back to back keep time), so the same song, seed and rate give the same bits
 *   in Node and Chromium.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3792-3836` (`music`, `_note`: the notation, the hold, the gate, the drum
 * scaling), as data rendered offline; the scheduling belongs to the runtime (WP 9.3).
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const registry = createRegistry();
 * const riff = defineSong('song:riff', { beats: 2, tracks: [{ notes: 'C4 - E4 - G4 - E4 -', wave: 'pluck' }] }, registry);
 * songTiming(riff); // { stepSeconds: 0.125, barSteps: 8, steps: 8, seconds: 1 }: 120 bpm, 2 beats a bar
 * renderSong('song:title').length > 0; // true
 * @see engine/audio/data/song.test.ts
 */
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import type { Schema } from '../../core/schema';
import { TONAL_WAVES } from '../dsp/osc';
import { DEFAULT_RATE, render } from '../dsp/render';
import { MAX_SECONDS, normalizeSound, noteFreq, type Voice } from '../dsp/voice';
import { DRUM_KIT } from './drums';
import { sfxVoices } from './sfx';
import { SONGS } from './songs';

/** The waves a track plays: the tonal ones, the pluck, and `drums` (kit tokens). */
export const TRACK_WAVES = [...TONAL_WAVES, 'pluck', 'drums'] as const;

/** One of the track waves. */
export type TrackWave = (typeof TRACK_WAVES)[number];

/** One track of a song. */
export interface SongTrack {
  /** One token per step: a note, `-` (hold), `.` (rest) or a kit token; `|` marks a bar line. */
  notes: string;
  /** `square` by default; `drums` plays kit tokens. */
  wave?: TrackWave;
  /** The notes' gain; 0.18 by default (and a drum track's 0.18 plays the kit as written). */
  vol?: number;
  /** Octaves added to every note; 0 by default. */
  octave?: number;
  /** The share of its held steps a note sounds for; 0.9 by default. */
  gate?: number;
  /** Seconds from silence to full volume; 0.006 by default. */
  attack?: number;
  /** Vibrato: `[rate in Hz, depth as a fraction of the pitch]`. */
  vib?: readonly [number, number];
  /** The music intensity from which the track plays, from 0 (always) to 1; 0 by default. */
  intensity?: number;
}

/** What `defineSong` takes: the tracks, and every other field optional. */
export interface SongSpec {
  /** Beats per minute; 120 by default. */
  bpm?: number;
  /** Steps per beat; 4 (sixteenth notes) by default. */
  steps?: number;
  /** Beats per bar; 4 by default. */
  beats?: number;
  /** Loops when it ends; true by default. */
  loop?: boolean;
  /** The tracks, played together. */
  tracks: readonly SongTrack[];
  /** A drum track's tokens and the `sfx` ids they play; the engine's kit by default. */
  kit?: Readonly<Record<string, string>>;
}

/** A `song` entry: the spec with its defaults filled, frozen. */
export interface Song {
  readonly id: string;
  readonly kind: string;
  readonly bpm: number;
  readonly steps: number;
  readonly beats: number;
  readonly loop: boolean;
  readonly tracks: readonly (Readonly<Required<Omit<SongTrack, 'vib'>>> & {
    readonly vib?: readonly [number, number];
  })[];
  readonly kit: Readonly<Record<string, string>>;
}

/** A track's fields. */
const TRACK_FIELDS = {
  notes: { type: 'string', required: true, description: 'One token per step: a note, - (hold), . (rest), | bars.' },
  wave: { type: 'string', enum: TRACK_WAVES, default: 'square', description: 'The wave; drums plays kit tokens.' },
  vol: { type: 'number', default: 0.18, minimum: 0, maximum: 1, description: "The notes' gain." },
  octave: { type: 'integer', default: 0, minimum: -4, maximum: 4, description: 'Octaves added to every note.' },
  gate: {
    type: 'number',
    default: 0.9,
    minimum: 0.05,
    maximum: 1,
    description: 'The share of its steps a note sounds.',
  },
  attack: { type: 'number', default: 0.006, minimum: 0, maximum: 1, unit: 's', description: "The notes' attack." },
  vib: { type: 'array', items: { type: 'number' }, description: 'Vibrato: [rate in Hz, depth as a fraction].' },
  intensity: { type: 'number', default: 0, minimum: 0, maximum: 1, description: 'The intensity it joins from.' },
} as const satisfies Schema;

/** The kind's fields. */
export const SONG_FIELDS = {
  bpm: { type: 'number', default: 120, minimum: 20, maximum: 400, description: 'Beats per minute.' },
  steps: { type: 'integer', default: 4, minimum: 1, maximum: 16, description: 'Steps per beat (4: sixteenths).' },
  beats: { type: 'integer', default: 4, minimum: 1, maximum: 16, description: 'Beats per bar.' },
  loop: { type: 'boolean', default: true, description: 'Loops when it ends.' },
  tracks: {
    type: 'array',
    required: true,
    items: { type: 'object', properties: TRACK_FIELDS },
    description: 'The tracks, played together, each looping on its own length.',
  },
  kit: { type: 'object', default: DRUM_KIT, description: "A drum track's tokens and the sfx ids they play." },
} as const satisfies Schema;

/** A drum track's gain that plays the kit as written (the source's default track gain). */
const KIT_LEVEL = 0.18;

/** voice.ts's default gain, for a drum voice that leaves it out. */
const VOICE_VOL = 0.3;

/** The tokens that are not notes. */
const HOLD = '-';
const REST = '.';
const BAR = '|';

/** A track's steps: its tokens without bar lines. */
function tokensOf(notes: string): string[] {
  return notes.split(/\s+/).filter((token) => token && token !== BAR);
}

/** How long a step and a bar are, and how long one pass of the song is. */
export interface SongTiming {
  /** Seconds per step. */
  stepSeconds: number;
  /** Steps per bar. */
  barSteps: number;
  /** Steps in one pass: the longest track's. */
  steps: number;
  /** Seconds in one pass, without the last notes' tails. */
  seconds: number;
}

/** The song's step and bar lengths, and one pass's. */
export function songTiming(song: Pick<Song, 'bpm' | 'steps' | 'beats' | 'tracks'>): SongTiming {
  const stepSeconds = 60 / song.bpm / song.steps;
  const steps = Math.max(0, ...song.tracks.map((track) => tokensOf(track.notes).length));
  return { stepSeconds, barSteps: song.steps * song.beats, steps, seconds: steps * stepSeconds };
}

/** The problems of one track's tokens and bar lines. */
function tokenProblems(track: Song['tracks'][number], kit: Readonly<Record<string, string>>, bar: number): string[] {
  const problems: string[] = [];
  let step = 0;
  let previous = REST;
  for (const token of track.notes.split(/\s+/).filter(Boolean)) {
    if (token === BAR) {
      if (step % bar) problems.push(`a | falls after step ${step}, not on a bar line (a bar is ${bar} steps)`);
      continue;
    }
    if (token === HOLD && (track.wave === 'drums' || previous === REST)) {
      problems.push(`the - at step ${step} holds nothing: put it after a note, or write . for a rest`);
    } else if (track.wave === 'drums' && token !== REST && !Object.hasOwn(kit, token)) {
      problems.push(`"${token}" at step ${step} is not in the kit (${Object.keys(kit).join(' ')}) or . for a rest`);
    } else if (track.wave !== 'drums' && token !== REST && token !== HOLD) {
      try {
        noteFreq(token);
      } catch {
        problems.push(`"${token}" at step ${step} is not a note: write C4, F#3 or Bb2, - to hold, . for a rest`);
      }
    }
    if (token !== HOLD) previous = token;
    step++;
  }
  return problems;
}

/** A track's note voice, without its pitch, start and length. */
function noteVoice(track: Song['tracks'][number]): Voice {
  const voice: Voice = { wave: track.wave as Voice['wave'], vol: track.vol, hold: true, attack: track.attack };
  if (track.vib !== undefined) voice.vib = track.vib;
  return voice;
}

/**
 * The problems of a song beyond its fields' own ([] when fine): tokens, bar lines, track lengths against the bar
 * and the song, a voice `render` refuses, a kit token that is not one word, and a pass past the DSP's length limit.
 */
export function songProblems(song: Pick<Song, 'bpm' | 'steps' | 'beats' | 'tracks' | 'kit'>): string[] {
  const problems: string[] = [];
  const { barSteps: bar, steps: length, seconds } = songTiming(song);
  for (const token of Object.keys(song.kit)) {
    if (!/^[^\s.|-]\S*$/.test(token)) problems.push(`kit token "${token}" must be one word, not . - or |`);
  }
  if (!song.tracks.length) problems.push('it has no tracks');
  song.tracks.forEach((track, i) => {
    const where = `tracks[${i}]`;
    const steps = tokensOf(track.notes).length;
    if (!steps) problems.push(`${where} has no steps`);
    for (const problem of tokenProblems(track, song.kit, bar)) problems.push(`${where}: ${problem}`);
    if (steps && steps % bar && bar % steps) {
      problems.push(`${where} is ${steps} steps long: a track fills whole bars or divides one (a bar is ${bar} steps)`);
    } else if (steps && length % steps) {
      problems.push(`${where} is ${steps} steps long, which does not divide the song's ${length}`);
    }
    if (track.wave !== 'drums') {
      try {
        normalizeSound(noteVoice(track), DEFAULT_RATE);
      } catch (error) {
        problems.push(`${where}: ${(error as Error).message}`);
      }
    }
  });
  if (length && length % bar) problems.push(`the song is ${length} steps long, not whole bars of ${bar} steps`);
  if (seconds > MAX_SECONDS) problems.push(`one pass lasts ${seconds} s, past the ${MAX_SECONDS} s limit`);
  return problems;
}

/** Declares the `song` kind on `registry` with the engine's songs (once). */
export function songKind(registry: Registry): void {
  if (registry.kinds().includes('song')) return;
  registry.defineKind('song', {
    description: 'A looping tune in tracker notation: tempo, bars and tracks of notes or drum tokens.',
    fields: SONG_FIELDS,
    defineWith: "defineSong('<id>', { bpm: …, tracks: [{ wave: …, notes: 'C4 - E4 - …' }] })",
    check: (entry) => songProblems(entry as unknown as Song),
  });
  for (const [id, spec] of Object.entries(SONGS)) registry.def('song', id, { ...spec });
}
songKind(sharedRegistry);

/**
 * Defines a song on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each problem
 * (a token that is not a note, a track that does not fit the bar, a value out of range), `CORE_DUPLICATE_ID` when
 * defined twice.
 */
export function defineSong(id: string, spec: SongSpec, registry: Registry = sharedRegistry): Song {
  songKind(registry);
  return registry.def('song', id, { ...spec }) as unknown as Song;
}

/** The song `id` of `registry`; a missing id throws `CORE_NO_ENTRY`, naming the closest ids. */
export function getSong(id: string, registry: Registry = sharedRegistry): Song {
  songKind(registry);
  return registry.get('song', id) as unknown as Song;
}

/** How `songVoices` and `renderSong` play a song. */
export interface SongRenderOptions {
  /** The music intensity: tracks whose `intensity` is above it stay silent; 1 (every track) by default. */
  intensity?: number;
  /** A whole number for the drums' noise; 0 by default (renderSong only). */
  seed?: number;
  /** Samples per second; 44,100 by default (renderSong only). */
  rate?: number;
  /** The registry the song and its kit's effects come from; the shared one by default. */
  registry?: Registry;
}

/** One pass of the song as a voice list, track by track: what `renderSong` renders. */
export function songVoices(song: string | Song, options: SongRenderOptions = {}): Voice[] {
  const { intensity = 1, registry = sharedRegistry } = options;
  const entry = typeof song === 'string' ? getSong(song, registry) : song;
  const { stepSeconds, steps } = songTiming(entry);
  const kit = new Map<string, Voice[]>(); // each drum's voices, looked up once
  const voices: Voice[] = [];
  for (const track of entry.tracks) {
    if (track.intensity > intensity) continue;
    const tokens = tokensOf(track.notes);
    const scale = Math.pow(2, track.octave);
    const template = noteVoice(track);
    for (let step = 0; step < steps; step++) {
      const at = step * stepSeconds;
      const index = step % tokens.length;
      const token = tokens[index];
      if (token === REST || token === HOLD) continue;
      if (track.wave === 'drums') {
        if (!kit.has(token)) kit.set(token, sfxVoices(entry.kit[token], registry));
        for (const voice of kit.get(token) as Voice[]) {
          voices.push({ ...voice, at: (voice.at ?? 0) + at, vol: (voice.vol ?? VOICE_VOL) * (track.vol / KIT_LEVEL) });
        }
        continue;
      }
      let held = 1;
      while (index + held < tokens.length && tokens[index + held] === HOLD) held++;
      voices.push({ ...template, freq: noteFreq(token) * scale, dur: held * stepSeconds * track.gate, at });
    }
  }
  return voices;
}

/**
 * One pass of the song as mono samples (engine/audio/dsp/render.ts): at least the pass's length, so passes played
 * back to back every `songTiming(song).seconds` keep time, plus the last notes' tails; silence when no track plays at
 * the intensity asked for.
 */
export function renderSong(song: string | Song, options: SongRenderOptions = {}): Float32Array {
  const { seed = 0, rate = DEFAULT_RATE, registry = sharedRegistry } = options;
  const entry = typeof song === 'string' ? getSong(song, registry) : song;
  const voices = songVoices(entry, options);
  voices.push({ wave: 'sine', vol: 0, dur: songTiming(entry).seconds }); // silent, last: it changes no other voice
  return render(voices, seed, rate);
}
