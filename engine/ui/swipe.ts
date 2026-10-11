/**
 * @file Swipe to dismiss (PLAN.md WP 3.12, ADR-0021: built, not tested): elements a page marks `data-swipe`
 * (notices, banners, cards) follow a finger and fade as they go. Let go past 72 px, or flicked 26 px within 0.3 s,
 * they fly off the way they went; otherwise they spring back. A dismissed element gets `data-swiped` (engine/ui/
 * touch.css hides it) and stays gone until its `data-swipe-key` changes, so new content shows again.
 *
 * Only fingers swipe (`pointerType` other than `mouse`); the touch device (engine/input/devices/touch.ts) leaves a
 * finger on a swipeable element alone, and a tap still reaches it as a click. Times come from the events' own
 * timestamps: this is presentation, and nothing here reaches the sim.
 *
 * Invariants: one element moves per finger, under pointer capture; `pointercancel` springs back and never dismisses.
 * No `@example` runs here: it would be a touch test, which the owner ruled out (ADR-0021).
 *
 * Carried from `shardfall:crates/pav_app/src/touch.rs:735-820` (`Swipes`: the offset and fade while held, the
 * distances, the flick, the fly-off, a key that brings new content back).
 *
 * @example
 * // <div class="notice" data-swipe data-swipe-key="quest-3">Quest updated</div>
 * // const swipes = attachSwipes(document);
 */

/** A swipe this far (CSS px) dismisses. */
export const SWIPE_DISTANCE = 72;
/** A flick this far (CSS px) … */
export const SWIPE_FLICK = 26;
/** … within this long (s) dismisses too. */
export const SWIPE_FLICK_TIME = 0.3;
/** A dismissed element flies this much further (CSS px) … */
export const SWIPE_FLY = 420;
/** … over this long (s). */
export const SWIPE_FLY_TIME = 0.22;
/** Held elements fade to nothing over this distance (CSS px), never below a quarter. */
const FADE = 240;

/** The fields of pointer events swiping reads. */
interface SwipeEvent extends Event {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
}

/** A swipeable element under a finger. */
interface Held {
  element: HTMLElement;
  x: number;
  y: number;
  t0: number;
}

/** Swiping on a page. */
export interface Swipes {
  /** Removes the listeners. */
  dispose(): void;
}

/** Lets fingers swipe away the `[data-swipe]` elements of `document` (see the file comment). */
export function attachSwipes(document: Document): Swipes {
  const held = new Map<number, Held>();
  const offset = (h: Held, e: SwipeEvent) => [e.clientX - h.x, e.clientY - h.y] as const;
  const show = (element: HTMLElement, dx: number, dy: number, opacity: number) => {
    element.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
    element.style.opacity = opacity < 1 ? String(opacity) : '';
  };
  const down = (event: Event) => {
    const e = event as SwipeEvent;
    const element = e.pointerType === 'mouse' ? null : (e.target as Element | null)?.closest?.('[data-swipe]');
    if (!(element instanceof HTMLElement) || element.dataset.swiped !== undefined) return;
    element.setPointerCapture?.(e.pointerId);
    element.style.transition = 'none';
    held.set(e.pointerId, { element, x: e.clientX, y: e.clientY, t0: e.timeStamp });
  };
  const move = (event: Event) => {
    const e = event as SwipeEvent;
    const h = held.get(e.pointerId);
    if (!h) return;
    const [dx, dy] = offset(h, e);
    show(h.element, dx, dy, Math.min(1, Math.max(0.25, 1 - Math.hypot(dx, dy) / FADE)));
  };
  const up = (event: Event) => {
    const e = event as SwipeEvent;
    const h = held.get(e.pointerId);
    if (!h) return;
    held.delete(e.pointerId);
    const [dx, dy] = offset(h, e);
    const far = Math.hypot(dx, dy);
    const quick = (e.timeStamp - h.t0) / 1000 < SWIPE_FLICK_TIME;
    const { element } = h;
    if (e.type === 'pointercancel' || !(far > SWIPE_DISTANCE || (quick && far > SWIPE_FLICK))) {
      element.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      return show(element, 0, 0, 1);
    }
    element.style.transition = `transform ${SWIPE_FLY_TIME}s ease-in, opacity ${SWIPE_FLY_TIME}s linear`;
    show(element, dx + (dx / far) * SWIPE_FLY, dy + (dy / far) * SWIPE_FLY, 0.001);
    setTimeout(() => {
      element.dataset.swiped = element.dataset.swipeKey ?? '';
      element.style.transition = 'none';
      show(element, 0, 0, 1);
    }, SWIPE_FLY_TIME * 1000);
  };
  const keyed = new MutationObserver((changes) => {
    for (const change of changes) {
      const element = change.target as HTMLElement;
      const gone = element.dataset.swiped;
      if (gone !== undefined && gone !== (element.dataset.swipeKey ?? '')) delete element.dataset.swiped;
    }
  });
  keyed.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-swipe-key'] });
  const listeners: [string, (event: Event) => void][] = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
  ];
  for (const [type, listener] of listeners) document.addEventListener(type, listener);
  return {
    dispose() {
      keyed.disconnect();
      for (const [type, listener] of listeners) document.removeEventListener(type, listener);
    },
  };
}
