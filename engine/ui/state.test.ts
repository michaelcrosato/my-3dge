/**
 * @file Unit tests for engine/ui/state.ts (T1, PLAN.md WP 6.5), over a stand-in DOM (tests/unit/ui/fakeDom.ts): every
 * `[data-ui]` element under the root, in page order, with its kind, id, value, text and place; hidden when it or an
 * element up to the root is `hidden`, when the page does not render it, or when its box is empty or off the root;
 * boxes relative to the root where the page lays out, null where it does not; and the page's touch mode.
 * @see engine/ui/state.ts
 */
import { describe, expect, it } from 'vitest';
import { FakeDocument, type FakeElement } from '../../tests/unit/ui/fakeDom';
import { uiState } from './state';

/** A root with three marked elements (one inside an unmarked wrapper) and an unmarked one. */
function page() {
  const document = new FakeDocument();
  const root = document.createElement('div');
  root.style.width = '640px';
  root.style.height = '360px';
  const wrap = document.createElement('div');
  const label = Object.assign(document.createElement('div'), { textContent: 'Hero' });
  label.dataset.ui = 'label';
  label.dataset.id = 'hero';
  label.style.setProperty('--ui-x', '100.5');
  label.style.setProperty('--ui-y', '40');
  const number = Object.assign(document.createElement('div'), { textContent: '' });
  number.append(Object.assign(document.createElement('span'), { textContent: '12' }));
  number.dataset.ui = 'damage';
  number.dataset.value = '12';
  const line = Object.assign(document.createElement('div'), { textContent: 'Score 3' });
  line.dataset.ui = 'hud';
  wrap.append(label, number);
  root.append(wrap, document.createElement('div'), line);
  document.body.append(root);
  return { document, root, wrap, label, number, line };
}

/** `uiState` of a fake root. */
const read = (root: FakeElement) => uiState(root as unknown as HTMLElement);

describe('uiState', () => {
  it('lists the marked elements in page order, with what each carries', () => {
    const { root } = page();
    expect(read(root)).toEqual({
      size: [640, 360],
      touch: false,
      elements: [
        { kind: 'label', id: 'hero', text: 'Hero', at: [100.5, 40], box: null, visible: true },
        { kind: 'damage', value: '12', text: '12', box: null, visible: true },
        { kind: 'hud', text: 'Score 3', box: null, visible: true },
      ],
    });
  });

  it('hides what is hidden up to the root, and reads touch mode from the page', () => {
    const { document, root, wrap, line } = page();
    wrap.hidden = true;
    document.documentElement.classList.add('touch');
    const state = read(root);
    expect(state.elements.map((e) => e.visible)).toEqual([false, false, true]);
    expect(state.touch).toBe(true);
    root.hidden = true;
    expect(read(root).elements.map((e) => e.visible)).toEqual([false, false, false]);
    expect(line.hidden).toBe(false);
  });

  it('gives boxes relative to the root where the page lays out, and hides empty, unrendered or outside ones', () => {
    const { root, label, number, line } = page();
    const rect = (left: number, top: number, width: number, height: number) => () => ({ left, top, width, height });
    Object.assign(root, { getBoundingClientRect: rect(10, 20, 640, 360) });
    Object.assign(label, { getBoundingClientRect: rect(90.125, 50, 30, 18), checkVisibility: () => true });
    Object.assign(number, { getBoundingClientRect: rect(700, 50, 20, 20), checkVisibility: () => true });
    Object.assign(line, { getBoundingClientRect: rect(30, 30, 50, 16), checkVisibility: () => false });
    const state = read(root);
    expect(state.size).toEqual([640, 360]);
    expect(state.elements.map((e) => [e.kind, e.box, e.visible])).toEqual([
      ['label', [80.13, 30, 30, 18], true],
      ['damage', [690, 30, 20, 20], false], // off the root's right edge
      ['hud', [20, 10, 50, 16], false], // display: none, as the page renders it
    ]);
    Object.assign(label, { getBoundingClientRect: rect(90, 50, 0, 18) });
    expect(read(root).elements[0].visible).toBe(false); // empty
  });
});
