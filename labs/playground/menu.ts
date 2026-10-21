/**
 * @file The playground page's menu for humans (labs/playground/index.html): what the playground offers and how to play
 * it, as a small HTML/CSS panel in the top-left corner over the game. It lists every scene the page imports
 * (labs/playground/scenes/, the README's demo index) as a link to `?scene=<name>`, the five camera modes and the two
 * looks (labs/playground/views.ts) as links that keep the scene, the playground's replays as links to
 * `?replay=<name>`, and the controls: the actions the player answers, with the keys and pad buttons of the map of the
 * camera the page opens in (`playgroundMap`, labs/playground/controls.ts: each mode has its own, and the HUD shows the
 * one in use), labelled by the engine's `codeLabel` in the reader's keyboard layout, then the page's own keys.
 *
 * Toggle: the button in the corner, or M (`MENU_KEY`). The panel is a page panel (`data-panel`, engine/ui/chrome.ts):
 * in touch mode a tap on the game closes it. It opens unless the reader closed it last (`MENU_STORAGE_KEY` in
 * `localStorage`); blocked storage forgets.
 *
 * Who sees it: the view setting `playground.menu`, read when the page opens: `auto` (the default) shows it unless
 * automation drives the browser (`navigator.webdriver`, which Playwright sets), so no test's shot or golden holds it;
 * `on` and `off` force it. Shots never see it either way: `__engine.shot` reads the GPU back, not the page.
 *
 * It is the box's menu (labs/box/menu.ts) cut down to the playground's lists; both can move onto the engine's Menu
 * widget once WP 10.6 builds it.
 *
 * Invariants: presentation only: it reads the query and the registry, never the run, and changes nothing but by a
 * link (a reload). The module declares its setting at its top level and touches no DOM until `createPlaygroundMenu`,
 * so `x set` and the README's test import it in Node.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts, engine/sim-api.ts) and the
 * playground's files.
 *
 * @example
 * // labs/playground/main.ts, before the engine starts:
 * // createPlaygroundMenu(document, { scenes, replays: Object.keys(replays), scene });
 * // document.querySelector('#playground-menu a[href*="cam3=first"]')?.textContent; // 'first'
 */
import { codeLabel, getActionMap, readKeyboardLayout } from '../../engine';
import { defineSettings } from '../../engine/sim-api';
import { FEEL_KEY } from './feel';
import { PLAYGROUND_ACTIONS, PLAYGROUND_MAPS, playgroundMap } from './controls';
import { LOOK_KEY, PLAYGROUND_CAMERAS, PLAYGROUND_LOOKS } from './views';

/** The menu's view setting (see the file comment). */
export const PLAYGROUND_MENU_SETTINGS = defineSettings({
  'playground.menu': {
    type: 'string',
    enum: ['auto', 'on', 'off'],
    default: 'auto',
    view: true,
    when: 'scene',
    description:
      "The playground page's menu for humans (labs/playground/menu.ts): 'auto' shows it unless automation drives the browser (navigator.webdriver: the tests, the x commands), 'on' and 'off' force it; read when the page opens.",
  },
});

/** The key that shows and hides the menu: M, which no action map binds. */
export const MENU_KEY = 'KeyM';

/** The `localStorage` key that remembers whether the reader left the menu `open` or `closed`. */
export const MENU_STORAGE_KEY = 'my3dge:playground:menu';

/** A listed scene, as its module exports it. */
export interface MenuEntry {
  readonly id: string;
  readonly description?: string;
}

/** What the menu lists. */
export interface PlaygroundMenuOptions {
  /** The page's scenes, as registered (`playground:gym`…); the first is the page's default. */
  scenes: readonly MenuEntry[];
  /** The replays the page offers, by name (`playground-gym`). */
  replays: readonly string[];
  /** The scene the page opens (an id or a name; empty for the default). */
  scene: string;
  /** The page's query (`location.search`). */
  search?: string;
}

/** Whether `setting` (the query's `playground.menu`) shows the menu in a browser automation does or does not drive. */
export function menuShown(setting: string | null, automated: boolean): boolean {
  return setting === 'on' || (setting !== 'off' && !automated);
}

/** A link's query: `changes` (null removes a key) over `search`, or over only its `keep` keys; `:` and `,` readable. */
export function linkQuery(search: string, changes: Record<string, string | null>, keep?: readonly string[]): string {
  const from = new URLSearchParams(search);
  const params = keep ? new URLSearchParams() : from;
  for (const [key, value] of Object.entries(changes)) {
    params.delete(key);
    if (value !== null) params.set(key, value);
  }
  for (const key of keep ?? []) if (from.has(key)) params.set(key, from.get(key)!);
  const text = params.toString().replaceAll('%3A', ':').replaceAll('%2C', ',');
  return text ? `?${text}` : './';
}

