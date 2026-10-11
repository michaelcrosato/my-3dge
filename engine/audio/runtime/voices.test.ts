/**
 * @file Unit tests for the voice limits (engine/audio/runtime/voices.ts): the same sound within the gap is dropped;
 * past `perSound` the oldest of the sound makes room; past `max` the oldest voice that does not loop makes room, and
 * when every voice loops the new one is dropped; `admit` changes nothing until the caller adds and removes.
 */
import { describe, expect, it } from 'vitest';
import { createVoicePool, VOICE_LIMITS, type PooledVoice } from './voices';

/** Adds a voice of `id` at `start` once the pool admits it; returns what had to make room, or null. */
function play(pool: ReturnType<typeof createVoicePool<PooledVoice>>, id: string, start: number, loop = false) {
  const stop = pool.admit(id, start);
  if (!stop) return null;
  for (const voice of stop) pool.remove(voice);
  pool.add({ id, start, loop });
  return stop.map((voice) => `${voice.id}@${voice.start}`);
}

describe('createVoicePool', () => {
  it('has the defaults: 32 voices, 4 per sound, 35 ms between starts of one sound', () => {
    expect(VOICE_LIMITS).toEqual({ max: 32, perSound: 4, gap: 0.035 });
    expect(createVoicePool({ max: 8 }).limits).toEqual({ max: 8, perSound: 4, gap: 0.035 });
  });

  it('drops the same sound within the gap, ended or not, and lets other sounds through', () => {
    const pool = createVoicePool();
    expect(play(pool, 'sfx:hit', 1)).toEqual([]);
    expect(play(pool, 'sfx:hit', 1.02)).toBeNull();
    expect(play(pool, 'sfx:coin', 1.02)).toEqual([]);
    pool.remove(pool.voices[0]);
    expect(play(pool, 'sfx:hit', 1.03)).toBeNull();
    expect(play(pool, 'sfx:hit', 1.04)).toEqual([]);
  });

  it('makes room past perSound by stopping the oldest of that sound', () => {
    const pool = createVoicePool({ perSound: 3 });
    for (let i = 0; i < 3; i++) expect(play(pool, 'sfx:step', i)).toEqual([]);
    play(pool, 'sfx:jump', 3.5);
    expect(play(pool, 'sfx:step', 4)).toEqual(['sfx:step@0']);
    expect(play(pool, 'sfx:step', 5)).toEqual(['sfx:step@1']);
    expect(pool.voices.map((voice) => voice.id)).toEqual(['sfx:step', 'sfx:jump', 'sfx:step', 'sfx:step']);
  });

  it('makes room past max by stopping the oldest voice that does not loop, and never cuts loops', () => {
    const pool = createVoicePool({ max: 3 });
    play(pool, 'amb:torch', 0, true);
    play(pool, 'sfx:a', 1);
    play(pool, 'sfx:b', 2);
    expect(play(pool, 'sfx:c', 3)).toEqual(['sfx:a@1']);
    expect(play(pool, 'sfx:d', 4)).toEqual(['sfx:b@2']);
    const loops = createVoicePool({ max: 2 });
    play(loops, 'amb:a', 0, true);
    play(loops, 'amb:b', 0, true);
    expect(play(loops, 'sfx:hit', 1)).toBeNull();
    expect(loops.voices).toHaveLength(2);
  });

  it('changes nothing in admit', () => {
    const pool = createVoicePool({ max: 1 });
    play(pool, 'sfx:a', 0);
    expect(pool.admit('sfx:b', 1)).toHaveLength(1);
    expect(pool.voices.map((voice) => voice.id)).toEqual(['sfx:a']);
  });
});
