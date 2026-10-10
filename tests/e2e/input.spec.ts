/**
 * @file T2 for the input devices (PLAN.md WP 3.3, I-24) in the input page (tests/pages/input.html), with keyboard and
 * mouse events injected through Playwright and gamepads through a stubbed `navigator.getGamepads` holding scripted
 * pads: keys bind by physical code (AZERTY's Z is W) and walk away from the camera; a tap shorter than a frame presses;
 * bound keys never scroll the page and keys typed into a field stay there; the mouse clicks, wheels and looks under
 * pointer lock; a pad in slot 2 walks at its stick's strength past the deadzone, presses on its buttons, gives its
 * analog trigger and lets go when unplugged; blur and a hidden page let go of everything; a rebinding is refused when
 * reserved or taken, captured by `listen`, and kept across a reload; prompts follow the last device; and
 * `__engine.input` drives the page's own virtual device.
 *
 * Invariants: the page has no frame loop: each `frame()` is one sample, where the test puts it.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** What the input page publishes (tests/pages/input.ts). */
interface InputPage {
  frame(yaw?: number, pitch?: number): Record<string, unknown>;
  plug(script: string, index: number, id?: string): void;
  unplug(index: number): void;
  state(actions: string[]): {
    held: string[];
    pressed: string[];
    strength: Record<string, number>;
    lastDevice: string;
    prompts: Record<string, string>;
  };
  listen(device: 'keyboard' | 'gamepad'): void;
  heard: string | null | undefined;
  keys: [string, boolean][];
  input: {
    camera(): { look: [number, number]; turn: [number, number]; zoom: number };
    mouse: { locked: boolean; lock(): void };
    bindings: { rebind(action: string, code: string): { ok: boolean; reason?: string; action?: string } };
  };
  engine: { input: Record<string, (...args: unknown[]) => unknown> };
}

declare global {
  interface Window {
    __input: InputPage;
  }
}

/** One frame under a camera heading `yaw`. */
const frame = (page: Page, yaw?: number) => page.evaluate((y) => window.__input.frame(y), yaw);

/** Opens the input page, with fresh bindings unless `keep`. */
async function open(page: Page, harness: { ready(): Promise<void> }, keep = false) {
  await page.goto('tests/pages/input.html');
  if (!keep) await page.evaluate(() => localStorage.clear());
  await harness.ready();
}

