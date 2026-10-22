/**
 * @file Unit tests for the agent eye (engine/dev/eye.ts, PLAN.md WP 12.3), on a physics world built by hand: straight
 * down through an orthographic camera it sees a crate where it stands, cell for cell, and the floor round it; through
 * a perspective camera a wall hides what stands behind it; a classic view's height boost draws a pillar taller and the
 * eye sees it so; a body is named by the entity whose component holds it, the player's `@`, the level's walls `#` and
 * floors `.`, a letter per kind; and `__engine.eye` looks through the view's camera, headless, past the player's body
 * in first person.
 * @see engine/dev/eye.ts
 */
import { readFileSync } from 'node:fs';
import { OrthographicCamera, PerspectiveCamera, WebGPUCoordinateSystem } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import '../../labs/box/scenes/room-hero';
import { createHeadless } from '../app/headless';
import { createRegistry, registry } from '../core/registry';
import { createSettings, defineSettings } from '../core/settings';
import { BoostedOrthographicCamera } from '../gfx/cameras/boost';
import { PHYSICS_SETTINGS } from '../physics/params';
import { createPhysics } from '../physics/world';
import type { EntityData } from '../sim/state';
import { defineLevel } from '../world/level/level';
import { asciiOf, look, ownersOf, seen, WEBGPU_COORDINATES, type EyeOwner } from './eye';

const ROOM = 'labs/box/levels/room.txt';
if (!registry.has('level', 'level:room')) defineLevel('level:room', { text: readFileSync(ROOM, 'utf8'), file: ROOM });

/** A sim stand-in for `step`, with no gravity so nothing moves. */
function still() {
  const registry = createRegistry();
  defineSettings(PHYSICS_SETTINGS, registry);
  const settings = createSettings({ registry });
  settings.set('physics.gravity', 0);
  return { dt: 1 / 60, settings: settings.sim };
}

/** A 20 m floor (top y 0), a 1 m crate at (2, 0.5, 0), a wall 4 m high across z = −3, a pillar 2 m tall at (−2.25, 1, 0.25). */
function yard() {
  const p = createPhysics();
  p.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }] });
  const crate = p.addBody({ type: 'fixed', position: [2, 0.5, 0], colliders: [{ shape: { type: 'box', size: [1, 1, 1] } }] }); // prettier-ignore
  const wall = p.addBody({ type: 'fixed', position: [0, 2, -3], colliders: [{ shape: { type: 'box', size: [20, 4, 0.5] } }] }); // prettier-ignore
  const pillar = p.addBody({ type: 'fixed', position: [-2.25, 1, 0.25], colliders: [{ shape: { type: 'box', size: [0.5, 2, 0.5] } }] }); // prettier-ignore
  p.step(still());
  return { p, crate, wall, pillar };
}

/** A frustum 9 m tall at 16:9: an orthographic camera's left, right, top, bottom, near and far. */
const FRUSTUM = [-8, 8, 4.5, -4.5, 0.1, 100] as const;

