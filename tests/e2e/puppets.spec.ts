/**
 * @file T2 for puppets (PLAN.md WP 3.8, Done-when 3, and the instanced crowd) on the puppets page
 * (tests/pages/puppets.html). The neutral humanoid, one rigid-skinned puppet in a turned, posed stance, draws in 10
 * draw calls or fewer with one shadow map (the renderer's count, beyond the empty scene's), covers where FK puts its
 * sockets and leaf joints on the screen, and its bones hold FK's sockets. Its sockets are drawn where FK puts them
 * within 1 mm: a white mark on each socket (fixtures/bodies/socketMarks.ts), shot from the front and the side at
 * 0.25 mm per pixel around FK's socket, has its centre within 1 mm of the shot's centre, and its area says nothing
 * else fell in the shot. A crowd of instanced humanoids with blob shadows costs the draw calls the batches count, one
 * per shown page, and growing it from 16 to 100 bodies (more pages) builds no pipeline. The fixture body
 * (fixtures/bodies/everyPart.ts), one part of every type, draws as a rigid-skinned puppet and two instanced ones: a
 * batch per unit shape (ball, blade, box, cone, eye, strip and limbs of several tapers), each seen by the ID pass,
 * for the draw calls counted and no pipeline built after the warm-up.
 *
 * Invariants: frames are drawn by calling the page; draw calls are the renderer's (`renderer.info`), pipelines the
 * device's (engine/gfx/pipelines.ts); no advice is raised.
 */
import type { Page } from '@playwright/test';
import type { CrowdShown, EveryPartShown, HumanoidShown, SocketShot } from '../pages/puppets';
import { expect, test } from './fixtures';

/** What the page publishes as `window.__puppetsPage` (tests/pages/puppets.ts), as far as this suite uses it. */
interface PuppetsPage {
  humanoid(): Promise<HumanoidShown>;
  sockets(side: 'front' | 'side'): Promise<SocketShot[]>;
  crowd(n: number): Promise<CrowdShown>;
  everyPart(): Promise<EveryPartShown>;
}
type PuppetsWindow = { __puppetsPage: PuppetsPage };

const PAGE = 'tests/pages/puppets.html';

/** Calls `name` on the page with `arg`. */
const call = <K extends keyof PuppetsPage>(page: Page, name: K, arg?: Parameters<PuppetsPage[K]>[0]) =>
  page.evaluate(
    ([name, arg]) => ((window as unknown as PuppetsWindow).__puppetsPage[name] as (a: unknown) => unknown)(arg),
    [name, arg] as const,
  ) as ReturnType<PuppetsPage[K]>;

test('the humanoid draws in 10 draw calls or fewer, and covers where FK puts its sockets', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  const shown = await call(page, 'humanoid');
  expect(shown.frame).toMatchObject({ drawn: true, built: 0 });
  expect(shown.pipelinesAfterWarmUp).toBe(0);
  expect(shown.drawCalls - shown.empty, "the renderer's count, beyond the empty scene's").toBe(shown.counted);
  expect(shown.counted, 'lit and glow groups, again in the shadow map').toBe(4);
  expect(shown.counted).toBeLessThanOrEqual(10);

  const [body, ...others] = shown.seen;
  expect(others).toEqual([]);
  expect(body.name).toBe('puppet:body:humanoid');
  expect(body.px).toBeGreaterThan(5000);
  const [x0, y0, x1, y1] = body.bbox;
  for (const { name, at } of shown.projected) {
    expect(at[0], `${name} x`).toBeGreaterThan(x0 - 1);
    expect(at[0], `${name} x`).toBeLessThan(x1 + 1);
    expect(at[1], `${name} y`).toBeGreaterThan(y0 - 1);
    expect(at[1], `${name} y`).toBeLessThan(y1 + 1);
  }
  expect(shown.boneError, "the bones' sockets against FK's (m)").toBeLessThan(1e-6);
});

test("the humanoid's sockets are drawn where FK puts them, within 1 mm, from the front and the side", async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();

  for (const side of ['front', 'side'] as const) {
    const shots = await call(page, 'sockets', side);
    expect(shots.map((s) => s.socket)).toEqual([
      'weaponR',
      'weaponL',
      'headTop',
      'eyeL',
      'eyeR',
      'contactL',
      'contactR',
      'back',
    ]);
    for (const { socket, error, area, disc } of shots) {
      expect(area / disc, `${side} ${socket}: the mark alone, whole, in its shot`).toBeGreaterThan(0.85);
      expect(area / disc, `${side} ${socket}: the mark alone, whole, in its shot`).toBeLessThan(1.02);
      expect(error, `${side} ${socket}: drawn this far from FK (m)`).toBeLessThan(0.001);
    }
    test.info().annotations.push({
      type: `worst socket error, ${side} (mm)`,
      description: (Math.max(...shots.map((s) => s.error)) * 1000).toFixed(4),
    });
  }
});

test('a crowd of instanced humanoids costs a draw call per shown page, and growing it builds no pipeline', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();

  const small = await call(page, 'crowd', 16);
  expect(small.frame).toMatchObject({ drawn: true, built: 0 });
  expect(small.pipelinesAfterWarmUp).toBe(0);
  expect(small.drawCalls - small.empty).toBe(small.counted);
  expect(small.instances).toBe(16 * 62);
  expect(small.seen).toEqual(expect.arrayContaining(['crowd/ball/page0', 'crowd/eye/page0', 'crowd/shadows/page0']));

  const large = await call(page, 'crowd', 100);
  expect(large.instances).toBe(100 * 62);
  expect(large.frame.built, 'the pages added while playing build nothing (the shot before built its own)').toBe(0);
  expect(large.pages.ball, '4,200 balls on 1,024-slot pages').toBe(5);
  expect(large.drawCalls - large.empty).toBe(large.counted);
  expect(large.counted - small.counted, 'only the added pages cost more').toBeGreaterThan(0);
  expect(harness.advice()).toEqual([]);
});

test('the fixture body draws every shape, rigid-skinned and instanced, and builds no pipeline', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();

  const shown = await call(page, 'everyPart');
  expect(shown.frame).toMatchObject({ drawn: true, built: 0 });
  expect(shown.pipelinesAfterWarmUp).toBe(0);
  expect(shown.drawCalls - shown.empty, "the renderer's count, beyond the empty scene's").toBe(shown.counted);
  const shapes = shown.shapes.filter((key) => !key.startsWith('limb@')).sort();
  expect(shapes, 'a batch for every unit shape but the limb').toEqual(['ball', 'blade', 'box', 'cone', 'eye', 'strip']);
  expect(shown.shapes.length - shapes.length, 'limbs of more than one taper').toBeGreaterThan(1);
  const px = new Map(shown.seen.map(({ name, px }) => [name, px]));
  const pages = shown.shapes.map((key) => `parts/${key}/page0`);
  expect([...px.keys()].sort(), "each shape's page drawn and in view, and nothing else").toEqual(
    ['puppet:body:everyPart', ...pages].sort(),
  );
  expect(px.get('puppet:body:everyPart'), 'the rigid-skinned puppet, whole').toBeGreaterThan(4000);
  expect(harness.advice()).toEqual([]);
});
