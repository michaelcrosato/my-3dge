/**
 * @file Unit tests for labs/playground/ui/prefs.ts (WP 13.25): what is kept comes back, what is not of its shape is
 * dropped; the query takes the kept camera and settings only where it names none, a link winning; a kept value the
 * schema refuses is left out, so the page still starts; and the movement profile is a recorded setting: a run opened
 * with it keeps it in its replay, which plays back to the same hash.
 * @see labs/playground/ui/prefs.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless, createStore, memoryBackend, parseRoutes } from '../../../engine';
import { playReplay } from '../../../engine/sim/replay';
import '../cast/player';
import { gym } from '../scenes/gym';
import { PREFS_KEY, PREFS_PREFIX, prefsQuery, readPrefs, savePrefs } from './prefs';

/** A store in memory, under the playground's prefix. */
const memory = () => createStore({ prefix: PREFS_PREFIX, backend: memoryBackend() });

describe('the playground’s preferences', () => {
  it('keeps what was changed and reads back only what is of its shape', () => {
    const store = memory();
    expect(readPrefs(store)).toEqual({ settings: {}, volumes: {} }); // a first visit
    savePrefs(store, { camera: 'isometric', settings: { 'cam.fov': 104, quality: 'low' }, volumes: { music: 0.25 } });
    expect(readPrefs(store)).toEqual({ camera: 'isometric', settings: { 'cam.fov': 104, quality: 'low' }, volumes: { music: 0.25 } }); // prettier-ignore
    store.set(PREFS_KEY, {
      camera: 'drone',
      settings: { 'cam.fov': [1], 'not.a.pref': 1 },
      volumes: { music: 3, ui: 1 },
    });
    expect(readPrefs(store)).toEqual({ settings: {}, volumes: {} });
  });

  it('writes the kept camera and settings into the query where it names none, and leaves out a refused value', () => {
    const prefs = { camera: 'first', settings: { 'cam.fov': 100, quality: 'medium', 'input.sensitivity': 99 }, volumes: {} }; // prettier-ignore
    const search = new URLSearchParams('?scene=gym&quality=high');
    expect(prefsQuery(prefs, search, [gym.id])).toEqual(['cam3', 'cam.fov']); // the link's quality wins; 99 is past 20
    expect(search.toString()).toBe('scene=gym&quality=high&cam3=first&cam.fov=100');
    expect(parseRoutes(`?${search}`, { scenes: [gym.id] }).settings).toMatchObject({ 'cam.fov': 100, quality: 'high' });
    const linked = new URLSearchParams('?cam=iso');
    expect(prefsQuery(prefs, linked, [gym.id])).not.toContain('cam3'); // a camera in the link stays
  });

  it('opens a run on the kept movement profile, which its replay holds and plays back to the same hash', async () => {
    const search = new URLSearchParams();
    prefsQuery({ settings: { 'playground.movement': 'movement:platformer' }, volumes: {} }, search, [gym.id]);
    const { settings } = parseRoutes(`?${search}`, { scenes: [gym.id] });
    const live = await createHeadless({ scene: gym, settings });
    for (let k = 0; k < 90; k++) live.step(1, { move: [-1, 0] });
    const replay = (live.input as { record(): { settings: Record<string, unknown> } }).record();
    expect(replay.settings).toMatchObject({ 'playground.movement': 'movement:platformer' });
    expect(playReplay(replay).session.world.hash()).toBe(live.hash());
  });
});
