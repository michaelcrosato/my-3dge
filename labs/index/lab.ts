/**
 * @file A lab page's panel (PLAN.md WP 10.8): what every lab shows beside its canvas, so people watching find the
 * same things in each: its title and what it is for, the `x` command that does the same job without the page (each
 * lab is a view; the command is what an agent runs), a link back to the labs index, and the sections a lab fills: lists
 * of entries to open, settings to set, read-outs. Plain DOM over the page's `#lab` element, styled by lab.css; no
 * engine: each lab starts the engine itself and drives it through its inspector (`__engine`).
 *
 * Invariants: every link is a real link (`href`), so a lab's state is its address and a reload keeps it; the panel's
 * text is the page's DOM, so tests read it with DOM queries (tests/e2e/labs.spec.ts).
 *
 * @example
 * // browser
 * // a lab's main.ts, in its page:
 * // const panel = labPanel(document, { title: 'Props Lab', what: 'Every prop.', command: 'node x gallery prop' });
 * // entryList(panel.section('Props'), [{ label: 'prop:crate', href: '#gallery/prop/prop:crate', current: true }]);
 * @see tests/e2e/labs.spec.ts
 */
import './lab.css';

/** What a lab says about itself: its title, what it is for, and the `x` command that does the same job. */
export interface LabSpec {
  title: string;
  what: string;
  command: string;
}

/** A lab's panel: its sections and a status line. */
export interface LabPanel {
  /** The panel element (`#lab`). */
  readonly root: HTMLElement;
  /** Adds a section titled `title` and returns its body, for the lab to fill. */
  section(title: string): HTMLElement;
  /** Shows `text` in the status line (what is showing, what went wrong). */
  status(text: string): void;
}

/** One entry of a list: what it says and where it leads. */
export interface ListItem {
  label: string;
  href: string;
  current?: boolean;
  title?: string;
}

/** An element `tag` with `attributes` and `children`. */
export function el(
  doc: Document,
  tag: string,
  attributes: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElement {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** The lab's panel in `#lab` (made when the page lacks one): its header, then the sections the lab adds. */
export function labPanel(doc: Document, spec: LabSpec): LabPanel {
  const root = doc.getElementById('lab') ?? doc.body.appendChild(el(doc, 'aside', { id: 'lab' }));
  root.replaceChildren(
    el(doc, 'a', { class: 'lab-back', href: '../index/' }, 'All labs'),
    el(doc, 'h1', {}, spec.title),
    el(doc, 'p', { class: 'lab-what' }, spec.what),
    el(doc, 'p', { class: 'lab-command', title: 'the same job without the page' }, el(doc, 'code', {}, spec.command)),
  );
  const line = el(doc, 'p', { class: 'lab-status', role: 'status' });
  root.append(line);
  doc.title = `${spec.title}: my-3dge`;
  return {
    root,
    section(title) {
      const body = el(doc, 'div', { class: 'lab-body' });
      root.append(el(doc, 'section', { 'data-section': title }, el(doc, 'h2', {}, title), body));
      return body;
    },
    status(text) {
      line.textContent = text;
    },
  };
}

/** Lists `entries` as links in `parent`, the current one marked (`aria-current`); returns the list. */
export function entryList(parent: HTMLElement, entries: readonly ListItem[]): HTMLElement {
  const doc = parent.ownerDocument;
  const items = entries.map((entry) => {
    const link = el(doc, 'a', { href: entry.href, ...(entry.title ? { title: entry.title } : {}) }, entry.label);
    if (entry.current) link.setAttribute('aria-current', 'true');
    return el(doc, 'li', {}, link);
  });
  const list = el(doc, 'ul', { class: 'lab-list' }, ...items);
  parent.append(list);
  return list;
}

/** A button in `parent` labelled `label` that runs `act` when pressed; returns it. */
export function button(parent: HTMLElement, label: string, act: () => void): HTMLButtonElement {
  const node = el(parent.ownerDocument, 'button', { type: 'button' }, label) as HTMLButtonElement;
  node.addEventListener('click', act);
  parent.append(node);
  return node;
}

/** Reloads the page when its hash changes, so a deep link (`#gallery/<kind>/<id>`) opens what it names. */
export function reloadOnHash(win: Window): void {
  win.addEventListener('hashchange', () => win.location.reload());
}
