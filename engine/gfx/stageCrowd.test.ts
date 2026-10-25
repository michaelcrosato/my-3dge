/**
 * @file Unit tests for crowd bodies on the stage (engine/gfx/stageCrowd.ts, PLAN.md WP 5.7 core proposal), in Node: a
 * stage with no crowd body makes no crowd and keeps its scene graph; the first one makes it under the stage's scene,
 * and each look is prepared once; every body the camera sees is posed and drawn, at its band, and one behind the
 * camera is not; drawing never writes the components; the warm-up sees the crowd's batches made after it was
 * registered, and the shader key names the looks; the stage draws a `crowdBody` entity through the crowd, never as a
 * stand-in, and forgets one that leaves; given features with `feature:gpuCrowds` on, the crowd is made again through a
 * GPU crowd sized for its bodies, and once a frame outgrows it, again twice as large before that frame draws.
 * @see engine/gfx/stageCrowd.ts
 */
import { PerspectiveCamera, Scene, type Object3D } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { registry } from '../core/registry';
import { stepCrowdBody, type CrowdBody } from '../sim/crowdBodies';
import type { EntityData } from '../sim/state';
import { createWorld, type World } from '../sim/world';
import { compileLevel } from '../world/level/compile';
import { createMaterialLibrary } from './materials/library';
import { createStage } from './stage';
import { createStageCrowd } from './stageCrowd';

/** Crowd bodies of `rigs`, 1.5 m apart along x at z 0, each stepped `steps` times walking north: their entities. */
function bodies(rigs: readonly (Partial<CrowdBody> & { rig: CrowdBody['rig'] })[], steps = 10): EntityData[] {
  const w = createWorld({ seed: 4 }) as World<{ crowdBody: CrowdBody }>;
  const ids = w.run((world) =>
    rigs.map((values, i) => world.spawn({ crowdBody: { ...values, x: i * 1.5 } as CrowdBody })),
  );
  for (let k = 0; k < steps; k++) {
    w.run((world) => {
      for (const id of ids) {
        const body = world.get(id)!.crowdBody!;
        const y = body.rig === 'floater' ? 1.25 : 0;
        stepCrowdBody(world, id, body, { at: [body.x, y, body.z - world.dt], velocity: [0, 0, -1], yaw: Math.PI });
      }
    });
  }
  return w.query('crowdBody') as unknown as EntityData[];
}

/** A camera 6 m south of the row, 2 m up, looking at it. */
function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
  c.position.set(1.5, 2, 6);
  c.lookAt(1.5, 0.8, 0);
  c.updateMatrixWorld(true);
  return c;
}

/** A warm-up stand-in that records what is registered and the shader key's parts. */
function fakeWarmup() {
  const entries = new Map<string, { objects(): readonly Object3D[] }>();
  const parts = new Map<string, () => string>();
  return {
    entries,
    parts,
    register(id: string, entry: { objects(): readonly Object3D[] }) {
      entries.set(id, entry);
      return { dispose: () => entries.delete(id) };
    },
    keyPart(name: string, part: () => string) {
      parts.set(name, part);
      return { dispose: () => parts.delete(name) };
    },
  };
}

const ROW = [{ rig: 'humanoid' }, { rig: 'blob', look: 'horns', size: 0.375 }, { rig: 'floater' }, { rig: 'quadruped' }] as const; // prettier-ignore

