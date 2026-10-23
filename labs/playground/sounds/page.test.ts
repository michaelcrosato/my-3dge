/**
 * @file Unit tests for the playground's sound in its page (labs/playground/sounds/page.ts), against a stand-in runtime
 * that records what it is asked: the listener at the player's head, turned as the camera looks, with the queries; the
 * reverb of the room he stands in, the open air's out of doors, set only on a change; each new event played once,
 * placed and pitched as the sound map says; the beds crossfading between the house's hum and the block's air, a bed
 * the locked runtime could not start asked for again; the wind rising with his speed; the zipline's hum while he
 * rides. Web Audio itself is tests/e2e/playground-audio.spec.ts's.
 * @see labs/playground/sounds/page.ts
 */
import { describe, expect, it } from 'vitest';
import { roomAcoustics, type Audio, type TraceRecord } from '../../../engine';
import { roomUnder } from './ground';
import { BEDS, createPlaygroundSound, EARS, WIND, ZIP, type SoundFrame } from './page';

/** A stand-in runtime: it records every call, and `refusing(true)` makes `play` return null (locked, or limited). */
function standIn() {
  const calls: [string, ...unknown[]][] = [];
  let refuse = false;
  const audio = {
    play(id: string, options: Record<string, unknown>) {
      calls.push(['play', id, options]);
      if (refuse) return null;
      const voice = {
        id,
        playing: true,
        stop: (fade?: number) => void (calls.push(['stop', id, fade]), (voice.playing = false)),
        volume: (vol: number, ease?: number) => void calls.push(['volume', id, vol, ease]),
        move: (at: unknown) => void calls.push(['move', id, at]),
      };
      return voice;
    },
    update: (...args: unknown[]) => void calls.push(['update', ...args]),
    room: (room: unknown) => void calls.push(['room', room]),
    info: () => ({ state: 'running' }),
  };
  return { audio: audio as unknown as Audio, calls, refusing: (on: boolean) => void (refuse = on) };
}

const traced = (seq: number, type: string, payload: unknown): TraceRecord => ({ seq, type, payload, listeners: 0, failed: 0 }); // prettier-ignore

/** The hall's floor (indoors, wood) and the north sidewalk (out of doors). */
const HALL = [50, 0, 52] as const;
const SIDEWALK = [62, 0.15, 84] as const;

/** A world of the block with the player (entity 1) at `at`, moving at `v`, in `mode`, whose trace is `records`. */
function worldOf(records: TraceRecord[], at: readonly number[], v = [0, 0, 0], mode = 'ground') {
  const player = { id: 1, actor: { player: true, x: at[0], y: at[1], z: at[2], vx: v[0], vy: v[1], vz: v[2] }, motion: { mode, gait: 'walk' } }; // prettier-ignore
  return { tick: 5, events: { trace: () => records }, get: (id: number) => (id === 1 ? player : undefined), query: () => [player] }; // prettier-ignore
}

/** A frame of the house's scene on `world`, the camera looking east. */
const frameOf = (world: SoundFrame['world']): SoundFrame => ({
  world,
  scene: { id: 'playground:site-house', site: 'site:block' },
  camera: { position: [40, 8, 40], yaw: Math.PI / 2, pitch: -0.4 },
  queries: null,
  dt: 1 / 60,
});

