/**
 * @file T2 for the playground's camera modes (PLAN.md WP 13.8, docs/PLAYGROUND.md §4), by `window.__engine` and keys:
 * 1. each mode renders the gym with the player in view: the ID pass sees him from the shooter, the platformer,
 *    isometric and top-down cameras; first person stands at the shooter model's eye height (1.52 m) and sees the gym;
 * 2. a live switch blends: T's first frame is the old camera's picture, each frame moves it on a little, and 0.35 s
 *    later it is the new camera's; X swaps the shooter's shoulder the same way; a plain `camera.set` cuts;
 * 3. no camera changes the hash: the rides replay keeps its goldens while the page blends through every mode;
 * 4. blending through every mode while the player runs builds 0 pipelines after the warm-up, raising no advice;
 * 5. the effects: a sprint lowers first person's eye 0.15 m, and stopping raises it again;
 * 5b. first person's arms (WP 13.12): the ID pass sees them and not the body, as many pixels of them standing at a
 *    wall as in the open (their lens draws them in front of it), and they move with the state (a sprint, a jump);
 * 6. the controls (WP 13.9): in each mode, live play through its own map (keys, the mouse turning the view under the
 *    pointer lock a click takes, or aiming as a free pointer) records the look and the aim the map's rule gives, and
 *    the recording replays in Node to the page's hash;
 * 7. the lot's cutaway by storey (WP 13.15): isometric and top-down hide, in the house's every room and in the shed,
 *    what stands above the player's storey and the roof (the ID pass: hidden, never seen), nothing in the yard; the
 *    player shows; the HUD names the room; visiting them all builds 0 pipelines after the warm-up.
 *
 * Invariants: the page is read through `__engine` only; the sim is stepped with `__engine.step` (or the keys on the
 * virtual clock's frames), then frames drawn with `__engine.render` (1/60 s each), so a blend's frames are counted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { getActionMap } from '../../engine/input/actionMaps';
import { playReplay, type Replay } from '../../engine/sim/replay';
import { playgroundMap } from '../../labs/playground/controls';
import '../../labs/playground/scenes/gym';
import { LOT, LOT_START } from '../../labs/playground/scenes/lot';
import { toWorld } from '../../engine/world/site';
import { PLAYGROUND_CAMERAS } from '../../labs/playground/views';
import { expect, test } from './fixtures';

/** The page's engine, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };

/** The rides replay. */
const RIDES = readFileSync(join(import.meta.dirname, '../replays/playground-rides.replay.json'), 'utf8');

/** A camera's pose, as `camera.get` gives it. */
type Pose = { position: [number, number, number]; yaw: number; pitch: number; projection: string; fov: number };

/** Calls the `__engine` member at `path` (`camera.get`) with `args`. */
function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** The camera now: its code and pose. */
const camera = (page: Page) => call<{ code: string; pose: Pose }>(page, 'camera.get');

/** The player's feet. */
async function feet(page: Page): Promise<[number, number, number]> {
  const { actor } = await call<{ actor: { x: number; y: number; z: number } }>(page, 'get', 1);
  return [actor.x, actor.y, actor.z];
}

const far = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

/**
 * The lot's places: each room of the house at its marker (the attic's under its ridge: its marker stands where the roof
 * leaves 1.4 m), the shed's floor, the yard; the storey and the HUD's line.
 */
const [HOUSE, SHED] = LOT.structures;
const marker = (room: { name: string; position: readonly number[] }) => (room.name === 'attic' ? [2.25, 3] : [room.position[0], room.position[2]]); // prettier-ignore
const PLACES = [
  ...HOUSE.level.rooms!.map((room) => ({ name: room.name, at: [...toWorld(HOUSE, marker(room)[0], marker(room)[1])], y: room.position[1], storey: room.storey, in: 'lot-house', hud: `Room: ${room.name}` })), // prettier-ignore
  { name: 'shed', at: toWorld(SHED, 1.5, 2), y: 0, storey: 0, in: 'lot-shed', hud: 'Indoors' },
  { name: 'yard', at: [LOT_START[0], LOT_START[2]], y: LOT_START[1], storey: -1, in: '', hud: 'Outdoors' },
];