/** `camera` placed at `position` with `up`, looking at `at`, in the view's coordinates. */
function aim<T extends OrthographicCamera>(camera: T, position: Vec3, at: Vec3, up: Vec3): T {
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(...position);
  camera.up.set(...up);
  camera.lookAt(...at);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

type Vec3 = [number, number, number];

describe('the agent eye', () => {
  it('sees straight down a crate where it stands, cell for cell, and the floor round it', () => {
    const { p, crate } = yard();
    const owners = new Map<number, EyeOwner>([[crate, { entity: 7, kind: 'crate', player: false, actor: false }]]);
    const down = aim(new OrthographicCamera(...FRUSTUM), [0, 10, 0], [0, 0, 0], [0, 0, -1]); // straight down, north up
    const view = look(p, down, owners, { cols: 32, rows: 18 }); // half a metre a cell
    const thing = view.visible.find((t) => t.entity === 7)!;
    expect([thing.kind, thing.cells, seen(view, 7), seen(view, 8)]).toEqual(['crate', 4, true, false]); // 1 m square: 2 × 2 cells
    expect(view.visible.find((t) => t.key === 'level')!.cells).toBe(32 * 18 - 4); // the rest, the pillar's cell too: no one holds it
    expect([view.empty, view.cells.length]).toEqual([0, 32 * 18]);
    const { map, legend } = asciiOf(view);
    expect([map[8].slice(18, 22), map[9].slice(18, 22), map[10].slice(18, 22)]).toEqual(['.cc.', '.cc.', '....']); // x 1.5 to 2.5: columns 19 and 20
    expect(legend).toEqual({ '.': 'the level: a floor', c: 'crate' }); // seen from above, every surface faces up
    p.dispose();
  });

  it('sees through a perspective lens, a wall hiding what stands behind it', () => {
    const { p, crate, wall } = yard();
    const owners = new Map<number, EyeOwner>([
      [crate, { entity: 1, kind: 'actor', player: true, actor: true }],
      [wall, { entity: 2, kind: 'wall', player: false, actor: false }],
    ]);
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 100);
    camera.coordinateSystem = WebGPUCoordinateSystem;
    camera.position.set(2, 1.5, 6);
    camera.lookAt(2, 0.5, 0);
    camera.updateProjectionMatrix();
    const front = look(p, camera, owners, { cols: 48, rows: 27 });
    expect([seen(front, 1), seen(front, 2)]).toEqual([true, true]);
    camera.position.set(2, 1.5, -8); // behind the wall, looking at the crate through it
    camera.lookAt(2, 0.5, 0);
    const behind = look(p, camera, owners, { cols: 48, rows: 27 });
    expect([seen(behind, 1), seen(behind, 2)]).toEqual([false, true]);
    expect(asciiOf(front).legend).toMatchObject({ '@': 'the player', w: 'wall' });
    p.dispose();
  });

  it('sees a classic view’s boosted heights as the frame draws them: a pillar twice as tall at a boost of 2', () => {
    const { p, pillar } = yard();
    const owners = new Map<number, EyeOwner>([[pillar, { entity: 3, kind: 'pillar', player: false, actor: false }]]);
    const side = (k: number) => {
      const camera = aim(new BoostedOrthographicCamera(...FRUSTUM), [-2, 1, 10], [-2, 1, 0], [0, 1, 0]); // the pillar a column left of the middle
      camera.boost = k;
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      return look(p, camera, owners, { cols: 32, rows: 36 }).visible.find((t) => t.entity === 3)!.cells;
    };
    expect([side(1), side(2)]).toEqual([8, 16]); // one column of 0.25 m rows: 2 m tall, then drawn 4 m
    p.dispose();
  });

  it('reads three.js’s WebGPU coordinate system by its value', () =>
    expect(WEBGPU_COORDINATES).toBe(WebGPUCoordinateSystem));

  it('names a body by the entity whose component holds it: its prop, an actor, the player, else its first component', () => {
    const entities = [
      { id: 1, actor: { body: 4, player: true } },
      { id: 2, sceneProp: { prop: 'prop:crate', body: 5 } },
      { id: 3, pathMover: { body: 6 } },
      { id: 4, puppet: { body: 'body:humanoid' }, actor: { body: 7, player: false } },
      { id: 5, sceneProp: { prop: 'prop:pane', body: -1 } },
    ] as unknown as EntityData[];
    expect([...ownersOf(entities)]).toEqual([
      [4, { entity: 1, kind: 'actor', player: true, actor: true }],
      [5, { entity: 2, kind: 'crate', player: false, actor: false }],
      [6, { entity: 3, kind: 'pathMover', player: false, actor: false }],
      [7, { entity: 4, kind: 'actor', player: false, actor: true }],
    ]);
  });

  it('looks through the view’s camera as placed, headless (__engine.eye)', async () => {
    const engine = await createHeadless({ scene: 'box:room-hero', view: true });
    engine.step(1); // the bodies a scene's setup adds join the queries at the first physics step
    const eye = (engine as unknown as { eye(size?: object): ReturnType<typeof asciiOf> & { cols: number; rows: number; visible: { kind: string; cells: number }[] } }).eye(); // prettier-ignore
    expect([eye.cols, eye.rows, eye.map.length, eye.legend['#'], eye.legend['.'], eye.legend['@']]).toEqual([96, 54, 54, 'the level: a wall', 'the level: a floor', 'the player']); // prettier-ignore
    expect(eye.visible.map((thing) => thing.kind)).toEqual(['level', 'actor']); // the iso view on the hero, in the room
    expect(() => (engine as unknown as { eye(size: object): unknown }).eye({ cols: 0 })).toThrow(/SIM_BAD_ARGUMENT.*cols/); // prettier-ignore
    (engine as unknown as { camera: { set(code: string): unknown } }).camera.set('cam3=first');
    const first = (engine as unknown as { eye(): { visible: { kind: string }[] } }).eye();
    expect(first.visible.map((thing) => thing.kind)).toEqual(['level']); // past his own body, which his eye stands in
  });
});
