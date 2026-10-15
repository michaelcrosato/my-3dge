/**
 * @file Unit tests for the box's sound in its page (labs/box/sounds/page.ts), against a stand-in runtime that records
 * what it is asked: the song at once, calm; the room by the level; the listener at the camera with the queries; each
 * new event played once, placed, a death ducking; the music a fight's while blows land and calm `MUSIC.calm` s after;
 * the torch ambience on the nearest torches, a voice kept on its torch until another is `TORCH.keep` m nearer, and
 * retried when the runtime could not start it. Web Audio itself is tests/e2e/box-audio.spec.ts's.
 * @see labs/box/sounds/page.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { defineLevel, getLevel, type Audio, type TraceRecord } from '../../../engine';
import { createBoxSound, MUSIC, nearestTorches, TORCH, type SoundFrame } from './page';
import type { Point } from './events';

const ROOT = join(import.meta.dirname, '..', '..', '..');

beforeAll(() => {
  const file = 'labs/box/levels/hall.txt'; // the page registers it from the file
  defineLevel('level:hall', { text: readFileSync(join(ROOT, file), 'utf8'), file });
});

/** A stand-in runtime: it records every call, and `refuse` makes `play` return null (locked, or limited). */
function standIn() {
  const calls: [string, ...unknown[]][] = [];
  const voices: { id: string; position: unknown; playing: boolean }[] = [];
  let refuse = false;
  const audio = {
    play(id: string, options: { position?: Point; loop?: boolean }) {
      calls.push(['play', id, options]);
      if (refuse) return null;
      const voice = { id, position: options.position, playing: true, stop: () => void (voice.playing = false) };
      voices.push(voice);
      return voice;
    },
    update: (...args: unknown[]) => void calls.push(['update', ...args]),
    room: (room: string) => void calls.push(['room', room]),
    music: (...args: unknown[]) => void calls.push(['music', ...args]),
    intensity: (value: number) => void calls.push(['intensity', value]),
    info: () => ({ state: 'running' }),
  };
  const refusing = (on: boolean) => void (refuse = on);
  return { audio: audio as unknown as Audio, calls, voices, refusing };
}

/** A frame of a hall world at step `tick` whose trace is `records`, the camera at `at`. */
function frameOf(records: TraceRecord[], at: Point = [32, 2, 22], dt = 0.1): SoundFrame {
  const world = { tick: 1, events: { trace: () => records }, get: () => undefined };
  return { world, scene: { level: 'level:hall' }, camera: { position: at, yaw: 0, pitch: 0 }, queries: null, dt };
}

const traced = (seq: number, type: string, payload: unknown): TraceRecord => ({
  seq,
  type,
  payload,
  listeners: 0,
  failed: 0,
});

describe('the box’s sound in its page', () => {
  it('asks for the song, calm, sets the hall’s room and puts the listener at the camera', () => {
    const { audio, calls } = standIn();
    const sound = createBoxSound({ audio, publish: false });
    expect(calls).toEqual([['music', MUSIC.song, { intensity: 0 }]]);
    const frame = frameOf([]);
    sound.frame(frame);
    expect(calls).toContainEqual(['update', frame.camera, undefined]);
    expect(calls).toContainEqual(['room', 'hall']);
    sound.frame(frameOf([]));
    expect(calls.filter(([name]) => name === 'room')).toHaveLength(1); // only on a change
    expect(sound.info()).toMatchObject({ room: 'hall', intensity: 0, played: 0, log: [], missed: 0 });
  });

  it('plays each new event once, placed, a death ducking; the music is a fight’s while blows land', () => {
    const { audio, calls } = standIn();
    const sound = createBoxSound({ audio, publish: false });
    const at = [30, 1, 20] as const;
    const records = [traced(1, 'hit', { position: at, size: 1 }), traced(2, 'damage', {})];
    const frame = frameOf(records);
    sound.frame(frame);
    records.push(traced(3, 'slain', { position: at, size: 1 }));
    sound.frame({ ...frame, dt: 0.1 });
    const plays = calls.filter(([name, id]) => name === 'play' && id !== TORCH.sfx);
    expect(plays).toEqual([
      ['play', 'sfx:boxHit', { vol: expect.closeTo(0.45, 9), position: at, duck: false }],
      ['play', 'sfx:boxDeath', { vol: 1, position: at, duck: true }],
    ]);
    expect(calls).toContainEqual(['intensity', 1]);
    expect(sound.info()).toMatchObject({
      intensity: 1,
      played: 2,
      asked: { 'sfx:boxHit': 1, 'sfx:boxDeath': 1 },
      log: ['hit sfx:boxHit', 'slain sfx:boxDeath'],
    });
    for (let k = 0; k < MUSIC.calm / 0.1 - 1; k++) sound.frame({ ...frame, dt: 0.1 });
    expect(sound.info().intensity).toBe(1);
    sound.frame({ ...frame, dt: 0.2 });
    expect(sound.info().intensity).toBe(0);
    expect(calls.filter(([name]) => name === 'intensity')).toEqual([
      ['intensity', 1],
      ['intensity', 0],
    ]);
  });

  it('keeps the torches nearest the listener crackling, looped, and retries one it could not start', () => {
    const lights = getLevel('level:hall').lights;
    const { audio, voices, refusing } = standIn();
    const sound = createBoxSound({ audio, publish: false });
    refusing(true);
    sound.frame(frameOf([], [61.5, 1, 6]));
    expect(sound.info().torches).toEqual([]);
    refusing(false);
    sound.frame(frameOf([], [61.5, 1, 6]));
    const near = sound.info().torches;
    expect(near).toHaveLength(TORCH.voices);
    expect(near[0]).toBe(lights.findIndex((light) => light.col === 61 && light.row === 4));
    expect(voices.map((voice) => voice.position)).toEqual(near.map((i) => lights[i].position));
    sound.frame(frameOf([], [61.5, 1, 6])); // nothing changed: nothing restarts
    expect(voices).toHaveLength(TORCH.voices);
    sound.frame(frameOf([], [4, 1, 40])); // across the hall: new torches, the old ones stopped
    expect(voices.filter((voice) => voice.playing)).toHaveLength(TORCH.voices);
    expect(sound.info().torches.some((i) => near.includes(i))).toBe(false);
  });

  it('keeps a voice on its torch until another is TORCH.keep metres nearer', () => {
    const spots: Point[] = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 0, 5],
    ];
    expect(nearestTorches(spots, [10, 0, 1], [], 1)).toEqual([1]);
    expect(nearestTorches(spots, [10, 0, 3], [1], 1)).toEqual([1]); // 2 is nearer, by 1 m: less than the margin
    expect(nearestTorches(spots, [10, 0, 4], [1], 1)).toEqual([2]); // by 3 m
    expect(nearestTorches(spots, [2, 0, 0], [2])).toEqual([0, 2]); // 2 within the margin of 1, the second nearest
    expect(nearestTorches(spots, [0, 0, -3], [2])).toEqual([0, 1]);
    expect(nearestTorches([], [0, 0, 0], [])).toEqual([]);
  });
});