/** Opens the playground at `query` and waits for it, paused. */
async function open(page: Page, harness: { ready(o: { timeout: number }): Promise<unknown> }, query = '') {
  await page.goto(`labs/playground/${query}`);
  await harness.ready({ timeout: 120_000 });
  await call(page, 'pause');
  await call(page, 'render', 2);
}

test.describe('the playground’s cameras', () => {
  test.setTimeout(600_000);

  test('render the gym with the player in view in every mode: first person at the eye height', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await harness.assertWebGPU();
    const at = await feet(page);
    for (const mode of PLAYGROUND_CAMERAS) {
      await call(page, 'camera.set', mode.code);
      await call(page, 'render', 3);
      type Ids = { ids: { visible: { name: string; px: number }[] } };
      const shot = await call<Ids>(page, 'shot', { ids: true, metrics: false, thumbnail: false });
      const player = shot.ids.visible.find((entry) => entry.name === 'actor#1')?.px ?? 0;
      if (mode.name === 'first') {
        expect((await camera(page)).pose.position[1] - at[1], 'the eye height').toBeCloseTo(1.524, 1);
        expect(shot.ids.visible.length, 'first person sees the gym').toBeGreaterThan(3);
      } else expect(player, mode.name).toBeGreaterThan(50);
    }
    expect(harness.advice()).toEqual([]);
  });

  test('blend a live switch over 0.35 s, the shoulder swap too, and cut a plain one', async ({ page, harness }) => {
    await open(page, harness);
    const from = (await camera(page)).pose;
    await page.keyboard.press('KeyT'); // shooter → first person, blended
    expect((await camera(page)).code.split(',')[0]).toBe('cam3=first');
    expect(far((await camera(page)).pose.position, from.position)).toBeLessThan(1e-6); // the first frame is the old one's
    const path = [from.position];
    for (let k = 0; k < 24; k++) {
      await call(page, 'render', 1);
      path.push((await camera(page)).pose.position);
    }
    const total = far(path[0], path.at(-1)!);
    const steps = path.slice(1).map((p, k) => far(p, path[k]));
    expect(total).toBeGreaterThan(3); // 3.8 m back over the shoulder to the eye
    expect(Math.max(...steps) / total, 'no frame takes a big share of the move').toBeLessThan(0.12);
    expect(far(path[22], path[24])).toBeLessThan(1e-3); // there by 0.35 s
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyT'); // round to the shooter again
    await call(page, 'render', 30);
    const right = (await camera(page)).pose.position;
    await page.keyboard.press('KeyX');
    expect((await camera(page)).code).toMatch(/^cam3=shoulder,.*,-1$/);
    await call(page, 'render', 1);
    const moved = far((await camera(page)).pose.position, right);
    await call(page, 'render', 30);
    const left = (await camera(page)).pose.position;
    expect(far(left, right)).toBeCloseTo(1, 1); // a metre across, the shoulder's ±0.5 m
    expect(moved).toBeLessThan(0.2); // eased
    await call(page, 'camera.set', 'cam=overhead');
    expect((await camera(page)).pose).toMatchObject({ projection: 'orthographic', pitch: expect.closeTo(-Math.PI / 2, 6) }); // prettier-ignore
    expect(harness.advice()).toEqual([]);
  });

  test('keep the rides replay’s goldens while blending through every mode', async ({ page, harness }) => {
    await open(page, harness);
    const views = PLAYGROUND_CAMERAS.map((mode, i) => [100 + i * 250, { cam: mode.code, blend: true }] as const);
    const run = await call<{ hashes: Record<string, string> }>(page, 'replay', RIDES, { views, draw: 5 });
    const goldens = (JSON.parse(RIDES) as { hashes: Record<string, Record<string, string>> }).hashes['linux-x64'];
    expect(run.hashes).toEqual(goldens);
    expect(harness.advice()).toEqual([]);
  });

  test('build 0 pipelines after the warm-up blending through every mode while the player runs', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    for (const _round of [1, 2]) {
      for (const _mode of PLAYGROUND_CAMERAS) {
        await page.keyboard.press('KeyT');
        for (let k = 0; k < 4; k++) {
          await call(page, 'step', 3, { move: [-0.6, 0.8], b: ['sprint'] });
          await call(page, 'render', 4);
        }
      }
    }
    expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0);
    const advice = await page.evaluate(() => (__engine.advice as unknown as { code: string }[]).map((a) => a.code));
    expect(advice).not.toContain('GFX_COLD_PIPELINE');
    expect(harness.advice()).toEqual([]);
  });

  test('lower first person’s eye 0.15 m in a sprint, and raise it again on a stop', async ({ page, harness }) => {
    await open(page, harness, '?cam3=first');
    const eye = async () => (await camera(page)).pose.position[1] - (await feet(page))[1];
    const standing = await eye();
    for (let k = 0; k < 40; k++) {
      await call(page, 'step', 1, { move: [-1, 0], look: [-Math.PI / 2, 0], cam: -Math.PI / 2, b: ['sprint'] });
      await call(page, 'render', 1);
    }
    expect(standing - (await eye())).toBeCloseTo(0.15, 1);
    for (let k = 0; k < 60; k++) {
      await call(page, 'step', 1, {});
      await call(page, 'render', 1);
    }
    expect(Math.abs((await eye()) - standing)).toBeLessThan(0.02);
    expect(harness.advice()).toEqual([]);
  });

  test('draw first person’s arms in the ID pass, whole at a wall, moving with the state', async ({ page, harness }) => {
    await open(page, harness, '?cam3=first');
    type Seen = { name: string; px: number; centre: [number, number] };
    const seen = async () => {
      await call(page, 'render', 2);
      const shot = await call<{ ids: { visible: Seen[] } }>(page, 'shot', { ids: true, metrics: false, thumbnail: false }); // prettier-ignore
      const find = (name: string) => shot.ids.visible.find((entry) => entry.name === name);
      return { arms: find('actor#1/arms'), body: find('actor#1') };
    };
    const south = { look: [Math.PI, 0], cam: Math.PI }; // the perimeter wall 2.75 m off the spawn
    await call(page, 'step', 30, south);
    const clear = await seen();
    expect(clear.body, 'the body hidden from first person').toBeUndefined();
    expect(clear.arms?.px ?? 0, 'the arms drawn').toBeGreaterThan(1000);
    for (let k = 0; k < 12; k++) await call(page, 'step', 10, { ...south, move: [0, -1] }); // into the wall (move is world [x, z])
    await call(page, 'step', 60, south); // stood still against it
    const wall = await seen(); // drawn: the camera stands where the frame put it
    expect((await camera(page)).pose.position[2], 'the eye at the wall').toBeLessThan(1);
    expect(wall.arms!.px / clear.arms!.px, 'as many pixels at the wall: drawn in front of it').toBeGreaterThan(0.9);
    const north = { look: [0, 0], cam: 0 };
    await call(page, 'step', 30, north);
    const still = (await seen()).arms!.centre;
    const heights: number[] = [];
    for (let k = 0; k < 8; k++) {
      await call(page, 'step', 4, { ...north, move: [0, 1], b: ['sprint'] });
      heights.push((await seen()).arms!.centre[1]);
    }
    expect(Math.max(...heights) - Math.min(...heights), 'the fists pump in a sprint').toBeGreaterThan(8);
    await call(page, 'step', 40, north);
    await call(page, 'step', 1, { ...north, b: ['jump'] });
    await call(page, 'step', 12, north);
    const jumped = (await seen()).arms!.centre;
    expect(still[1] - jumped[1], 'raised in the air').toBeGreaterThan(4); // picture rows run down
    expect(harness.advice()).toEqual([]);
  });

  for (const mode of PLAYGROUND_CAMERAS) {
    test(`play live in the ${mode.name} camera through its own map, and replay the recording in Node to its hash`, async ({
      page,
      harness,
    }) => {
      const [key, value] = mode.code.split('=');
      await open(page, harness, `?${key}=${value}`);
      const map = getActionMap(playgroundMap(mode.code));
      const box = (await page.locator('#view').boundingBox())!;
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(x, y);
      await call(page, 'resume');
      if (map.lock) {
        await page.mouse.click(x, y); // a click takes the pointer lock: the mouse turns the view
        await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
      }
      await page.keyboard.down('KeyW');
      await harness.tick(31); // the first frame sets the virtual clock's origin
      const before = (await camera(page)).pose.yaw;
      await page.mouse.move(x + 120, y - 40, { steps: 4 }); // under the lock it turns the view; free, it aims
      await harness.tick(30);
      const turned = Math.abs((await camera(page)).pose.yaw - before);
      await page.keyboard.down('ShiftLeft');
      await harness.tick(20);
      await page.keyboard.press('Space');
      await harness.tick(30);
      await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('KeyW');
      await harness.tick(10);
      await call(page, 'pause');
      const recorded = await page.evaluate(() => ({
        replay: (__engine.input as unknown as { record(): unknown }).record() as Replay,
        hash: __engine.hash() as unknown as string,
      }));
      const changes = recorded.replay.inputs.map(([, change]) => change as Record<string, unknown>);
      expect(
        changes.some((change) => Array.isArray(change.look)),
        'the view sent',
      ).toBe(map.look);
      expect(
        changes.some((change) => Array.isArray(change.aim)),
        'the aim sent',
      ).toBe(map.aimWith !== 'none');
      if (map.lock) expect(turned, 'the mouse turned the view').toBeGreaterThan(0.1);
      expect(playReplay(recorded.replay).hashes[String(recorded.replay.steps)]).toBe(recorded.hash);
      expect(harness.advice()).toEqual([]);
    });
  }
});

