/**
 * @file The playground's page, as tests/e2e/playground-ui.spec.ts drives it: how long its scenes may warm up, the
 * `__engine` member a test calls, the screens open (`__playgroundUi.state()`), the HUD's lines, a menu's items and one
 * picked, a setting row's value and its slider set as a hand would, a scripted pad plugged in and its buttons tapped,
 * the player's entity, and the run's recording with its hash. Every read goes through `[data-ui]` elements, `__engine`
 * and `__playgroundUi`.
 */
import type { Page } from '@playwright/test';
import type { Replay } from '../../engine/sim/replay';

/** The page's engine and front end, inside `evaluate`. */
declare const __engine: Record<string, unknown> & { [name: string]: (...args: unknown[]) => unknown };
declare const __playgroundUi: {
  state(): { screens: string[]; paused: boolean };
  checks(): { id: string; verdict: string; note: string }[];
};

/** How long the gym's page and the site's may take to warm up (ms): playground.spec.ts's. */
export const [READY, SITE_READY] = [120_000, 420_000];

/** Calls the `__engine` member at `path` with `args`. */
export function call<T = unknown>(page: Page, path: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]) => {
      const fn = name.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], __engine);
      return (fn as (...a: unknown[]) => unknown)(...rest) as T;
    },
    [path, args] as const,
  );
}

/** The open screens, top last, and whether the run is paused by them. */
export const screens = (page: Page) => page.evaluate(() => __playgroundUi.state());

/** The HUD's lines that show, by id. */
export const hud = (page: Page): Promise<Record<string, string>> =>
  page.locator('[data-ui=hud]').evaluateAll((lines) => Object.fromEntries(lines.filter((line) => !(line as HTMLElement).hidden && line.textContent).map((line) => [line.getAttribute('data-id'), line.textContent]))); // prettier-ignore

/** Picks the item `id` of the open menu `menu` with a click, then runs a frame. */
export async function pick(
  page: Page,
  harness: { tick(n?: number): Promise<void> },
  menu: string,
  id: string,
): Promise<void> {
  await page.locator(`[data-ui=menu][data-id="${menu}"] [data-ui=item][data-id="${id}"]`).click();
  await harness.tick(2);
}

/** Presses `key` on the keyboard, then runs two frames, so the front end reads it at a frame as the page's loop does. */
export async function press(page: Page, harness: { tick(n?: number): Promise<void> }, key: string): Promise<void> {
  await page.keyboard.press(key);
  await harness.tick(2);
}

/** The standard mapping's buttons a test presses: the d-pad's down and right. */
export const PAD = { down: 13, right: 15 } as const;

/** Plugs a pad into slot 0 as the page opens (`page.addInitScript`): `window.__pad`, its buttons a test presses. */
export function plugPad(): void {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons }; // prettier-ignore
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
  (window as unknown as { __pad: typeof pad }).__pad = pad;
}

/** Presses the pad's `button` for two frames, then lets it go for two (see `plugPad`). */
export async function tapPad(page: Page, harness: { tick(n?: number): Promise<void> }, button: number): Promise<void> {
  const set = (down: boolean) =>
    page.evaluate(
      ([b, d]) => {
        const pad = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad;
        Object.assign(pad.buttons[b as number], { pressed: d, value: d ? 1 : 0 });
      },
      [button, down] as const,
    );
  await set(true);
  await harness.tick(2);
  await set(false);
  await harness.tick(2);
}

/** The labels of the open menu `menu`'s items, in order. */
export const menuLabels = (page: Page, menu: string): Promise<string[]> =>
  page.locator(`[data-ui=menu][data-id="${menu}"] [data-ui=item]`).allTextContents();

/** The owner's checks item, with `left` of them to do. */
export const checksItem = (left: number) => `Owner checks (${left} to do)…`;

/** A setting row's value as the screen shows it. */
export const shown = (page: Page, id: string) =>
  page.locator(`[data-ui=setting][data-id="${id}"]`).getAttribute('data-value');

/** Sets a slider of the settings screen, as a hand on it would. */
export async function slide(page: Page, id: string, value: number): Promise<void> {
  await page.locator(`[data-ui=setting][data-id="${id}"] input`).evaluate((input: HTMLInputElement, v) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input'));
  }, value);
}

/** The player's entity. */
export const player = (page: Page) =>
  call<{ actor: { x: number; y: number; z: number; vx: number; vz: number }; motion?: unknown }>(page, 'get', 1);

/** The run's recording and its hash, in the page. */
export const recording = (page: Page) =>
  page.evaluate(() => ({
    replay: (__engine.input as unknown as { record(): unknown }).record() as Replay,
    hash: __engine.hash() as unknown as string,
  }));
