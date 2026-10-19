/**
 * @file T2 for the UI widgets (PLAN.md WP 10.6, I-50) in the UI page (tests/pages/ui.html): DOM queries find every
 * widget with its text and a box inside the overlay, and `ui.state()` reads them laid out and visible; the keyboard
 * moves the menu past its disabled item and picks, the pick sent as input the replay holds (the scene's dev action);
 * the dialog types, Enter shows the rest and turns the page, and a mouse click picks a choice; a gamepad drives the
 * menu with its D-pad and the settings panel through its cursor, whose accept clicks the button under it.
 *
 * Invariants: the page runs only when a test calls `__ui.frame`; keys and clicks are real browser events.
 */
import type { Page } from '@playwright/test';
import type { UiState } from '../../engine/ui/state';
import { expect, test } from './fixtures';

/** What the UI page publishes (tests/pages/ui.ts), as far as the tests use it. */
interface UiPage {
  ui: { state(): UiState };
  dialog: { open: boolean; page: number; typing: boolean };
  menu: { index: number; active: boolean };
  cursor: { at: readonly [number, number] | null };
  cues: string[];
  sent: string[];
  picks: number[];
  choices: number[];
  say(text: string | string[], options?: { name?: string; choices?: string[] }): void;
  panel(open: boolean): void;
  frame(dt?: number): string | null;
  plug(script: string, index?: number): void;
}

declare global {
  interface Window {
    __ui: UiPage;
  }
}

/** Opens the UI page and waits until it is up. */
async function open(page: Page, harness: { ready(): Promise<void> }) {
  await page.goto('tests/pages/ui.html');
  await harness.ready();
}

/** Runs `n` frames of `dt` s in the page; returns what the pad's cursor clicked last. */
const frames = (page: Page, n = 1, dt = 1 / 60) =>
  page.evaluate(
    ([count, step]) => {
      let clicked: string | null = null;
      for (let i = 0; i < count; i++) clicked = window.__ui.frame(step) ?? clicked;
      return clicked;
    },
    [n, dt] as const,
  );

test.describe('the UI widgets', () => {
  test('DOM queries find every widget with its text and a box inside the overlay', async ({ page, harness }) => {
    await open(page, harness);
    await page.evaluate(() => window.__ui.say('Hello, traveler!', { name: 'GUIDE' }));
    await frames(page, 1, 0.1);
    const found = await page.evaluate(() => {
      const root = document.querySelector('.ui-overlay')!.getBoundingClientRect();
      const widgets = Array.from(document.querySelectorAll<HTMLElement>('[data-ui]'), (el) => {
        const r = el.getBoundingClientRect();
        const inside = r.width > 0 && r.height > 0 && r.left >= root.left && r.right <= root.right && r.top >= root.top && r.bottom <= root.bottom; // prettier-ignore
        return { kind: el.dataset.ui, id: el.dataset.id, text: el.textContent, inside };
      });
      return { widgets, state: window.__ui.ui.state() };
    });
    const text = (kind: string, id?: string) => found.widgets.find((w) => w.kind === kind && (id === undefined || w.id === id))?.text; // prettier-ignore
    expect([text('bar', 'hp'), text('hearts', 'life'), text('box', 'quest')]).toEqual(['HP 30/40', '♥♥♥', 'QuestFind the key']); // prettier-ignore
    expect([text('dialog-name'), text('dialog-text'), text('menu-title')]).toEqual(['GUIDE', 'Hello', 'Paused']);
    expect(found.widgets.filter((w) => w.kind === 'item').map((w) => w.text)).toEqual(['Resume', 'Load', 'Pick', 'Quit']); // prettier-ignore
    expect(found.widgets.filter((w) => !w.inside).map((w) => w.kind)).toEqual(['cursor']); // hidden until a pad moves it
    const shown = found.state.elements.filter((e) => e.kind !== 'cursor');
    expect(shown.every((e) => e.visible && e.box !== null && e.box[2] > 0)).toBe(true);
    const bar = found.state.elements.find((e) => e.kind === 'bar')!;
    expect([bar.value, bar.box![0] < 100, bar.box![1] < 60]).toEqual(['0.75', true, true]); // in the top-left place
  });

  test('the keyboard moves the menu past its disabled item and picks, sent as input the replay holds', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await page.keyboard.press('ArrowDown');
    await frames(page);
    expect(await page.evaluate(() => window.__ui.menu.index)).toBe(2); // past Load
    await page.keyboard.press('Enter');
    await frames(page, 2);
    const result = await page.evaluate(() => ({
      sent: window.__ui.sent,
      picks: window.__ui.picks,
      cues: window.__ui.cues,
      inputs: (window as unknown as { __engine: { input: { record(): { inputs: unknown[] } } } }).__engine.input.record().inputs, // prettier-ignore
    }));
    expect([result.sent, result.picks, result.cues]).toEqual([['pick'], [2], ['move', 'pick']]);
    expect(result.inputs).toEqual([[1, { dev: 'pick', args: { from: 'menu' } }]]); // picked on the second frame, after step 1
  });

  test('the dialog types, Enter shows the rest and turns the page, and a click picks a choice', async ({
    page,
    harness,
  }) => {
    await open(page, harness);
    await page.evaluate(() => window.__ui.say(['Hello there!', 'Pick one'], { choices: ['YES', 'NO'] }));
    await frames(page, 1, 0.1);
    const shown = () => page.locator('[data-ui=dialog-text]').textContent();
    expect(await shown()).toBe('Hello');
    await page.keyboard.press('Enter');
    await frames(page);
    expect(await shown()).toBe('Hello there!');
    await page.keyboard.press('Enter');
    await frames(page, 30);
    expect(await page.locator('[data-ui=dialog]').getAttribute('data-value')).toBe('asking');
    await page.locator('[data-ui=choice]', { hasText: 'NO' }).click();
    expect(await page.evaluate(() => [window.__ui.choices, window.__ui.dialog.open])).toEqual([[1], false]);
    expect(await page.evaluate(() => window.__ui.menu.index)).toBe(0); // the dialog held the menu's input
  });

  test('a gamepad drives the menu with its D-pad and the panel through its cursor', async ({ page, harness }) => {
    await open(page, harness);
    await page.evaluate(() => window.__ui.plug('1 tap=DPadDown\n1\n1 tap=South\n1'));
    await frames(page, 4);
    expect(await page.evaluate(() => [window.__ui.menu.index, window.__ui.sent])).toEqual([2, ['pick']]);
    await page.evaluate(() => {
      window.__ui.menu.active = false;
      window.__ui.panel(true);
      window.__ui.plug('8 left=1,0\n1 tap=South\n1');
    });
    const clicked = await frames(page, 10);
    const after = await page.evaluate(() => ({
      at: window.__ui.cursor.at,
      pressed: document.querySelector('#panel-button')!.hasAttribute('data-pressed'),
    }));
    expect(after.at![0]).toBeGreaterThan(450); // right of the centre, onto the button
    expect([clicked, after.pressed]).toEqual(['panel-button', true]);
  });
});
