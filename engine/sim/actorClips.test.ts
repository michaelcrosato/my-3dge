/**
 * @file Tests engine/sim/actorClips.ts (WP 8.9): an actor spawned with clips holds its clip layer as the component
 * `clips`, playing its first clip from step 0; the system steps it once a tick (the hash covers it) and emits its
 * events as `clip`; `playClip`, `stopClip`, `seekClip` and `locomoteClips` change it, `clipLayerOf` reads it; `addClips`
 * gives a live actor clips and refuses another entity; a capture continues exactly; `body` adds the component `puppet`.
 */
import { describe, expect, it } from 'vitest';
import { defineClipSet } from '../anim/clip/clipsets';
import type { ClipLayerState } from '../anim/clip/layer';
import { createCharacter } from '../physics/character';
import { physicsOf } from '../physics/binding';
import { busy, REST, standing } from '../../tests/unit/anim/clip-fixtures';
import { addClips, clipLayerOf, locomoteClips, playClip, seekClip, stopClip, type ClipsSpec } from './actorClips';
import { spawnActor } from './actors';
import { defineScene, startScene } from './scene';
import type { World } from './world';

defineClipSet({
  set: 'SIMTEST',
  sources: { A: { rest: REST } },
  clips: {
    Stand: { src: 'A', dur: 1, loop: true, keys: [standing(0), standing(1)] },
    Wave: { src: 'A', dur: 0.5, keys: [standing(0), busy(0.25), standing(0.5)], events: [{ t: 0.25, name: 'clap' }] },
    Walk: { src: 'A', dur: 1, loop: true, speed: 140, keys: [standing(0), busy(0.5), standing(1)] },
  },
});

/** A floor, an actor with clips at the origin (playing `play`), a plain one at x 4, and an animated one at x 8. */
function yard(clips: ClipsSpec = { sets: ['clipset:simtest'] }) {
  const scene = defineScene(`test:actor-clips-${Math.random()}`, {
    physics: true,
    setup(w) {
      const floor = { shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] } as const;
      physicsOf(w).addBody({ type: 'fixed', colliders: [floor] });
      const anim = { build: 'build:heroic' };
      spawnActor(w, { at: [0, 0, 0], character: createCharacter(), anim, clips, body: 'body:mannequin' });
      spawnActor(w, { at: [4, 0, 0], character: createCharacter(), player: false });
      spawnActor(w, { at: [8, 0, 0], character: createCharacter(), player: false, anim });
    },
  });
  return startScene(scene).world;
}

/** The layer state of entity `id`. */
const stateOf = (w: World, id = 1) => (w.get(id) as unknown as { clips: { state: ClipLayerState } }).clips.state;

describe('clips on actors', () => {
  it('spawns an actor with its clip layer as the component clips, its first clip playing from step 0', () => {
    const w = yard({ sets: ['clipset:simtest'], play: { clip: 'Wave', fade: 0 } });
    expect(stateOf(w).slots).toMatchObject([{ clip: 'SIMTEST/Wave', t: 0, w: 1 }]);
    expect((w.get(1) as unknown as { puppet: { body: string } }).puppet).toEqual({ body: 'body:mannequin' });
    expect((w.get(3) as unknown as { puppet?: unknown; clips?: unknown }).clips).toBeUndefined();
    w.step({});
    expect(stateOf(w).slots[0].t).toBeCloseTo(1 / 60, 12);
  });

  it('steps once a tick, emits the layer’s events as clip, and the hash covers what plays', () => {
    const w = yard();
    const hash = w.hash();
    playClip(w, 1, 'Wave', { fade: 0 });
    expect(w.hash()).not.toBe(hash);
    for (let i = 0; i < 45; i++) w.step({}); // 0.5 s, then its 0.2 s fade out
    const clips = w.events.trace().filter((record) => record.type === 'clip');
    expect(clips.map(({ payload }) => payload)).toEqual([
      { id: 1, type: 'event', clip: 'SIMTEST/Wave', name: 'clap' },
      { id: 1, type: 'end', clip: 'SIMTEST/Wave' },
    ]);
    expect(stateOf(w).slots).toEqual([]); // ended, faded out
  });

  it('plays, seeks, stops and locomotes through the sim, and reads the layer back', () => {
    const w = yard();
    playClip(w, 1, 'SIMTEST/Stand', { fade: 0, speed: 0.5 });
    w.step({});
    expect(clipLayerOf(w, 1).current).toMatchObject({ clip: 'SIMTEST/Stand', rate: 0.5 });
    seekClip(w, 1, 0.75);
    expect(stateOf(w).slots[0].t).toBe(0.75);
    seekClip(w, 1, 9);
    expect(stateOf(w).slots[0].t).toBe(1); // within its length
    stopClip(w, 1, 0.1);
    for (let i = 0; i < 7; i++) w.step({});
    expect(stateOf(w).slots).toEqual([]);
    seekClip(w, 1, 0.5); // nothing playing: nothing changes
    expect(stateOf(w).slots).toEqual([]);
    locomoteClips(w, 1, { idle: 'Stand', walk: 'Walk' });
    for (let i = 0; i < 30; i++) w.step({ move: [1, 0] });
    expect(clipLayerOf(w, 1).current).toMatchObject({ clip: 'SIMTEST/Walk', loco: true });
    expect(() => playClip(w, 1, 'Wav')).toThrow(/ANIM_UNKNOWN_CLIP.*Wave/);
  });

  it('gives a live actor clips, and refuses an entity without an animator', () => {
    const w = yard();
    w.step({});
    addClips(w, 3, { sets: ['clipset:simtest'], play: 'Stand' });
    expect(stateOf(w, 3).slots).toMatchObject([{ clip: 'SIMTEST/Stand' }]);
    expect(() => addClips(w, 2, { sets: ['clipset:simtest'] })).toThrow(/SIM_BAD_ARGUMENT.*animated actor/);
    expect(() => playClip(w, 2, 'Stand')).toThrow(/SIM_BAD_ARGUMENT.*addClips/);
    expect(() => addClips(w, 3, { sets: ['clipset:none'] })).toThrow(/CORE_NO_ENTRY/);
  });

  it('continues a capture exactly', () => {
    const w = yard({ sets: ['clipset:simtest'], play: 'Wave' });
    for (let i = 0; i < 10; i++) w.step({});
    const capture = w.capture();
    for (let i = 0; i < 20; i++) w.step({});
    const [hash, state] = [w.hash(), JSON.stringify(stateOf(w))];
    w.restore(capture);
    for (let i = 0; i < 20; i++) w.step({});
    expect([w.hash(), JSON.stringify(stateOf(w))]).toEqual([hash, state]);
  });
});
