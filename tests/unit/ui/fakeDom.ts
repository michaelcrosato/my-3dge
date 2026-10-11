/**
 * @file A stand-in for the few DOM calls the overlay makes (engine/ui/{overlay,labels,state}.ts), for their unit
 * tests in Node (T1), where there is no page: elements with attributes, `dataset`, `hidden`, `style` (properties and
 * custom properties), classes, text and children; `querySelector(All)` for class, attribute and descendant
 * selectors; and a canvas whose client rect a test sets. Nothing lays the page out, so only the canvas has a
 * `getBoundingClientRect`, and `ui.state()` gives null boxes (the browser half is tests/e2e/overlay.spec.ts).
 *
 * Invariants: it models only what those modules use; anything else is missing, so a new DOM call fails loudly.
 *
 * @example
 * const { document, canvas } = fakePage({ left: 10, top: 20, width: 640, height: 360 });
 * document.body.append(canvas);
 * canvas.getBoundingClientRect().width; // 640
 * @see engine/ui/overlay.test.ts
 */

/** A fake element's style: named properties plus custom properties. */
class FakeStyle {
  [name: string]: unknown;
  private readonly custom = new Map<string, string>();
  setProperty(name: string, value: string): void {
    if (value === '') this.custom.delete(name);
    else this.custom.set(name, value);
  }
  getPropertyValue(name: string): string {
    return this.custom.get(name) ?? '';
  }
  removeProperty(name: string): void {
    this.custom.delete(name);
  }
}

/** `dataKey` as its attribute name (`data-key`). */
const attributeOf = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** One simple selector: classes and attributes (`.a.b[data-x][data-y=z]`). */
interface Simple {
  classes: string[];
  attributes: [string, string | undefined][];
}

/** Parses `.a [b=c]` into its descendant parts. */
function parse(selector: string): Simple[] {
  if (!/^(\s*(\.[\w-]+|\[[\w-]+(=['"]?[^'"\]]*['"]?)?\])+)+\s*$/.test(selector)) {
    throw new Error(`fakeDom: the selector "${selector}" is beyond the fake (classes, attributes and descendants)`);
  }
  return selector
    .trim()
    .split(/\s+/)
    .map((part) => ({
      classes: [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
      attributes: [...part.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/g)].map(
        (m) => [m[1], m[2]] as [string, string | undefined],
      ),
    }));
}

/** A fake element (see the file comment). */
export class FakeElement {
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  readonly style = new FakeStyle();
  private readonly attributes = new Map<string, string>();
  private ownText = '';
  readonly dataset: Record<string, string | undefined>;
  readonly ownerDocument: FakeDocument;
  readonly tagName: string;
  constructor(ownerDocument: FakeDocument, tagName: string) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_t, key: string) => this.attributes.get(attributeOf(key)),
      set: (_t, key: string, value: string) => (this.attributes.set(attributeOf(key), String(value)), true),
      deleteProperty: (_t, key: string) => (this.attributes.delete(attributeOf(key)), true),
      has: (_t, key: string) => this.attributes.has(attributeOf(key)),
    });
  }
  get parentNode(): FakeElement | null {
    return this.parentElement;
  }
  get id(): string {
    return this.attributes.get('id') ?? '';
  }
  set id(value: string) {
    this.attributes.set('id', value);
  }
  get className(): string {
    return this.attributes.get('class') ?? '';
  }
  set className(value: string) {
    this.attributes.set('class', value);
  }
  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (name: string) => list().includes(name),
      add: (name: string) => void (this.className = [...new Set([...list(), name])].join(' ')),
      remove: (name: string) =>
        void (this.className = list()
          .filter((n) => n !== name)
          .join(' ')),
    };
  }
  get hidden(): boolean {
    return this.attributes.has('hidden');
  }
  set hidden(value: boolean) {
    this.toggleAttribute('hidden', value);
  }
  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value: string) {
    for (const child of [...this.children]) child.remove();
    this.ownText = value;
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  toggleAttribute(name: string, force?: boolean): boolean {
    const on = force ?? !this.attributes.has(name);
    if (on) this.attributes.set(name, '');
    else this.attributes.delete(name);
    return on;
  }
  append(...children: FakeElement[]): void {
    for (const child of children) this.insertBefore(child, null);
  }
  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    child.remove();
    const at = before ? this.children.indexOf(before) : -1;
    this.children.splice(at < 0 ? this.children.length : at, 0, child);
    child.parentElement = this;
    return child;
  }
  after(sibling: FakeElement): void {
    const parent = this.parentElement!;
    parent.insertBefore(sibling, parent.children[parent.children.indexOf(this) + 1] ?? null);
  }
  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }
  /** Whether this element matches one simple selector. */
  matches(simple: Simple): boolean {
    return (
      simple.classes.every((name) => this.classList.contains(name)) &&
      simple.attributes.every(
        ([name, value]) => this.attributes.has(name) && (value === undefined || this.attributes.get(name) === value),
      )
    );
  }
  querySelectorAll(selector: string): FakeElement[] {
    const parts = parse(selector);
    const last = parts[parts.length - 1];
    const found: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const child of el.children) {
        if (child.matches(last) && child.hasAncestors(parts.slice(0, -1))) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  /** Whether this element's ancestors match `parts` (a descendant selector's outer parts), innermost last. */
  private hasAncestors(parts: Simple[]): boolean {
    let at = this.parentElement;
    for (let i = parts.length - 1; i >= 0; i--) {
      while (at && !at.matches(parts[i])) at = at.parentElement;
      if (!at) return false;
      at = at.parentElement;
    }
    return true;
  }
}

/** A fake document: a `<html>` with `<head>` and `<body>`, and an optional window. */
export class FakeDocument {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  defaultView: { innerWidth: number; innerHeight: number } | null = { innerWidth: 1280, innerHeight: 720 };
  constructor() {
    this.documentElement = new FakeElement(this, 'html');
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.documentElement.append(this.head, this.body);
  }
  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
  getElementById(id: string): FakeElement | null {
    const walk = (el: FakeElement): FakeElement | null =>
      el.id === id ? el : el.children.reduce<FakeElement | null>((hit, child) => hit ?? walk(child), null);
    return walk(this.documentElement);
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
  querySelector(selector: string): FakeElement | null {
    return this.documentElement.querySelector(selector);
  }
}

/** A canvas's client rect, CSS px. */
export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A fake page and a canvas (not yet in it) whose client rect is `rect`, which a test may change. */
export function fakePage(rect: CanvasRect) {
  const document = new FakeDocument();
  const canvas = Object.assign(document.createElement('canvas'), {
    rect: { ...rect },
    getBoundingClientRect(this: { rect: CanvasRect }) {
      const r = this.rect;
      return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height };
    },
  });
  return { document, canvas };
}

/** The fake's objects as the DOM types the modules take. */
export function asDom(page: ReturnType<typeof fakePage>): { document: Document; canvas: HTMLCanvasElement } {
  return { document: page.document as unknown as Document, canvas: page.canvas as unknown as HTMLCanvasElement };
}