/** What each view action does, in the order the rows list them. */
const VIEW_ROWS: Readonly<Record<string, string>> = {
  camera: 'Camera mode',
  shoulder: 'Swap the shoulder',
  turnLeft: 'Turn the view left',
  turnRight: 'Turn the view right',
};

/** The controls' rows, [what, keys, pad], of the map `id` (the shooter's by default): moving, the player's actions, the look or the aim, the map's view actions, the page's keys. */ // prettier-ignore
export function controlRows(layout?: ReadonlyMap<string, string>, id: string = PLAYGROUND_MAPS.shooter): [string, string, string][] { // prettier-ignore
  const map = getActionMap(id);
  const label = (code: string) => codeLabel(code, { layout }).replace(/^[LR] (?=Shift)/, '');
  const keys = (codes: readonly string[]) => [...new Set(codes.filter((c) => !c.startsWith('Pad')).map(label))];
  const pad = (codes: readonly string[]) => [...new Set(codes.filter((c) => c.startsWith('Pad')).map(label))];
  const row = (words: string, action: string): [string, string, string] => {
    const codes = map.actions[action] ?? [];
    return [words, keys(codes).join(' / '), pad(codes).join(' / ')];
  };
  const ways = map.move.map((action) => keys(map.actions[action] ?? []));
  const [forward, back, left, right] = ways;
  const move = forward.map((key, i) => [key, left[i], back[i], right[i]].join(' ')).join(' / ');
  const actions = Object.entries(PLAYGROUND_ACTIONS).map(([action, words]) => row(words, action));
  const look: [string, string, string] = map.lock
    ? ['Look around', 'Click the game, then the mouse (Esc lets go)', 'R Stick']
    : ['Aim', 'The pointer, onto the floor', 'R Stick'];
  const views = Object.entries(VIEW_ROWS).filter(([action]) => map.view.includes(action));
  return [
    ['Move', move, 'L Stick'],
    ...actions,
    look,
    ...views.map(([action, words]) => row(words, action)),
    ['Cel or pixel look', label(LOOK_KEY), ''],
    ['Zoom', 'Wheel', ''],
    ['The feel panel: the numbers, live', label(FEEL_KEY), ''],
    ['This menu', label(MENU_KEY), ''],
  ];
}

/** The menu's look, added once as `<style id="playground-menu-style">`. */
const STYLE = `
.pg-menu-toggle, .pg-menu { position: fixed; left: 8px; z-index: 20; box-sizing: border-box;
  font: 13px/1.35 system-ui, sans-serif; color: #c9ccd4; background: rgba(21, 23, 28, 0.9);
  border: 1px solid #3a3f4b; border-radius: 8px; }
.pg-menu-toggle { top: 8px; padding: 4px 10px; cursor: pointer; }
.pg-menu { top: 44px; width: min(520px, calc(100vw - 16px)); max-height: calc(100dvh - 92px); overflow: auto;
  padding: 6px 10px 10px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); }
.pg-menu[hidden] { display: none; }
.pg-menu h2 { margin: 8px 0 3px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: #8b90a0; }
.pg-menu p, .pg-menu table { margin: 0; padding: 0; }
.pg-menu a { color: #9cc4ff; text-decoration: none; padding: 0 8px; border: 1px solid #3a3f4b; border-radius: 999px; }
.pg-menu a:hover, .pg-menu a:focus-visible { text-decoration: underline; }
.pg-menu a[aria-current] { background: #2b4470; color: #fff; }
.pg-menu-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.pg-menu table { width: 100%; border-collapse: collapse; }
.pg-menu td { padding: 1px 8px 1px 0; vertical-align: top; }
.pg-menu td:first-child { color: #e6e8ee; }
.pg-menu td:last-child { color: #8b90a0; }
`;

/** The name after an id's colon: `gym` for `playground:gym`. */
const nameOf = (id: string) => id.slice(id.indexOf(':') + 1);

