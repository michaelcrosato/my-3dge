/**
 * @file Unit tests for the air's gathering (engine/gfx/enhanced/air.ts): the first visible sun that casts gives the way
 * its light travels and its colour as radiance (intensity ÷ π), and its shadow map once it has one, the widest
 * cascade's when it casts through cascades, its shadow camera read as the display pass draws; ambient and hemisphere
 * lights add up to the sky; a sun that stops casting leaves the haze unlit; up to 64 visible lamps give their place,
 * reach and colour, where they are now even before the scene's matrices are brought up to date. The march itself is
 * tests/e2e/enhanced.spec.ts's.
 */
import { AmbientLight, DepthTexture, DirectionalLight, Group, HemisphereLight, Matrix4, PointLight, Scene } from 'three/webgpu'; // prettier-ignore
import { describe, expect, it } from 'vitest';
import { AIR, createAirLights, type AirLights } from './air';

/** The values in `v`, rounded to 6 places. */
const near = (v: { toArray(): number[] }) => v.toArray().map((x) => Math.round(x * 1e6) / 1e6);

/** Lamp `i`'s row 0 (position, reach) and row 1 (colour, 0). */
function lamp(air: AirLights, i: number): number[][] {
  const data = (air.lamps.value.image as { data: Float32Array }).data;
  return [i, AIR.lights + i].map((row) => [...data.subarray(row * 4, row * 4 + 4)].map((x) => Math.round(x * 1e5) / 1e5)); // prettier-ignore
}

/** Runs the shadow camera's read, as the display pass does each frame it draws. */
const draw = (air: AirLights) => (air.lightVp as unknown as { update(frame: object): void }).update({});

/** A sun that casts, from (0, 10, 10) toward the origin, π bright: its radiance is its colour. */
function sunlit() {
  const scene = new Scene();
  const sun = new DirectionalLight('#ff8040', Math.PI);
  sun.position.set(0, 10, 10);
  sun.castShadow = true;
  scene.add(sun, sun.target);
  return { scene, sun };
}

/** Gives `light`'s shadow a map, as its first shadow pass does, and moves its camera off the identity. */
function mapped(light: DirectionalLight) {
  const map = new DepthTexture(8, 8);
  Object.assign(light.shadow, { map: { depthTexture: map } });
  light.shadow.camera.position.set(1, 2, 3);
  light.shadow.camera.updateMatrixWorld();
  return map;
}

describe("the air's lights", () => {
  it('takes the first sun that casts: the way its light travels, its radiance, its map and camera once it has one', () => {
    const { scene, sun } = sunlit();
    const air = createAirLights();
    air.gather(scene);
    expect(near(air.sun.value)).toEqual([0, -0.707107, -0.707107, 0]); // no map yet: the shafts fall everywhere
    expect(near(air.sunColor.value)).toEqual(near({ toArray: () => [sun.color.r, sun.color.g, sun.color.b, 0] }));
    const map = mapped(sun);
    air.gather(scene);
    expect([air.sun.value.w, air.shadow.value]).toEqual([1, map]);
    draw(air);
    const expected = new Matrix4().multiplyMatrices(sun.shadow.camera.projectionMatrix, sun.shadow.camera.matrixWorldInverse); // prettier-ignore
    expect(air.lightVp.value.equals(expected)).toBe(true);
    sun.castShadow = false; // the tier casts none, say: the haze has no sun
    air.gather(scene);
    expect([near(air.sun.value), near(air.sunColor.value)]).toEqual([
      [0, -1, 0, 0],
      [0, 0, 0, 0],
    ]);
    air.dispose();
  });

  it('reads the widest cascade of a sun that casts through cascades', () => {
    const { scene, sun } = sunlit();
    const [inner, outer] = [new DirectionalLight(), new DirectionalLight()];
    const map = mapped(outer);
    mapped(inner);
    Object.assign(sun.shadow, { shadowNode: { lights: [{ shadow: inner.shadow }, { shadow: outer.shadow }] } });
    const air = createAirLights();
    air.gather(scene);
    expect([air.sun.value.w, air.shadow.value]).toEqual([1, map]);
    outer.shadow.camera.position.set(-5, 0, 2);
    outer.shadow.camera.updateMatrixWorld();
    draw(air);
    const expected = new Matrix4().multiplyMatrices(outer.shadow.camera.projectionMatrix, outer.shadow.camera.matrixWorldInverse); // prettier-ignore
    expect(air.lightVp.value.equals(expected)).toBe(true);
    air.dispose();
  });

  it('adds ambient and hemisphere lights into the sky, and points the sun down when none casts', () => {
    const scene = new Scene();
    const quiet = new DirectionalLight('#ffffff', 3); // casts no shadow: no sun for the air
    scene.add(new AmbientLight('#ffffff', Math.PI), new HemisphereLight('#ffffff', '#000000', Math.PI / 2), quiet);
    const air = createAirLights();
    air.gather(scene);
    expect(near(air.sky.value)).toEqual([1.5, 1.5, 1.5, 0]);
    expect(near(air.sun.value)).toEqual([0, -1, 0, 0]);
    air.dispose();
  });

  it('lists up to 64 visible lamps where they are now, with their reach and radiance', () => {
    const scene = new Scene();
    const carried = new Group();
    carried.position.set(10, 0, 0);
    const lantern = new PointLight('#ffffff', Math.PI, 8);
    lantern.position.set(1, 2, 3);
    carried.add(lantern);
    const hidden = new PointLight('#ffffff', 5);
    hidden.visible = false;
    const [dark, endless] = [new PointLight('#ffffff', 0), new PointLight('#ffffff', 2 * Math.PI, 0)];
    scene.add(carried, hidden, dark, endless);
    const air = createAirLights();
    air.gather(scene);
    expect(air.sunColor.value.w).toBe(2);
    expect(lamp(air, 0)).toEqual([[11, 2, 3, 8], [1, 1, 1, 0]]); // prettier-ignore
    expect(lamp(air, 1)).toEqual([[0, 0, 0, 20], [2, 2, 2, 0]]); // prettier-ignore
    carried.position.x = -4; // moved since the scene's matrices were last brought up to date
    air.gather(scene);
    expect(lamp(air, 0)[0]).toEqual([-3, 2, 3, 8]);
    for (let i = 0; i < 70; i++) scene.add(new PointLight('#ffffff', 1));
    air.gather(scene);
    expect(air.sunColor.value.w).toBe(AIR.lights);
    air.dispose();
  });
});
