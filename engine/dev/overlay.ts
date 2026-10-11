/**
 * @file The error overlay (PLAN.md §8.3's "ready or error", WP 2.7): what a page shows while it starts and when it
 * fails, as page text over the canvas, since whoever opens a deployed page sees the page, not its console
 * (shardfall:web/index.html:34-40, 62-65). `createOverlay(document)` uses the page's `#msg` element (labs/box/
 * index.html has one, showing "Loading…" before any script runs) or adds one; `status(text)` shows a line,
 * `error(record)` shows `CODE: message` and `Fix: …` and keeps the first error on screen (a later one is counted,
 * never hides it), `hide()` clears it once the page is up.
 *
 * Invariants: DOM only, no engine state: the records it shows are the log's (`__engine.errors`), so the overlay and
 * the inspector never disagree; it never takes pointer events, so the canvas below still gets them.
 *
 * @example
 * // const overlay = createOverlay(document);
 * // overlay.error({ code: 'GFX_NO_WEBGPU', message: 'this browser has no WebGPU', fix: 'use Chrome 113 or later' });
 * // overlay.text(); // 'GFX_NO_WEBGPU: this browser has no WebGPU\nFix: use Chrome 113 or later'
 * @see engine/dev/overlay.test.ts
 */

/** What the overlay shows for an error: a code, what happened, and the fix. */
export interface OverlayRecord {
  code: string;
  message: string;
  fix: string;
}

/** The page's message line over the canvas. */
export interface Overlay {
  /** Shows a status line (`Loading…`) unless an error is showing. */
  status(text: string): void;
  /** Shows an error; the first stays on screen, later ones are counted under it. */
  error(record: OverlayRecord): void;
  /** Hides the line unless an error is showing. */
  hide(): void;
  /** What the overlay shows now ('' when hidden). */
  text(): string;
}

/** The styles of an overlay the page did not provide: centred page text that lets pointer events through. */
const STYLE =
  'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;' +
  'font:18px system-ui,sans-serif;color:#c9ccd4;text-align:center;white-space:pre-line;pointer-events:none';

/** The overlay over `document`'s `#msg` element, made when the page has none. */
export function createOverlay(document: Document): Overlay {
  let element = document.querySelector<HTMLElement>('#msg');
  if (!element) {
    element = document.createElement('div');
    element.id = 'msg';
    element.setAttribute('role', 'status');
    element.setAttribute('style', STYLE);
    document.body.append(element);
  }
  const box = element;
  let first: OverlayRecord | null = null;
  let more = 0;
  const show = (text: string) => {
    box.textContent = text;
    box.hidden = text === '';
  };
  const errorText = () =>
    first
      ? `${first.code}: ${first.message}\nFix: ${first.fix}${more ? `\n(${more} more in __engine.errors)` : ''}`
      : '';
  return {
    status(text) {
      if (!first) show(text);
    },
    error(record) {
      if (first) more++;
      else first = { code: record.code, message: record.message, fix: record.fix };
      show(errorText());
    },
    hide() {
      if (!first) show('');
    },
    text: () => (box.hidden ? '' : (box.textContent ?? '')),
  };
}
