/**
 * @file Voice limits (PLAN.md WP 9.3, I-23): how many sounds play at once, so a burst of hits never piles up into
 * noise or clipping. The pool keeps the voices playing and decides, for each new one, whether it plays and which
 * playing voices make room for it; the runtime (engine/audio/runtime/audio.ts) stops those with a short fade.
 *
 * The rules, in order, for a new voice of sound `id` starting at `time` (context seconds):
 * 1. Less than `gap` after the last start of the same id (playing or not), it is dropped: two hits in one frame
 *    would only phase (the source's 35 ms rule).
 * 2. With `perSound` voices of the id playing, the oldest of them makes room.
 * 3. With `max` voices playing, the oldest one that does not loop makes room; when every voice loops, the new one
 *    is dropped (ambience is never cut by a burst).
 *
 * Invariants: pure bookkeeping, no Web Audio and no clock: the caller passes the times. `admit` changes nothing:
 * the caller stops what it returns, then `add`s the new voice; `remove` takes a voice out when it ends.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3770-3772` (`sfx`: the 35 ms rule per sound), with the limits added.
 *
 * @example
 * const pool = createVoicePool({ perSound: 2 });
 * pool.admit('sfx:hit', 0); // []: nothing to stop
 * pool.add({ id: 'sfx:hit', start: 0, loop: false });
 * pool.admit('sfx:hit', 0.01); // null: within 35 ms of the last
 * @see engine/audio/runtime/voices.test.ts
 */

/** How many voices may play. */
export interface VoiceLimits {
  /** Voices at once, all sounds; 32 by default. */
  readonly max: number;
  /** Voices of one sound at once; 4 by default. */
  readonly perSound: number;
  /** Seconds before the same sound may start again; 0.035 by default. */
  readonly gap: number;
}

/** The default limits. */
export const VOICE_LIMITS: VoiceLimits = Object.freeze({ max: 32, perSound: 4, gap: 0.035 });

/** What the pool knows of a voice. */
export interface PooledVoice {
  /** The sound's id. */
  readonly id: string;
  /** When it started, context seconds. */
  readonly start: number;
  /** Whether it loops (ambience). */
  readonly loop: boolean;
}

/** The voices playing, and the rules for a new one. */
export interface VoicePool<V extends PooledVoice> {
  /** The limits in force. */
  readonly limits: VoiceLimits;
  /** The voices playing, oldest first. */
  readonly voices: readonly V[];
  /** The voices to stop so a voice of `id` may start at `time` (oldest first), or null when it may not. */
  admit(id: string, time: number): V[] | null;
  /** Records a voice as playing. */
  add(voice: V): void;
  /** Takes a voice out (it ended or was stopped). */
  remove(voice: V): void;
}

/** Makes an empty pool with `limits` over the defaults. */
export function createVoicePool<V extends PooledVoice>(limits: Partial<VoiceLimits> = {}): VoicePool<V> {
  const rules: VoiceLimits = Object.freeze({ ...VOICE_LIMITS, ...limits });
  const voices: V[] = [];
  const last = new Map<string, number>();
  return {
    limits: rules,
    voices,
    admit(id, time) {
      const previous = last.get(id);
      if (previous !== undefined && Math.abs(time - previous) < rules.gap) return null;
      const stop: V[] = [];
      const same = voices.filter((voice) => voice.id === id);
      if (same.length >= rules.perSound) stop.push(...same.slice(0, same.length - rules.perSound + 1));
      if (voices.length - stop.length >= rules.max) {
        const victim = voices.find((voice) => !voice.loop && !stop.includes(voice));
        if (!victim) return null;
        stop.push(victim);
      }
      return stop;
    },
    add(voice) {
      voices.push(voice);
      last.set(voice.id, voice.start);
    },
    remove(voice) {
      const index = voices.indexOf(voice);
      if (index >= 0) voices.splice(index, 1);
    },
  };
}