describe('the playground’s sound in its page', () => {
  it('hears at the player’s head, turned as the camera looks, in the reverb of his room, set on a change', () => {
    const { audio, calls } = standIn();
    const sound = createPlaygroundSound({ audio, publish: false });
    sound.frame(frameOf(worldOf([], HALL)));
    expect(calls).toContainEqual(['update', { position: [50, EARS, 52], yaw: Math.PI / 2, pitch: -0.4 }, undefined]);
    expect(calls).toContainEqual(['room', roomAcoustics(roomUnder(...HALL)!)]);
    expect(sound.info().room).toBe('room:hall');
    sound.frame(frameOf(worldOf([], HALL)));
    expect(calls.filter(([name]) => name === 'room')).toHaveLength(1); // only on a change
    sound.frame(frameOf(worldOf([], SIDEWALK)));
    expect(calls).toContainEqual(['room', 'outdoor']);
    expect(sound.info().room).toBe('outdoor');
  });

  it('plays each new event once, placed and pitched as the sound map says', () => {
    const { audio, calls } = standIn();
    const sound = createPlaygroundSound({ audio, publish: false });
    const records = [traced(1, 'footstep', { id: 1, side: 'L', speed: 1.5 }), traced(2, 'lap', { laps: 1 })];
    const world = worldOf(records, HALL);
    sound.frame(frameOf(world));
    sound.frame(frameOf(world));
    const steps = calls.filter(([name, id]) => name === 'play' && id === 'sfx:stepWood');
    expect(steps).toEqual([['play', 'sfx:stepWood', { vol: 0.55, pitch: 1, position: [50, 0, 52] }]]);
    expect(sound.info()).toMatchObject({ asked: { 'sfx:stepWood': 1 }, played: 1, log: ['footstep sfx:stepWood'], missed: 0 }); // prettier-ignore
  });

  it('crossfades the beds, the house’s hum in a room and the block’s air out of doors, retrying one not started', () => {
    const { audio, calls, refusing } = standIn();
    const sound = createPlaygroundSound({ audio, publish: false });
    refusing(true);
    sound.frame(frameOf(worldOf([], HALL)));
    refusing(false);
    sound.frame(frameOf(worldOf([], HALL)));
    const bedsAsked = calls.filter(([name, id]) => name === 'play' && id === BEDS.indoors);
    expect(bedsAsked).toEqual([0, 1].map(() => ['play', BEDS.indoors, { loop: true, vol: BEDS.vol }])); // asked again
    expect(calls.some(([name, id]) => name === 'play' && id === BEDS.outdoors)).toBe(false); // silent: not started
    sound.frame(frameOf(worldOf([], SIDEWALK)));
    expect(calls).toContainEqual(['volume', BEDS.indoors, 0, BEDS.fade]);
    expect(calls).toContainEqual(['play', BEDS.outdoors, { loop: true, vol: BEDS.vol }]);
    expect(sound.info().beds).toEqual({ outdoors: BEDS.vol, indoors: 0 });
  });

  it('raises the wind with his speed, and hums the zipline where he is while he rides one', () => {
    const { audio, calls } = standIn();
    const sound = createPlaygroundSound({ audio, publish: false });
    sound.frame(frameOf(worldOf([], SIDEWALK, [2, 0, 0])));
    expect(sound.info().wind).toBe(0);
    sound.frame(frameOf(worldOf([], SIDEWALK, [0, -6, 6], 'zipline')));
    const wind = Math.round((20 * WIND.vol * (Math.hypot(6, 6) - WIND.from)) / (WIND.full - WIND.from)) / 20;
    expect(sound.info().wind).toBe(wind); // in twentieths: 0.5
    sound.frame(frameOf(worldOf([], SIDEWALK, [0, -6, 6], 'zipline')));
    expect(calls.filter(([name, id]) => name === 'volume' && id === WIND.sfx)).toEqual([]); // a ramp a change
    expect(calls).toContainEqual(['play', WIND.sfx, { loop: true, vol: sound.info().wind }]);
    expect(calls).toContainEqual(['play', ZIP.sfx, { loop: true, vol: ZIP.vol, position: [62, 0.15 + EARS, 84] }]);
    expect(sound.info().zip).toBe(true);
    sound.frame(frameOf(worldOf([], SIDEWALK, [13, 0, 0])));
    expect(calls).toContainEqual(['volume', WIND.sfx, WIND.vol, WIND.ease]); // full past `WIND.full`
    expect(calls).toContainEqual(['stop', ZIP.sfx, 0.3]);
    expect(sound.info().zip).toBe(false);
  });
});
