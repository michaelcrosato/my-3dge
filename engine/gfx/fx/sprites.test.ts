/**
 * @file Unit tests for sprites (engine/gfx/fx/sprites.ts), in Node: a particle faces the camera at its size; a
 * streak lies along its velocity as the camera sees it, `size + speed × 0.03` long and `0.45 × size` wide; the
 * colour is premultiplied by the opacity and `fxAlpha` is the opacity that covers (0 for light that adds); every
 * page exists from the start; sprites past the capacity are counted.
 * @see engine/gfx/fx/sprites.ts
 */
import { Matrix4, PerspectiveCamera, Vector3, type InstancedBufferAttribute } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { Rng } from '../../core/rng';
import type { ParticleSpec } from './emitters';
import { ParticlePool } from './particles';
import { createSprites, type Sprites } from './sprites';

/** A camera at (0, 2, 5) looking at the origin. */
function camera(): PerspectiveCamera {
  const view = new PerspectiveCamera();
  view.position.set(0, 2, 5);
  view.lookAt(0, 0, 0);
  view.updateMatrixWorld();
  return view;
}

/** A still particle spec of `size`, linear colour `c0` at birth. */
const spec = (fields: Partial<ParticleSpec>): ParticleSpec => ({
  ...{ area: [0, 0, 0], velocity: [0, 0, 0], spread: 0, gravity: 0, drag: 0, turbulence: 0, life: [1, 1] },
  ...{ size: [0.2, 0.2], c0: [2, 1, 0.5, 0.5], c1: [2, 1, 0.5, 0.5], additive: false, stretch: false, lands: false },
  ...{ floor: 0, bounce: 0, prewarm: 0 },
  ...fields,
});

/** Slot `slot`'s matrix columns, colour and covering opacity. */
function slotOf(sprites: Sprites, slot: number) {
  const page = sprites.batch.pages[0];
  const m = sprites.batch.getMatrixAt(slot, new Matrix4());
  const [x, y] = [new Vector3(), new Vector3()];
  m.extractBasis(x, y, new Vector3());
  const colour = Array.from(page.instanceColor!.array.slice(slot * 3, slot * 3 + 3));
  const alpha = (page.geometry.getAttribute('fxAlpha') as InstancedBufferAttribute).array[slot];
  return { x, y, centre: new Vector3().setFromMatrixPosition(m), colour, alpha };
}

describe('sprites', () => {
  it('face the camera at the particle’s size, premultiplied, covering by its opacity', () => {
    const view = camera();
    const sprites = createSprites({ capacity: 2048 });
    const pool = new ParticlePool(4);
    pool.burst(spec({}), 1, [0, 1, 0], new Rng(1));
    pool.burst(spec({ additive: true }), 1, [1, 1, 0], new Rng(1));
    sprites.begin(view);
    sprites.particles(pool);
    sprites.end();
    const [covering, adding] = [slotOf(sprites, 0), slotOf(sprites, 1)];
    const right = new Vector3().setFromMatrixColumn(view.matrixWorld, 0);
    expect(covering.x.clone().normalize().dot(right)).toBeCloseTo(1, 6);
    expect([covering.x.length(), covering.y.length()].map((v) => +v.toFixed(6))).toEqual([0.2, 0.2]);
    expect(covering.colour).toEqual([1, 0.5, 0.25]); // 2, 1, 0.5 at 0.5
    expect([covering.alpha, adding.alpha]).toEqual([0.5, 0]);
    expect(sprites.batch.pages).toHaveLength(2);
  });

  it('streak along the velocity as the camera sees it', () => {
    const view = camera();
    const sprites = createSprites({ capacity: 1024 });
    const pool = new ParticlePool(1);
    pool.burst(spec({ velocity: [10, 0, 0], stretch: true }), 1, [0, 1, 0], new Rng(1));
    sprites.begin(view);
    sprites.particles(pool);
    sprites.end();
    const { x, y } = slotOf(sprites, 0);
    expect(x.length()).toBeCloseTo(0.2 + 10 * 0.03, 6);
    expect(y.length()).toBeCloseTo(0.2 * 0.45, 6);
    expect(x.clone().normalize().x).toBeCloseTo(1, 6); // east: across the camera
  });

  it('count the sprites past the capacity', () => {
    const sprites = createSprites({ capacity: 1024 });
    sprites.begin(camera());
    for (let i = 0; i < 1030; i++) sprites.glow(i, 0, 0, 0.1, [1, 1, 1]);
    sprites.end();
    expect([sprites.batch.count, sprites.skipped, sprites.batch.drawCalls()]).toEqual([1024, 6, 1]);
  });
});