describe('crowd bodies on the stage', () => {
  it('makes no crowd until the first crowd body, then one under the scene, each look prepared once', () => {
    const scene = new Scene();
    const crowd = createStageCrowd({ scene, materials: createMaterialLibrary() });
    expect(crowd.capture([{ id: 1, actor: { x: 0, z: 0 } } as EntityData], 1 / 60)).toEqual(new Set());
    expect(crowd.draw(1, camera())).toBe(0);
    expect([crowd.crowd, scene.children.length]).toEqual([null, 0]);
    const row = bodies(ROW);
    expect(crowd.capture(row, 1 / 60)).toEqual(new Set(row.map((e) => e.id)));
    expect(scene.children).toEqual([crowd.crowd!.root]);
    const batches = crowd.crowd!.rigs.size;
    crowd.capture(bodies([...ROW, ...ROW]), 1 / 60);
    expect(crowd.crowd!.rigs.size).toBe(batches); // the same looks again: nothing more to prepare
  });

  it('poses and draws every body the camera sees, at its band, and not one behind it', () => {
    const crowd = createStageCrowd({ scene: new Scene(), materials: createMaterialLibrary() });
    const row = bodies(ROW);
    crowd.capture(row, 1 / 60);
    expect(crowd.draw(1, camera())).toBe(4);
    const stats = crowd.crowd!.stats();
    expect(stats.bodies).toBe(4);
    expect(stats.lod.bands[0]).toBe(4); // all within 15 m: full detail
    expect(stats.instances['crowd/rigs/cone']).toBe(4); // the blob's horns and the dog's ears
    const behind = camera();
    behind.position.set(1.5, 2, -6);
    behind.lookAt(1.5, 0.8, -20);
    behind.updateMatrixWorld(true);
    expect(crowd.draw(1, behind)).toBe(0);
    expect(crowd.crowd!.stats().lod.outside).toBe(4);
  });

  it('never writes the components it draws', () => {
    const crowd = createStageCrowd({ scene: new Scene(), materials: createMaterialLibrary() });
    const row = bodies(ROW, 30);
    const before = JSON.stringify(row);
    crowd.capture(row, 1 / 60);
    crowd.capture(bodies(ROW, 31), 1 / 60);
    for (const alpha of [0, 0.5, 1]) crowd.draw(alpha, camera());
    expect(JSON.stringify(row)).toBe(before);
  });

  it('registers the crowd made after the warm-up was, and names its looks in the shader key', () => {
    const crowd = createStageCrowd({ scene: new Scene(), materials: createMaterialLibrary() });
    const warmup = fakeWarmup();
    const registration = crowd.register(warmup);
    expect(warmup.parts.get('stage:crowd')!()).toBe('');
    expect(warmup.entries.size).toBe(0);
    crowd.capture(bodies([{ rig: 'blob' }]), 1 / 60);
    expect(warmup.entries.has('stage:crowd')).toBe(true);
    expect(warmup.parts.get('stage:crowd')!()).toBe('blob:');
    crowd.capture(bodies([{ rig: 'blob' }, { rig: 'humanoid', look: 'build:heroic' }]), 1 / 60);
    expect(warmup.parts.get('stage:crowd')!()).toBe('blob:;humanoid:build:heroic');
    registration.dispose();
    expect([warmup.entries.size, warmup.parts.size]).toEqual([0, 0]);
  });

  it('draws through a GPU crowd while feature:gpuCrowds is on, made twice as large when a frame outgrows it', () => {
    const crowd = createStageCrowd({ scene: new Scene(), materials: createMaterialLibrary() });
    crowd.capture(bodies(ROW), 1 / 60);
    expect(crowd.crowd!.gpu).toBeNull(); // the instancing service, until the renderer's features say otherwise
    const warmup = fakeWarmup();
    crowd.register(warmup, { on: ['feature:gpuCrowds'], off: [], downgrades: [] });
    expect(crowd.crowd!.gpu).not.toBeNull();
    expect(warmup.parts.get('stage:crowd')!()).toMatch(/\|gpu:4096$/); // 4 bodies: the smallest buffer
    expect([crowd.draw(1, camera()), crowd.crowd!.rigs.size > 0]).toEqual([4, true]);
    const many = bodies(Array.from({ length: 100 }, () => ({ rig: 'humanoid' as const })));
    crowd.capture(many, 1 / 60);
    const far = new PerspectiveCamera(60, 16 / 9, 0.1, 400);
    far.position.set(75, 60, 90);
    far.lookAt(75, 0, 0);
    far.updateMatrixWorld(true);
    expect(crowd.draw(1, far)).toBe(100); // over 4,096 instances: made at 8,192 and drawn again
    expect(warmup.parts.get('stage:crowd')!()).toMatch(/\|gpu:8192$/);
    expect(warmup.entries.has('stage:crowd')).toBe(true);
  });

  it('is how the stage draws a crowdBody entity, never as a stand-in, and forgets one that leaves', () => {
    const level = compileLevel('#####\n#...#\n#####\n');
    const stage = createStage({ level, materials: createMaterialLibrary(), registry });
    expect(stage.kinds).toContain('crowdBody');
    const row = bodies(ROW);
    stage.capture(row, 1 / 60);
    expect(stage.standIns.size).toBe(0);
    expect(stage.crowd.draw(1, camera())).toBe(4);
    stage.capture(row.slice(1), 1 / 60);
    expect(stage.crowd.draw(1, camera())).toBe(3);
    stage.dispose();
  });
});
