/**
 * @file Unit tests for engine/gfx/stageSky.ts (T1, PLAN.md WP 7.8): on the hall, in Node, the stage's own lights draw
 * until a preset is shown; the sky is made then, once, from the hall's 30 torch spots with its phases from the stream
 * given, and registered with the warm-up given before; showing it hides the stage's lights and installs the fog, and
 * the visible lights (what the warm-up keys) are the sky's; showing `''` hides the sky and its parts, takes the fog out
 * and puts the background back, leaving exactly the first visible lights; the quality tier's budget reaches the sky,
 * before or after it is made; `update` follows the focus only while the sky shows; given the scene's hour, the sky
 * shows the hour's (WP 13.23) from the first show, again when the hour moves a minute, never changing who casts, and
 * the preset once the hour is gone; `dispose` takes it all out.
 * @see engine/gfx/stageSky.ts
 */
import { readFileSync } from 'node:fs';
import { Color, PerspectiveCamera, Scene, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { Rng } from '../core/rng';
import { compileLevel } from '../world/level/compile';
import { defineLights } from './lights';
import { qualityBudget } from './quality';
import { defineSkies } from './sky';
import { createStageSky } from './stageSky';

const HALL = compileLevel(readFileSync('labs/box/levels/hall.txt', 'utf8'), { file: 'hall.txt' });
const BACKGROUND = '#2a3140';

/** The scene's visible lights as the warm-up keys them (engine/gfx/warmup.ts): id, and `s` when it casts. */
function visibleLights(scene: Scene): string[] {
  const lights: string[] = [];
  scene.traverseVisible((o: Object3D) => {
    if ((o as { isLight?: boolean }).isLight) lights.push(`${o.name}${o.castShadow ? ' s' : ''}`);
  });
  return lights;
}

/** A hall scene with the stage's lights, a registry with the sky presets and light kinds, and a recording warm-up. */
function hall() {
  const registry = createRegistry();
  defineSkies(registry);
  defineLights(registry);
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  let streams = 0;
  const rng = () => (streams++, new Rng(7));
  const lights = createStageSky(scene, { level: HALL, registry, background: BACKGROUND, rng });
  const ids: string[] = [];
  const parts = new Map<string, () => string>();
  const warmup = {
    register: (id: string) => (ids.push(id), { dispose: () => ids.splice(ids.indexOf(id), 1) }),
    keyPart: (name: string, part: () => string) => (parts.set(name, part), { dispose: () => parts.delete(name) }),
  };
  return { scene, lights, ids, parts, warmup, streams: () => streams };
}

describe('the stage sky', () => {
  it("draws with the stage's own lights until a preset is shown, then makes the sky once and swaps the lights", () => {
    const { scene, lights, ids, parts, warmup, streams } = hall();
    const own = visibleLights(scene);
    expect(own).toEqual(['light:sky', 'light:sun s']);
    lights.register(warmup);
    expect([lights.sky, lights.shown, ids, parts.size, streams()]).toEqual([null, '', [], 0, 0]);

    lights.show('sky:hall');
    expect(lights.sky?.pool.sources).toHaveLength(30); // the hall's torch spots
    expect([lights.shown, ids, [...parts.keys()], streams()]).toEqual(['sky:hall', ['sky'], ['atmosphere'], 1]);
    expect(scene.fogNode).toBe(lights.sky!.atmosphere.fogNode);
    expect(parts.get('atmosphere')!()).toBe('fog');
    const lit = visibleLights(scene);
    expect(lit.filter((name) => name.startsWith('lights:pool/'))).toHaveLength(12);
    expect(lit).not.toContain('light:sky');
    expect(lit).not.toContain('light:sun s');
    expect(lit.filter((name) => name.endsWith(' s'))).toEqual(['lights:pool/0 s', 'lights:pool/1 s']); // two casters
    expect((scene.background as Color).getHexString()).toBe('06050b');

    const sky = lights.sky;
    lights.show('');
    expect(visibleLights(scene)).toEqual(own);
    expect([scene.fogNode, parts.get('atmosphere')!()]).toEqual([null, 'none']);
    expect((scene.background as Color).getHexString()).toBe(BACKGROUND.slice(1));
    expect([sky!.dome.visible, sky!.backdrop.visible, sky!.pool.group.visible]).toEqual([false, false, false]);

    lights.show('sky:daylight');
    expect([lights.sky, streams()]).toEqual([sky, 1]); // made once
    expect([sky!.dome.visible, sky!.backdrop.visible]).toEqual([true, true]);
    expect(visibleLights(scene)).toContain('sky/sun s'); // the daylight's sun takes the first caster
  });

  it("takes the quality tier's shadow budget before and after the sky is made", () => {
    const { scene, lights } = hall();
    lights.budget(qualityBudget('medium', false));
    lights.show('sky:hall');
    const casters = () => visibleLights(scene).filter((name) => name.endsWith(' s'));
    expect(casters()).toEqual(['lights:pool/0 s']);
    lights.budget(qualityBudget('low', false));
    expect(casters()).toEqual([]);
    lights.budget(qualityBudget('high', false));
    expect(lights.report().sky?.casters).toEqual({ sun: false, points: 2 });
  });

  it('follows the focus and flickers only while a sky shows', () => {
    const { lights } = hall();
    const camera = new PerspectiveCamera();
    camera.position.set(32, 20, 40);
    lights.update({ camera, focus: [32.5, 0.5, 24.5], time: 1 }); // no sky yet: nothing to follow
    expect(lights.report()).toEqual({ shown: '', sky: null });
    lights.show('sky:hall');
    lights.update({ camera, focus: [32.5, 0.5, 24.5], time: 1 });
    const first = lights.report().sky!.slots;
    expect(first.every((slot) => slot.source >= 0 && slot.intensity > 0)).toBe(true);
    lights.update({ camera, focus: [32.5, 0.5, 24.5], time: 1.3 });
    const later = lights.report().sky!.slots;
    expect(later.map((slot) => slot.source)).toEqual(first.map((slot) => slot.source));
    expect(later.map((slot) => slot.intensity)).not.toEqual(first.map((slot) => slot.intensity)); // the flicker
    lights.show('');
    lights.update({ camera, focus: [2, 0, 2], time: 2 });
    expect(lights.sky!.pool.slots()).toEqual(later); // hidden: left as it was
  });

  it("shows the hour's sky while the scene has a clock, again when it moves a minute, and the preset without one", () => {
    const { lights } = hall();
    const view = (hour: number | null) => ({ camera: new PerspectiveCamera(), focus: [32, 0, 24], time: 0, hour });
    lights.update(view(21)); // known before the first show: the warm-up compiles the night
    lights.show('sky:daylight');
    const shows = () => lights.report().sky!;
    expect(shows().preset).toBe('daylight@21.00');
    const casters = shows().casters;
    lights.update(view(21.01)); // under a minute: as it was
    expect(shows().preset).toBe('daylight@21.00');
    lights.update(view(12));
    expect([shows().preset, shows().casters]).toEqual(['daylight@12.00', casters]); // noon casts as the night does
    lights.update(view(null));
    expect(shows().preset).toBe('sky:daylight');
  });

  it("fits the sky's sun to a terrain's ground when the stage has no level", () => {
    const registry = createRegistry();
    defineSkies(registry);
    defineLights(registry);
    const area = { corner: [10, 20] as const, size: [40, 60] as const };
    const lights = createStageSky(new Scene(), { level: null, area, registry, background: BACKGROUND });
    lights.show('sky:daylight');
    const { sun } = lights.sky!;
    expect(sun.target.position.toArray()).toEqual([30, 0, 50]); // the ground's middle, not the origin's 16 m square
    expect(sun.shadow.camera.right).toBeCloseTo(Math.hypot(40, 60) / 2 + 2, 9);
  });

  it('takes everything out of the scene when disposed', () => {
    const { scene, lights } = hall();
    lights.show('sky:hall');
    lights.dispose();
    expect([lights.sky, scene.fogNode, scene.children.length]).toEqual([null, null, 0]);
  });
});
