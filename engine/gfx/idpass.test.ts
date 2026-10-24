/**
 * @file Unit tests for engine/gfx/idpass.ts in Node: the ID colours (distinct, never black), the drawables a scene
 * lists with their names, entities, protagonist and the reasons known before drawing (hidden, background, outside),
 * decoding a readback into visible and unseen objects (pixels, box, centre, stray, empty, the protagonist's pixels),
 * an instanced mesh's instances each in its own colour and counted (after G9), the marks, and drawing them. The GPU
 * half is proven by tests/e2e/shot.spec.ts.
 */
import { BoxGeometry, Group, InstancedMesh, Mesh, MeshBasicNodeMaterial, PerspectiveCamera, Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { drawMarks, marksOf } from './idmarks';
import { decodeIds, idColour, listDrawables, type IdTable } from './idpass';
import { STRAY } from './thumbnail';

/** A scene with one object for each case, seen by a camera at z = 5 looking down -Z. */
function fixture() {
  const scene = new Scene();
  const box = (name: string, z = 0) => {
    const mesh = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshBasicNodeMaterial());
    mesh.name = name;
    mesh.position.z = z;
    return mesh;
  };
  const hero = new Group();
  hero.name = 'hero';
  hero.userData = { protagonist: true, entity: 7 };
  hero.add(box('hero-body'), box(''));
  const hiddenGroup = new Group();
  hiddenGroup.visible = false;
  hiddenGroup.add(box('in-hidden-group'));
  const empty = new InstancedMesh(new BoxGeometry(), new MeshBasicNodeMaterial(), 4);
  empty.name = 'no-instances';
  empty.count = 0;
  const layered = box('other-layer');
  layered.layers.set(3);
  scene.add(box('floor'), hero, hiddenGroup, empty, layered, box('behind', 20));
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld();
  return { scene, camera, hero };
}

describe('idColour', () => {
  it('gives distinct, non-black colours that differ a lot between neighbours', () => {
    const colours = Array.from({ length: 50_000 }, (_, i) => idColour(i + 1));
    expect(new Set(colours).size).toBe(colours.length);
    expect(colours.every((colour) => colour > 0 && colour <= 0xffffff)).toBe(true);
    expect(idColour(1)).toBe(0x5bd1e9);
    expect(Math.abs((idColour(2) >> 16) - (idColour(1) >> 16))).toBeGreaterThan(32);
  });
});

describe('listDrawables', () => {
  it('lists every drawable with its name, entity, protagonist and what is known before drawing', () => {
    const { scene, camera, hero } = fixture();
    const { drawables, byColour } = listDrawables(scene, camera);
    const unnamed = hero.children[1];
    expect(drawables.map(({ name, reason }) => [name, reason])).toEqual([
      ['floor', null],
      ['hero-body', null],
      [`hero/Mesh#${unnamed.id}`, null],
      ['in-hidden-group', 'hidden'],
      ['no-instances', 'hidden'],
      ['other-layer', 'hidden'],
      ['behind', 'outside'],
    ]);
    expect(drawables[1]).toMatchObject({ entity: 7, protagonist: 'hero' });
    expect(drawables[0].entity).toBeUndefined();
    expect(drawables.map((d) => byColour.get(d.colour))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('leaves out what the frame draws behind everything (userData.background: the sky), as the scene background', () => {
    const { scene, camera } = fixture();
    const sky = new Group();
    sky.userData.background = true;
    const dome = new Mesh(new BoxGeometry(100, 100, 100), new MeshBasicNodeMaterial());
    dome.name = 'sky/dome';
    sky.add(dome);
    scene.add(sky);
    const { drawables } = listDrawables(scene, camera);
    expect(drawables.find((d) => d.name === 'sky/dome')?.reason).toBe('background');
    expect(drawables.find((d) => d.name === 'floor')?.reason).toBeNull();
  });

  it("leaves a look's outline shells out altogether (userData.outline): a shot's objects are the same in every look", () => {
    const { scene, camera } = fixture();
    const floor = scene.getObjectByName('floor')!;
    const shell = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    Object.assign(shell, { name: 'floor/outline', userData: { outline: true } });
    floor.add(shell);
    const names = listDrawables(scene, camera).drawables.map((d) => d.name);
    expect([names.includes('floor'), names.includes('floor/outline')]).toEqual([true, false]);
  });

  it('takes the protagonist by name when no object carries userData.protagonist', () => {
    const { scene, camera } = fixture();
    const { drawables } = listDrawables(scene, camera, { protagonist: 'floor' });
    expect(drawables[0].protagonist).toBe('floor');
  });
});

/** An RGBA readback of `width` × `height` painted with the table's colours: `paint(x, y)` gives a drawable index. */
function readback(
  table: IdTable,
  width: number,
  height: number,
  paint: (x: number, y: number) => number | 'stray' | null,
) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = paint(x, y);
      if (index === null) continue;
      const colour = index === 'stray' ? 0x010101 : table.drawables[index].colour;
      rgba.set([colour >> 16, (colour >> 8) & 255, colour & 255, 255], (y * width + x) * 4);
    }
  }
  return rgba;
}

