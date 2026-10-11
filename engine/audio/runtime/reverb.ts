/**
 * @file Rooms and their reverb (PLAN.md WP 9.3, I-23; doctrine: Assets): each room preset is a few numbers, and its
 * stereo impulse response is made from them as code, for Web Audio's `ConvolverNode`: no recorded impulse files.
 *
 * A room's `decay` is its RT60, the seconds its tail takes to fall 60 dB; `predelay` the silence before the tail;
 * `damping` the cutoff of the one-pole lowpass the tail goes through (soft or large rooms sound darker); `wet` the
 * level the mixer sends into it (engine/audio/runtime/mixer.ts). `ROOMS` holds the presets; a game passes its own
 * numbers where a name goes.
 *
 * Invariants: `impulseResponse` is a pure function of the room, the rate and the seed: seeded white noise per channel
 * (the stream `derive(seed, 'reverb', channel)`, so left and right are uncorrelated and the image is wide), lowpassed,
 * shaped by `exp(−6.9078 t / decay)` (−60 dB at `decay`), silent for `predelay`, and scaled so each channel's energy
 * (its sum of squares) is 1: a convolver with `normalize = false` then passes white noise at its own level whatever
 * the room, so `wet` alone sets how loud the reverb is. The response lasts `predelay + decay`. A room whose `decay` or
 * `wet` is 0 has no response (null): the mixer sends nothing.
 *
 * @example
 * const [left, right] = impulseResponse('hall', 48000) ?? [];
 * left.length; // 106,800: 0.025 s of predelay and 2.2 s of tail at 48 kHz
 * impulseResponse('none', 48000); // null
 * @see engine/audio/runtime/reverb.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../../core/log';
import { derive, Rng } from '../../core/rng';

/** The codes the rooms raise, with their fixes. */
export const REVERB_CODES = defineCodes('audio', {
  AUDIO_BAD_ROOM: {
    template: 'room {room} is not a preset{hint}',
    fix: 'name one of the ROOMS presets ({names}), or pass { decay, predelay, damping, wet }',
    doc: 'Raised by `impulseResponse` and `audio.room` (engine/audio/runtime/reverb.ts) for a room name that is not in `ROOMS`, or numbers out of range.',
  },
});

/** A room's reverb, as numbers. */
export interface RoomSpec {
  /** Seconds for the tail to fall 60 dB (RT60), 0 to 10; 0 is no reverb. */
  readonly decay: number;
  /** Seconds of silence before the tail, 0 to 0.5. */
  readonly predelay: number;
  /** The tail's lowpass cutoff, Hz, 200 to 20,000: lower is darker. */
  readonly damping: number;
  /** The level sent into the reverb, 0 to 1. */
  readonly wet: number;
}

/** The room presets, from no reverb to a cave. */
export const ROOMS = Object.freeze({
  none: { decay: 0, predelay: 0, damping: 20000, wet: 0 },
  small: { decay: 0.35, predelay: 0.004, damping: 7000, wet: 0.18 },
  room: { decay: 0.7, predelay: 0.01, damping: 5500, wet: 0.22 },
  hall: { decay: 2.2, predelay: 0.025, damping: 3500, wet: 0.3 },
  cave: { decay: 3.5, predelay: 0.04, damping: 1800, wet: 0.35 },
  outdoor: { decay: 0.3, predelay: 0.06, damping: 2500, wet: 0.08 },
} satisfies Record<string, RoomSpec>);

/** A preset's name. */
export type RoomName = keyof typeof ROOMS;

/** −ln(10⁻³): the decay exponent that falls 60 dB over one RT60. */
const SIXTY_DB = 6.907755278982137;

/** The numbers of `room`, a preset's name or a spec; throws `AUDIO_BAD_ROOM` for an unknown name or a bad value. */
export function roomSpec(room: RoomName | RoomSpec): RoomSpec {
  const names = Object.keys(ROOMS);
  if (typeof room === 'string') {
    if (!Object.hasOwn(ROOMS, room)) {
      throw codeError('AUDIO_BAD_ROOM', { room, hint: didYouMean(room, names), names: names.join(', ') });
    }
    return ROOMS[room];
  }
  const ranges: [keyof RoomSpec, number, number][] = [
    ['decay', 0, 10],
    ['predelay', 0, 0.5],
    ['damping', 200, 20000],
    ['wet', 0, 1],
  ];
  for (const [field, min, max] of ranges) {
    const value = room[field];
    if (!(typeof value === 'number' && value >= min && value <= max)) {
      const hint = ` (${field} ${String(value)} is not from ${min} to ${max})`;
      throw codeError('AUDIO_BAD_ROOM', { room: JSON.stringify(room), hint, names: names.join(', ') });
    }
  }
  return room;
}

/** The room's stereo impulse response at `rate` samples per second, or null when it has no reverb. */
export function impulseResponse(
  room: RoomName | RoomSpec,
  rate: number,
  seed = 0,
): [Float32Array, Float32Array] | null {
  const { decay, predelay, damping, wet } = roomSpec(room);
  if (decay === 0 || wet === 0) return null;
  const pre = Math.round(predelay * rate);
  const length = pre + Math.round(decay * rate);
  const pole = Math.exp((-2 * Math.PI * Math.min(damping, rate / 2)) / rate);
  const channel = (index: number) => {
    const rng = new Rng(derive(seed, 'reverb', index));
    const out = new Float32Array(length);
    let low = 0;
    let energy = 0;
    for (let i = pre; i < length; i++) {
      low = (1 - pole) * (rng.next() * 2 - 1) + pole * low;
      const value = low * Math.exp((-SIXTY_DB * (i - pre)) / rate / decay);
      out[i] = value;
      energy += value * value;
    }
    const scale = 1 / Math.sqrt(energy);
    for (let i = pre; i < length; i++) out[i] *= scale;
    return out;
  };
  return [channel(0), channel(1)];
}