/** Builds the menu in `document` when `playground.menu` shows it, and returns its panel; null when it stays out. */
export function createPlaygroundMenu(document: Document, options: PlaygroundMenuOptions): HTMLElement | null {
  const search = options.search ?? document.location.search;
  const query = new URLSearchParams(search);
  if (!menuShown(query.get('playground.menu'), document.defaultView?.navigator.webdriver === true)) return null;
  const el = (tag: string, attributes: Record<string, string | boolean> = {}, ...children: (Node | string)[]) => {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== false) element.setAttribute(name, value === true ? '' : value);
    }
    element.append(...children);
    return element;
  };
  /** A section of link chips: [href, current, hover text, text] each. */
  const chips = (name: string, title: string, links: [string, boolean, string, string][]) => {
    const list = links.map(([href, on, hint, text]) =>
      el('a', { href, 'aria-current': on && 'true', title: hint }, text),
    );
    return el('section', { 'data-menu': name }, el('h2', {}, title), el('p', { class: 'pg-menu-chips' }, ...list));
  };
  const kept = ['post.look', 'cam', 'cam3', 'cam.wholeZoom', 'playground.menu'];
  const scene = nameOf(options.scene || options.scenes[0]?.id || '');
  const camera = query.has('cam') ? `cam=${query.get('cam')}` : `cam3=${query.get('cam3') ?? 'shoulder'}`;
  const look = query.get('post.look') ?? PLAYGROUND_LOOKS[0];
  const replay = query.get('replay');
  const scenes = options.scenes.map(({ id, description }): [string, boolean, string, string] => {
    const name = nameOf(id);
    return [linkQuery(search, { scene: name }, kept), name === scene, description ?? id, name];
  });
  const cameras = PLAYGROUND_CAMERAS.map(({ name, code, label }): [string, boolean, string, string] => {
    const [key, value] = code.split('=');
    return [linkQuery(search, { cam: null, cam3: null, [key]: value }), camera.split(',')[0] === code, label, name];
  });
  const looks = PLAYGROUND_LOOKS.map((id): [string, boolean, string, string] => {
    return [linkQuery(search, { 'post.look': id }), id === look, id, nameOf(id).replace(/^playground-/, '')];
  });
  const replays = options.replays.map((name): [string, boolean, string, string] => {
    const hint = `${name}: the recorded run, then you play`;
    return [linkQuery(search, { replay: name }, kept), name === replay, hint, name.replace(/^playground-/, '')];
  });
  const map = playgroundMap(camera);
  const rows = el('tbody');
  const fill = (layout?: ReadonlyMap<string, string>) =>
    rows.replaceChildren(
      ...controlRows(layout, map).map((row) => el('tr', {}, ...row.map((cell) => el('td', {}, cell)))),
    );
  fill();
  void readKeyboardLayout().then((layout) => layout && fill(layout)); // the keys the reader's layout prints

  const panel = el(
    'nav',
    { id: 'playground-menu', class: 'pg-menu', 'data-panel': true, 'aria-label': 'The Playground' },
    el('p', {}, "The Playground: my-3dge's character, cameras and looks. Pick a camera, then move."),
    chips('scenes', 'Scenes', scenes),
    chips('cameras', `Camera (${codeLabel(getActionMap(map).actions.camera?.[0] ?? 'KeyT')})`, cameras),
    chips('looks', `Look (${codeLabel(LOOK_KEY)})`, looks),
    chips('replays', 'Replays', replays),
    el('section', { 'data-menu': 'controls', 'data-keyboard': true }, el('h2', {}, 'Controls'), el('table', {}, rows)),
  );
  const toggle = el('button', { id: 'playground-menu-toggle', class: 'pg-menu-toggle', type: 'button' }, '☰ Menu M');
  toggle.setAttribute('aria-controls', 'playground-menu');
  toggle.setAttribute('aria-keyshortcuts', codeLabel(MENU_KEY));
  const storage = (() => {
    try {
      return document.defaultView?.localStorage ?? null;
    } catch {
      return null; // site data blocked: remember nothing
    }
  })();
  const show = (open: boolean, remember = true) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    try {
      if (remember) storage?.setItem(MENU_STORAGE_KEY, open ? 'open' : 'closed');
    } catch {
      // Nothing kept: the next page opens the menu.
    }
  };
  toggle.addEventListener('mousedown', (event) => event.preventDefault()); // no focus: Space stays the jump
  toggle.addEventListener('click', () => show(panel.hidden));
  panel.addEventListener('close', () => show(false)); // a tap on the game closed it (engine/ui/chrome.ts)
  document.defaultView?.addEventListener('keydown', (event) => {
    if (event.code === MENU_KEY && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) {
      show(panel.hidden);
    }
  });
  if (!document.getElementById('playground-menu-style')) {
    document.head.append(el('style', { id: 'playground-menu-style' }, STYLE));
  }
  document.body.append(toggle, panel);
  let closed = false;
  try {
    closed = storage?.getItem(MENU_STORAGE_KEY) === 'closed';
  } catch {
    // Blocked: open, as on a first visit.
  }
  show(!closed, false);
  return panel;
}