describe('decodeIds', () => {
  it('reports every object: the visible largest first with box and centre, the others with their reason', () => {
    const { scene, camera, hero } = fixture();
    const table = listDrawables(scene, camera);
    // 10 × 4: the floor fills the bottom two rows, the hero's body a 2 × 2 block, one stray pixel; the rest empty.
    const rgba = readback(table, 10, 4, (x, y) =>
      y >= 2 ? 0 : x >= 3 && x <= 4 ? 1 : x === 9 && y === 0 ? 'stray' : null,
    );
    const { pass, pixels } = decodeIds(rgba, 10, 4, table);
    expect(pass).toMatchObject({ width: 10, height: 4, objects: 7, empty: 15, stray: 1 });
    expect(pass.visible).toEqual([
      { id: table.drawables[0].id, name: 'floor', px: 20, share: 0.5, bbox: [0, 2, 9, 3], centre: [4, 2] },
      {
        id: table.drawables[1].id,
        name: 'hero-body',
        px: 4,
        share: 0.1,
        bbox: [3, 0, 4, 1],
        centre: [3, 0],
        entity: 7,
        protagonist: true,
      },
    ]);
    expect(pass.unseen.map(({ name, reason }) => [name, reason])).toEqual([
      [`hero/Mesh#${hero.children[1].id}`, 'covered'],
      ['in-hidden-group', 'hidden'],
      ['no-instances', 'hidden'],
      ['other-layer', 'hidden'],
      ['behind', 'outside'],
    ]);
    expect(pass.protagonist).toEqual({ name: 'hero', px: 4 });
    // Per pixel: 1 the floor (largest), 2 the body, 0 empty space, STRAY unclaimed.
    expect([pixels[0], pixels[3], pixels[9], pixels[20]]).toEqual([0, 2, STRAY, 1]);
  });
});

describe('instances', () => {
  it('each take a colour of their own, the next object after them; their mesh sums their pixels and counts them', () => {
    const scene = new Scene();
    const crowd = new InstancedMesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicNodeMaterial(), 8);
    crowd.name = 'crowd/page0';
    crowd.count = 3;
    const floor = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    floor.name = 'floor';
    scene.add(crowd, floor);
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld();
    const table = listDrawables(scene, camera);
    expect(table.drawables.map(({ name, n, instances }) => [name, n, instances])).toEqual([
      ['crowd/page0', 1, 3],
      ['floor', 4, undefined],
    ]);
    expect([1, 2, 3, 4].map((n) => table.byColour.get(idColour(n)))).toEqual([0, 0, 0, 1]);
    expect([1, 2, 3].map((n) => table.instanceOf.get(idColour(n)))).toEqual([0, 1, 2]);
    // 4 × 1: instance 0, instance 2 twice, the floor
    const rgba = new Uint8Array(16);
    [idColour(1), idColour(3), idColour(3), idColour(4)].forEach((c, i) => rgba.set([c >> 16, (c >> 8) & 255, c & 255, 255], i * 4)); // prettier-ignore
    const { pass } = decodeIds(rgba, 4, 1, table);
    expect(pass.visible.map(({ name, px, instances }) => [name, px, instances])).toEqual([
      ['crowd/page0', 3, 2],
      ['floor', 1, undefined],
    ]);
  });
});

describe('marks', () => {
  it('numbers the visible objects, largest first, skipping specks', () => {
    const { scene, camera } = fixture();
    const table = listDrawables(scene, camera);
    const rgba = readback(table, 10, 4, (x, y) => (y >= 2 ? 0 : x === 3 && y === 0 ? 1 : null));
    const { pass } = decodeIds(rgba, 10, 4, table);
    expect(marksOf(pass)).toEqual([{ n: 1, id: table.drawables[0].id, name: 'floor', px: 20, at: [4, 2] }]);
    expect(marksOf(pass, { minPx: 1 }).map((mark) => mark.name)).toEqual(['floor', 'hero-body']);
    expect(marksOf(pass, { minPx: 1, max: 1 })).toHaveLength(1);
  });

  it('draws a ring and the number, clipped to the frame', () => {
    const [width, height] = [64, 48];
    const rgba = new Uint8Array(width * height * 4);
    drawMarks(rgba, width, height, [
      { n: 12, id: 1, name: 'a', px: 9, at: [32, 30] },
      { n: 3, id: 2, name: 'b', px: 9, at: [0, 0] },
    ]);
    const at = (x: number, y: number) => [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
    expect(at(32 + 6, 30), 'the ring').toEqual([255, 230, 120, 255]);
    expect(at(32, 30), 'the centre stays clear').toEqual([0, 0, 0, 0]);
    // "12" sits above the ring: its top-left pixel is the 1's middle column.
    const yellow = [];
    for (let y = 0; y < 18; y++) for (let x = 20; x < 44; x++) if (at(x, y)[0] === 255) yellow.push([x, y]);
    expect(yellow.length).toBeGreaterThan(20);
    // The mark at the corner is drawn below its ring, without throwing.
    expect(at(6, 0)).toEqual([255, 230, 120, 255]);
  });
});
