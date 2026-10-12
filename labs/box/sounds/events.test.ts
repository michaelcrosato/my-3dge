/**
 * @file Unit tests for the box's sound events (labs/box/sounds/events.ts) and effects (effects.ts): each event type
 * plays what the file comment says, where it says, footsteps by the surface underfoot; the reader reads each event
 * once and a new world from its first; and the fight replay's sound timeline, read in Node after every step, is the
 * recorded run's and gives its golden (`FIGHT_TIMELINE`), the one Chromium must give too (tests/e2e/box-audio.spec.ts).
 * @see labs/box/sounds/events.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getSfx, type TraceRecord } from '../../../engine';
import { FIGHT_TIMELINE, soundTimeline } from '../../../tests/pages/boxAudioTimeline';
import '../scenes/fight';
import { HALL_LEVEL } from '../scenes/hall';
import './effects';
import { BOX_FOOTSTEPS, createSoundReader, footstepSfx, soundOf, SOUND_EVENTS, timelineHash } from './events';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** A traced event. */
const record = (seq: number, type: string, payload: unknown): TraceRecord => ({
  seq,
  type,
  payload,
  listeners: 0,
  failed: 0,
});

/** A world at step `tick` with an actor 1 standing at `at`, whose trace is `records`. */
const world = (records: TraceRecord[], at = [2, 0, 3], tick = 7) => ({
  tick,
  events: { trace: () => records },
  get: (id: number) => (id === 1 ? { actor: { x: at[0], y: at[1], z: at[2] } } : undefined),
});

describe('the box’s sound events', () => {
  it('play what each sim event sounds like, where it happened', () => {
    const w = world([]);
    const at = [5, 1, 6] as const;
    const sound = (type: string, payload: unknown) => soundOf(record(1, type, payload), w, null);
    expect(sound('hit', { position: at, size: 1.3 })).toEqual({
      step: 7,
      type: 'hit',
      sfx: 'sfx:boxHit',
      vol: 1,
      position: at,
      duck: false,
    });
    expect(sound('hit', { position: at, size: 0.5 })?.vol).toBeCloseTo(0.575, 9); // a bolt on a wall, softer
    expect(sound('shot', { position: at, size: 1 })).toMatchObject({ sfx: 'sfx:boxLaunch', vol: 0.8, position: at });
    expect(sound('slam', { position: at, size: 0.6 })).toMatchObject({ sfx: 'sfx:boxThud', position: at });
    expect(sound('slain', { position: at, size: 1 })).toMatchObject({ sfx: 'sfx:boxDeath', vol: 1, duck: true });
    expect(sound('land', { id: 1, speed: 4 })).toMatchObject({ sfx: 'sfx:boxThud', vol: 0.5, position: [2, 0, 3] });
    expect(sound('jump', { id: 1 })).toMatchObject({ sfx: 'sfx:whoosh', position: [2, 0, 3] });
    expect(sound('dash', { id: 1 })).toMatchObject({ sfx: 'sfx:whoosh', position: [2, 0, 3] });
    expect(sound('footstep', { id: 1, side: 'L', speed: 1 })).toMatchObject({ sfx: 'sfx:boxStep', vol: 0.9 });
    expect(sound('footstep', { id: 9, side: 'L', speed: 0 })).toMatchObject({ position: null, vol: 0.4 }); // gone
    expect([sound('damage', { target: 4 }), sound('lap', { laps: 2 }), sound('hit', 3)]).toEqual([null, null, null]);
    expect(SOUND_EVENTS).toEqual(['footstep', 'land', 'jump', 'dash', 'hit', 'shot', 'slam', 'slain']);
  });

  it('chooses footsteps by the surface underfoot, the `*` one elsewhere', () => {
    expect(footstepSfx(HALL_LEVEL, [32, 0, 22])).toBe(BOX_FOOTSTEPS.stone); // the hall's floor
    expect(footstepSfx(HALL_LEVEL, [61.5, 1, 4.5])).toBe('sfx:boxStepIron'); // a brazier's iron
    expect(footstepSfx(HALL_LEVEL, [-5, 0, -5])).toBe(BOX_FOOTSTEPS['*']); // off the map
    expect(footstepSfx(null, [32, 0, 22])).toBe(BOX_FOOTSTEPS['*']);
    const onIron = world([record(1, 'footstep', { id: 1, speed: 1 })], [61.5, 1, 4.5]);
    expect(createSoundReader().read(onIron, HALL_LEVEL)[0].sfx).toBe('sfx:boxStepIron');
  });

  it('names only effects that exist', () => {
    const ids = [...Object.values(BOX_FOOTSTEPS), 'sfx:boxThud', 'sfx:whoosh', 'sfx:boxHit', 'sfx:boxLaunch'];
    for (const id of [...ids, 'sfx:boxDeath', 'sfx:boxTorch']) expect(getSfx(id).id).toBe(id);
  });

  it('reads each event once, a new world from its first, and counts those it missed', () => {
    const records = [record(1, 'hit', { size: 1 }), record(2, 'damage', {})];
    const reader = createSoundReader();
    const first = world(records);
    expect(reader.read(first, null).map((sound) => sound.type)).toEqual(['hit']);
    expect(reader.read(first, null)).toEqual([]);
    records.push(record(3, 'shot', { size: 1 }));
    expect(reader.read(first, null).map((sound) => sound.sfx)).toEqual(['sfx:boxLaunch']);
    expect(reader.read(world([record(1, 'slain', {})]), null).map((sound) => sound.type)).toEqual(['slain']);
    expect(reader.missed).toBe(0);
    const ring = world([record(300, 'hit', {})]); // 299 events left the trace unread
    expect(reader.read(ring, null)).toHaveLength(1);
    expect(reader.missed).toBe(299);
  });

  it('hashes a timeline, FNV-1a over its JSON', () => {
    expect(timelineHash([])).toBe('09612b07b5ecb5a5'); // FNV-1a 64 of '[]'
    const one = soundOf(record(1, 'hit', { size: 1 }), world([]), null)!;
    expect(timelineHash([one])).not.toBe(timelineHash([{ ...one, vol: 0.5 }]));
    expect(timelineHash([one])).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives the fight replay’s timeline: the recorded run, every kind of sound, the golden hash', () => {
    const text = readFileSync(join(ROOT, FIGHT_TIMELINE.replay), 'utf8');
    const timeline = soundTimeline(text, HALL_LEVEL);
    const golden = (JSON.parse(text) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
    expect(timeline.worldHash).toBe(golden['600']);
    expect(timeline.missed).toBe(0);
    const kinds = new Set(timeline.events.map((sound) => sound.sfx));
    for (const sfx of ['sfx:boxStep', 'sfx:boxHit', 'sfx:boxLaunch', 'sfx:boxThud', 'sfx:boxDeath', 'sfx:whoosh'])
      expect(kinds).toContain(sfx);
    expect(timeline.events.every((sound) => sound.position !== null)).toBe(true);
    expect([timeline.events.length, timeline.hash]).toEqual([FIGHT_TIMELINE.sounds, FIGHT_TIMELINE.hash]);
  });
});