test.describe('input devices', () => {
  test('keys bind by physical code and walk away from the camera; a tap shorter than a frame presses', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await page.keyboard.down('KeyW');
    const east = (await frame(page, Math.PI / 2)) as { move: number[]; cam: number };
    expect(east.move[0]).toBeCloseTo(1, 12);
    expect(east.move[1]).toBeCloseTo(0, 12);
    expect(east.cam).toBe(Math.PI / 2);
    expect(((await frame(page, 0)) as { move: number[] }).move).toEqual([0, 1]);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('Space'); // down and up before the frame
    expect(await frame(page)).toEqual({ p: ['jump'] });
    expect(await frame(page)).toEqual({});
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'z' })));
    expect(((await frame(page, 0)) as { move: number[] }).move).toEqual([0, 1]); // AZERTY's Z is the physical W
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'z' })));
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // Space is bound: the page never scrolled
    const keys = await page.evaluate(() => window.__input.keys);
    expect(keys).toContainEqual(['Space', true]);
  });

  test('keys typed into a field stay there', async ({ page, harness }) => {
    await open(page, harness);
    await page.locator('#name').click();
    await page.keyboard.type('wasd j');
    expect(await frame(page, 0)).toEqual({ cam: 0 });
    await expect(page.locator('#name')).toHaveValue('wasd j');
  });

  test('the mouse clicks, wheels and looks under pointer lock', async ({ page, harness }) => {
    await open(page, harness);
    const box = (await page.locator('#view').boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    expect(await frame(page)).toEqual({ b: ['attack'], p: ['attack'] });
    await page.mouse.up();
    await page.mouse.click(box.x + 100, box.y + 100, { button: 'right' });
    expect(await frame(page)).toEqual({ p: ['skill'] });
    await page.mouse.wheel(0, -200);
    await expect.poll(() => page.evaluate(() => window.__input.input.camera().zoom)).toBe(2);
    await page.mouse.click(box.x + 100, box.y + 100);
    await page.evaluate(() => window.__input.input.mouse.lock());
    await expect.poll(() => page.evaluate(() => window.__input.input.mouse.locked)).toBe(true);
    await page.evaluate(() => window.__input.input.camera()); // drop what the clicks gathered
    await page.mouse.move(box.x + 140, box.y + 80);
    const { look } = await page.evaluate(() => window.__input.input.camera());
    expect(look[0]).toBeGreaterThan(0); // right
    expect(look[1]).toBeGreaterThan(0); // up: the mouse went up the screen
    expect(look[0] / look[1]).toBeCloseTo(40 / 20, 6);
  });

  test('a pad in slot 2 walks past its deadzone, presses, gives its trigger and lets go when unplugged', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await page.evaluate(() =>
      window.__input.plug('1 left=0.1,-0.1\n1 left=0,-0.6\n1 hold=A rt=0.3\n1 hold=A rt=0.8\n9 hold=A', 2),
    );
    expect(await frame(page, 0)).toEqual({ cam: 0 }); // inside the radial deadzone
    const half = (await frame(page, 0)) as { move: number[] };
    expect(half.move[1]).toBeCloseTo(0.42 / 0.82, 12); // rescaled past the deadzone: it walks at half speed
    expect(await frame(page)).toEqual({ b: ['jump'], p: ['jump'] });
    const actions = ['jump', 'attack'];
    expect((await page.evaluate((a) => window.__input.state(a), actions)).strength).toEqual({ jump: 1, attack: 0.3 });
    expect(await frame(page)).toEqual({ b: ['attack', 'jump'], p: ['attack'] });
    const state = await page.evaluate((a) => window.__input.state(a), actions);
    expect([state.lastDevice, state.prompts]).toEqual(['gamepad', { jump: 'A', attack: 'X' }]);
    await page.evaluate(() => window.__input.unplug(2));
    expect(await frame(page)).toEqual({});
  });

  test('blur and a hidden page let go of everything', async ({ page, harness }) => {
    await open(page, harness);
    await page.keyboard.down('KeyJ');
    await page.keyboard.down('KeyD');
    expect(Object.keys(await frame(page, 0))).toEqual(['move', 'cam', 'b', 'p']);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(await frame(page)).toEqual({});
    await page.keyboard.up('KeyJ');
    await page.keyboard.down('KeyJ');
    expect(await frame(page)).toEqual({ b: ['attack'], p: ['attack'] });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await frame(page)).toEqual({});
  });

  test('rebinding refuses reserved and taken codes, listens for a key, and survives a reload', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    const rebind = (action: string, code: string) =>
      page.evaluate(([a, c]) => window.__input.input.bindings.rebind(a, c), [action, code]);
    expect(await rebind('jump', 'Escape')).toMatchObject({ ok: false, reason: 'reserved' });
    expect(await rebind('jump', 'KeyW')).toMatchObject({ ok: false, reason: 'conflict', action: 'forward' });
    await page.evaluate(() => window.__input.listen('keyboard'));
    await page.keyboard.press('KeyG');
    await expect.poll(() => page.evaluate(() => window.__input.heard)).toBe('KeyG');
    expect(await frame(page)).toEqual({}); // the key that was heard pressed nothing
    expect(await rebind('jump', 'KeyG')).toMatchObject({ ok: true });
    await open(page, harness, true);
    await page.keyboard.press('KeyG');
    expect(await frame(page)).toEqual({ p: ['jump'] });
    await page.keyboard.press('Space');
    expect(await frame(page)).toEqual({}); // Space is no longer jump…
    expect((await page.evaluate(() => window.__input.state(['uiAccept']))).pressed).toEqual(['uiAccept']); // …but still accepts in menus
  });

  test('prompts follow the device used last', async ({ page, harness }) => {
    await open(page, harness);
    const prompts = async () => (await page.evaluate(() => window.__input.state(['attack', 'pause']))).prompts;
    await page.keyboard.press('KeyK');
    await frame(page);
    expect(await prompts()).toEqual({ attack: 'J', pause: 'Esc' });
    const box = (await page.locator('#view').boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + 10);
    expect(await prompts()).toEqual({ attack: 'LMB', pause: 'Esc' });
    await page.evaluate(() => window.__input.plug('1 tap=B', 0, 'DualSense Wireless Controller (Vendor: 054c)'));
    await frame(page);
    expect(await prompts()).toEqual({ attack: 'Square', pause: 'Options' });
  });

  test('__engine.input drives the page’s virtual device', async ({ page, harness }) => {
    await open(page, harness);
    await page.evaluate(() => {
      const input = window.__input.engine.input;
      input.press('jump');
      input.axis('move', [0, 1]);
    });
    expect(await frame(page, Math.PI)).toMatchObject({ cam: Math.PI, p: ['jump'] });
    const later = (await frame(page, 0)) as { move: number[]; p?: string[] };
    expect([later.move, later.p]).toEqual([[0, 1], undefined]);
    expect((await page.evaluate(() => window.__input.state([]))).lastDevice).toBe('virtual');
  });
});