test.describe('the lot’s cutaway by storey (WP 13.15)', () => {
  test.setTimeout(600_000);

  test('hides what stands above the player’s storey and the roof indoors in the classic views, building nothing', async ({
    page,
    harness,
  }) => {
    await open(page, harness, '?scene=lot&cam=iso');
    const views = PLAYGROUND_CAMERAS.filter((mode) => mode.code.startsWith('cam='));
    const visit = async (place: (typeof PLACES)[number]) => {
      await call(page, 'actions.run', 'place', { at: [place.at[0], place.y, place.at[1]] });
      await call(page, 'step', 2, {});
      await call(page, 'render', 2);
    };
    for (const mode of views) {
      await call(page, 'camera.set', mode.code);
      for (const place of PLACES) await visit(place);
    }
    expect((await call<{ pipelinesAfterWarmUp: number }>(page, 'stats')).pipelinesAfterWarmUp).toBe(0); // before the ID pass's own
    type Ids = { ids: { visible: { name: string; px: number }[]; unseen: { name: string; reason: string }[] } };
    const shown: Record<string, number> = {};
    for (const mode of views) {
      await call(page, 'camera.set', mode.code);
      for (const place of PLACES) {
        await visit(place);
        const { ids } = await call<Ids>(page, 'shot', { ids: true, metrics: false, thumbnail: false });
        // The level's meshes (the cutaway's twins aside), and those the cut hides: `hidden` in the dump, by `visible`.
        // The ID pass's own `hidden` also counts a wall the cutaway cut down in front of the player (no instances left).
        const dump = (await call<string>(page, 'scene.dump', { filter: 'level:lot' })).split('\n').map((line) => line.trim().split(/\s+/)); // prettier-ignore
        const parts = dump.filter(([name, type]) => name.startsWith('level:') && !name.endsWith(':cut') && /Mesh$/.test(type)); // prettier-ignore
        const cut = parts.filter((line) => line[2] === 'hidden').map(([name]) => name);
        const seen = ids.visible.map((entry) => entry.name);
        const storey = (name: string) => (place.in === 'lot-house' ? HOUSE : SHED).level.storeys!.findIndex((s) => s.name === name.split('/')[1]); // prettier-ignore
        const above = (name: string) => name.startsWith(`level:${place.in}/`) && (name.endsWith('/roof') || storey(name) > place.storey); // prettier-ignore
        const at = `${mode.name}, ${place.name}`;
        const all = parts.map(([name]) => name);
        expect(
          cut.filter((name) => !above(name)),
          `${at}: hidden, not above`,
        ).toEqual([]);
        expect(
          all.filter((name) => above(name) && !cut.includes(name)),
          `${at}: above, not hidden`,
        ).toEqual([]);
        expect(seen.filter(above), `${at}: above, seen`).toEqual([]);
        expect(cut.length > 0, `${at}: anything hidden`).toBe(place.storey >= 0);
        shown[at] = ids.visible.find((entry) => entry.name === 'actor#1')?.px ?? 0;
        expect(await page.locator('[data-ui=hud][data-id=room]').textContent(), at).toBe(place.hud);
      }
    }
    expect(
      Object.entries(shown).filter(([, px]) => px === 0),
      'the player shows everywhere',
    ).toEqual([]);
    expect(harness.advice()).toEqual([]);
  });
});
