/**
 * @file Unit tests for engine/dev/overlay.ts (T1, PLAN.md §8.3, WP 2.7): the overlay uses the page's `#msg` or adds
 * one; a status shows until hidden; the first error stays on screen with its fix, later ones are counted, and nothing
 * hides an error.
 * @see engine/dev/overlay.ts
 */
import { describe, expect, it } from 'vitest';
import { createOverlay } from './overlay';

/** A stand-in for the few DOM calls the overlay makes. */
function fakeDocument(withMessage: boolean) {
  type Element = { id: string; hidden: boolean; textContent: string; setAttribute(name: string, value: string): void };
  const make = (): Element => ({ id: '', hidden: false, textContent: '', setAttribute: () => {} });
  let element: Element | null = withMessage ? make() : null;
  const added: Element[] = [];
  const document = {
    querySelector: () => element,
    createElement: make,
    body: { append: (child: Element) => void added.push((element = child)) },
  };
  return { document: document as unknown as Document, added, element: () => element! };
}

describe('createOverlay', () => {
  it('shows a status until hidden, and keeps the first error with its fix', () => {
    const page = fakeDocument(true);
    const overlay = createOverlay(page.document);
    overlay.status('Loading…');
    expect(overlay.text()).toBe('Loading…');
    overlay.hide();
    expect([overlay.text(), page.element().hidden]).toEqual(['', true]);
    overlay.error({ code: 'GFX_NO_WEBGPU', message: 'no WebGPU', fix: 'use Chrome' });
    overlay.error({ code: 'APP_FRAME', message: 'later', fix: 'reload' });
    overlay.hide();
    overlay.status('Loading…');
    expect(overlay.text()).toBe('GFX_NO_WEBGPU: no WebGPU\nFix: use Chrome\n(1 more in __engine.errors)');
  });

  it('adds a #msg element when the page has none', () => {
    const page = fakeDocument(false);
    createOverlay(page.document).status('Loading…');
    expect(page.added.map((element) => [element.id, element.textContent])).toEqual([['msg', 'Loading…']]);
  });
});
