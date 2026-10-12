/**
 * @file The box page's menu for humans (labs/box/index.html): what the box offers and how to play it, as a small HTML/CSS
 * panel in the top-left corner over the game. It lists every scene the page imports (labs/box/scenes/, the README's
 * demo index) as a link to `?scene=<name>` with a one-line label (the scene's description on hover), the box's
 * replays as links to `?replay=<name>`, cameras and looks as links that keep the scene (the query with only `cam` and
 * `cam3`, or `post.look`, changed), and the controls: every action of the map the page's input binds (`BOX_ACTION_MAP`,
 * createEngine's default) with its keys and mouse buttons and its pad buttons, labelled by the engine's `codeLabel` in
 * the reader's keyboard layout (`readKeyboardLayout`), then the wheel, the menu's key and the sound's first gesture;
 * in touch mode the box's touch buttons (`touchlayout:box`, labs/box/touch.ts) instead of the keys.
 *
 * Toggle: the button in the corner, or M (`MENU_KEY`, a key no action map binds: tests/e2e/box-menu.spec.ts checks
 * every registered map, the system layer and the reserved codes). The panel is a page panel (`data-panel`,
 * engine/ui/chrome.ts): in touch mode it starts below the corner and scrolls, the touch buttons hide while it is open,
 * and a tap on the game closes it; its key rows are `data-keyboard`, which touch mode hides.
 *
 * Who sees it: the view setting `box.menu`, read when the page opens. `auto` (the default) shows it unless automation
 * drives the browser (`navigator.webdriver`, which Playwright sets: every e2e spec and every x command that opens the
 * page), so no test's screenshot, perf run or golden ever holds it; `on` and `off` force it (`?box.menu=on`). Shots
 * never see it either way: `__engine.shot` reads the GPU back, not the page.
 *
 * Invariants: presentation only: it reads the query and the registry, never the run, and changes nothing but by a
 * link (a reload). The module declares its setting at its top level and touches no DOM until `createBoxMenu`, so
 * `x set` and the README's test import it in Node. When the engine's own Menu widget lands (PLAN.md WP 10.6, on
 * demand), this panel can move onto it.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts, engine/sim-api.ts) and the box's files.
 *
 * @example
 * // labs/box/main.ts, before the engine starts:
 * // createBoxMenu(document, { scenes, looks, replays: Object.keys(replays), scene });
 * // document.querySelector('#box-menu a[href^="?scene="]')?.getAttribute('href'); // '?scene=room'
 */
import { codeLabel, getActionMap, getTouchLayout, readKeyboardLayout, type ActionMap } from '../../engine';
import { defineSettings } from '../../engine/sim-api';
import { BOX_TOUCH } from './touch';

/** The menu's view setting (see the file comment). */
export const MENU_SETTINGS = defineSettings({
  'box.menu': {
    type: 'string',
    enum: ['auto', 'on', 'off'],
    default: 'auto',
    view: true,
    when: 'scene',
    description:
      "The page's menu for humans (labs/box/menu.ts): 'auto' shows it unless automation drives the browser (navigator.webdriver: the tests, the x commands), 'on' and 'off' force it; read when the page opens.",
  },
});

/** The key that shows and hides the menu: M, which no action map binds. */
export const MENU_KEY = 'KeyM';

/** The action map the page's input binds: createEngine's default (engine/input/input.ts). */
export const BOX_ACTION_MAP = 'actionMap:thirdPerson';

/** Each scene's line, by name, in the menu's order; a scene missing here follows with its description. */
const SCENE_LABELS: Readonly<Record<string, string>> = {
  room: 'Three crates on fixed paths, no hero',
  'room-hero': 'The hero: walk, jump and dash',
  hall: 'The hall: stairs, galleries, the dais',
  'hall-props': 'Crates and barrels to push and shove',
  'crowd-100': 'A crowd of 100 chases the hero',
  'crowd-1000': 'A crowd of 1,000 chases him',
  'crowd-5000': 'A crowd of 5,000 (heavy)',
  fight: 'Sword and bolt against 36 foes',
  'fight-1000': 'Against 1,000 foes (heavy)',
  clips: 'The hero and a mannequin dance',
};

/** The engine's looks offered after the box's own; any scene shows any look. */
const ENGINE_LOOKS = ['look:cartoon', 'look:game-boy', 'look:16-bit', 'look:comic-book', 'look:oil-painting'];

/** The cameras offered: chase and first person follow the hero (the level's centre without him). */
const CAMERAS: readonly { key: 'cam' | 'cam3'; value: string; label: string }[] = [
  { key: 'cam3', value: 'chase', label: 'Chase' },
  { key: 'cam3', value: 'first', label: 'First person' },
  { key: 'cam3', value: 'orbit', label: 'Orbit' },
  { key: 'cam', value: 'iso', label: 'Iso' },
  { key: 'cam', value: 'topdown', label: 'Top-down' },
];

/** The view settings a scene or replay link keeps from the page's query. */
const KEPT = ['post.look', 'touch', 'box.menu'];

/** What each action does in the box; an action missing here shows its name. */
const ACTION_WORDS: Readonly<Record<string, string>> = {
  jump: 'Jump',
  dash: 'Dash',
  attack: 'Attack (shove)',
  skill: 'Bolt',
  interact: 'Interact (unused)',
};

/** A pad label's direction (`D-pad Up`, `L Stick Left`): the move row names the pad and the stick once. */
const DIRECTION = / (Up|Down|Left|Right)$/;

/** Codes shown in words or arrows rather than as `codeLabel` names them. */
const WORDS: Readonly<Record<string, string>> = {
  MouseLeft: 'Left click',
  MouseRight: 'Right click',
  MouseMiddle: 'Middle click',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** A listed entry: a scene or a look, as its module exports it. */
export interface MenuEntry {
  readonly id: string;
  readonly description?: string;
}

/** What the menu lists. */
export interface BoxMenuOptions {
  /** The page's scenes, as registered (`box:room`…); the first is the page's default. */
  scenes: readonly MenuEntry[];
  /** The box's own looks (labs/box/looks/). */
  looks: readonly MenuEntry[];
  /** The replays the page offers, by name (`box-1-room`). */
  replays: readonly string[];
  /** The scene the page opens (an id or a name; empty for the default). */
  scene: string;
  /** The page's query (`location.search`). */
  search?: string;
}

/** One row of the controls: what it does, then the keys and mouse buttons, then the pad's buttons. */
export interface ControlRow {
  action: string;
  words: string;
  keys: string;
  pad: string;
}

/** Whether `setting` (the query's `box.menu`) shows the menu in a browser that automation does or does not drive. */
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

/** The rows of the controls for `map`: moving first, then each other action in the map's order. */
export function controlRows(map: ActionMap, layout?: ReadonlyMap<string, string>): ControlRow[] {
  const label = (code: string) => WORDS[code] ?? codeLabel(code, { layout }).replace(/^[LR] (?=Shift|Ctrl|Alt)/, '');
  const unique = (labels: string[]) => [...new Set(labels)];
  const keys = (codes: readonly string[]) => unique(codes.filter((code) => !/^(Pad|touch:)/.test(code)).map(label));
  const pad = (codes: readonly string[]) =>
    unique(codes.filter((code) => code.startsWith('Pad')).map((c) => codeLabel(c)));
  const [forward, back, left, right] = map.move.map((action) => map.actions[action] ?? []);
  const ways = [forward, left, back, right].map(keys);
  const rows = Array.from({ length: Math.max(...ways.map((way) => way.length)) }, (_, i) => ways.map((way) => way[i]));
  const moving: ControlRow = {
    action: 'move',
    words: 'Move',
    keys: rows.map((row) => row.filter(Boolean).join(' ')).join(' / '),
    pad: unique(pad([...forward, ...back, ...left, ...right]).map((name) => name.replace(DIRECTION, ''))).join(' / '),
  };
  const others = Object.entries(map.actions)
    .filter(([action]) => !map.move.includes(action))
    .map(([action, codes]) => ({
      action,
      words: ACTION_WORDS[action] ?? action,
      keys: keys(codes).join(' / '),
      pad: pad(codes).join(' / '),
    }));
  return [moving, ...others];
}

/** The menu's look, added once as `<style id="box-menu-style">`. */
const STYLE = `
.box-menu-toggle, .box-menu { position: fixed; left: 8px; z-index: 20; box-sizing: border-box;
  font: 13px/1.35 system-ui, sans-serif; color: #c9ccd4; background: rgba(21, 23, 28, 0.9);
  border: 1px solid #3a3f4b; border-radius: 8px; }
.box-menu-toggle { top: 8px; padding: 4px 10px; cursor: pointer; }
.box-menu kbd, .box-menu-toggle kbd { font: inherit; padding: 0 4px; border: 1px solid #4a505e; border-radius: 3px; }
.box-menu { top: 44px; width: min(660px, calc(100vw - 16px)); max-height: calc(100dvh - 92px); overflow: auto;
  overscroll-behavior: contain; padding: 6px 10px 10px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4); }
.box-menu[hidden] { display: none; }
html.touch .box-menu { width: min(360px, calc(100vw - 16px)); max-height: calc(100dvh - 106px); }
.box-menu-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); column-gap: 16px; }
.box-menu h2 { margin: 8px 0 3px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: #8b90a0; }
.box-menu p, .box-menu ul, .box-menu table { margin: 0; padding: 0; }
.box-menu ul { list-style: none; }
.box-menu a { color: #9cc4ff; text-decoration: none; border-radius: 4px; }
.box-menu a:hover, .box-menu a:focus-visible { text-decoration: underline; }
.box-menu a[aria-current] { background: #2b4470; color: #fff; }
.box-menu [data-menu='scenes'] a { display: block; padding: 1px 4px; }
.box-menu [data-menu='scenes'] b { margin-right: 6px; color: #e6e8ee; font-weight: 600; }
.box-menu [data-menu='scenes'] span { color: #a3a8b5; }
.box-menu-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.box-menu-chips a { padding: 0 8px; border: 1px solid #3a3f4b; border-radius: 999px; }
.box-menu table { width: 100%; border-collapse: collapse; }
.box-menu td { padding: 1px 8px 1px 0; vertical-align: top; }
.box-menu td:first-child { color: #e6e8ee; }
.box-menu td:nth-child(2) { white-space: nowrap; }
.box-menu td:last-child { padding-right: 0; color: #8b90a0; }
.box-menu-note { margin-top: 6px !important; color: #a3a8b5; }
html:not(.touch) .box-menu-touch { display: none; }
`;

/** An element with attributes (`hidden` and the like as true) and children. */
function make(
  document: Document,
  tag: string,
  attributes: Record<string, string | boolean> = {},
  ...children: (Node | string)[]
): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === true) element.setAttribute(name, '');
    else if (value !== false) element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

/** The name after an id's colon: `room` for `box:room`, `torch-lit` for `look:torch-lit`. */
const nameOf = (id: string) => id.slice(id.indexOf(':') + 1);

/**
 * Builds the menu in `document` when `box.menu` shows it (see the file comment) and returns its panel; null when it
 * stays out (automation, or `box.menu=off`).
 */
export function createBoxMenu(document: Document, options: BoxMenuOptions): HTMLElement | null {
  const search = options.search ?? document.location.search;
  const query = new URLSearchParams(search);
  if (!menuShown(query.get('box.menu'), document.defaultView?.navigator.webdriver === true)) return null;
  const el = (tag: string, attributes?: Record<string, string | boolean>, ...children: (Node | string)[]) =>
    make(document, tag, attributes, ...children);
  const section = (name: string, title: string, ...children: Node[]) =>
    el('section', { 'data-menu': name }, el('h2', {}, title), ...children);
  const link = (href: string, current: boolean, title: string | undefined, ...children: (Node | string)[]) =>
    el('a', { href, 'aria-current': current && 'true', title: title ?? false }, ...children);
  const chips = (...links: Node[]) => el('p', { class: 'box-menu-chips' }, ...links);

  const current = nameOf(options.scene || options.scenes[0]?.id || '');
  const order = Object.keys(SCENE_LABELS);
  const rank = (entry: MenuEntry) =>
    order.includes(nameOf(entry.id)) ? order.indexOf(nameOf(entry.id)) : order.length;
  const scenes = [...options.scenes].sort((a, b) => rank(a) - rank(b));
  const sceneList = el(
    'ul',
    {},
    ...scenes.map(({ id, description }) => {
      const name = nameOf(id);
      const href = linkQuery(search, { scene: name }, KEPT);
      const line = el('span', {}, SCENE_LABELS[name] ?? description ?? '');
      return el('li', {}, link(href, name === current, description, el('b', {}, name), line));
    }),
  );
  const cam = query.has('cam') ? `cam=${query.get('cam')}` : query.has('cam3') ? `cam3=${query.get('cam3')}` : '';
  const cameras = CAMERAS.map(({ key, value, label }) =>
    link(
      linkQuery(search, { cam: null, cam3: null, [key]: value }),
      cam === `${key}=${value}`,
      `${key}=${value}`,
      label,
    ),
  );
  const look = query.get('post.look') ?? 'look:clean';
  const lookIds = ['look:clean', ...options.looks.map((entry) => entry.id), ...ENGINE_LOOKS];
  const descriptions = new Map(options.looks.map((entry) => [entry.id, entry.description]));
  const looks = [...new Set(lookIds)].map((id) => {
    const href = linkQuery(search, { 'post.look': id === 'look:clean' ? null : id });
    return link(href, id === look, descriptions.get(id) ?? id, nameOf(id));
  });
  const replay = query.get('replay');
  const replays = options.replays.map((name) =>
    link(
      linkQuery(search, { replay: name }, KEPT),
      name === replay,
      `${name}: the recorded run, then you play`,
      name.replace(/^box-/, ''),
    ),
  );

  const keyRows = el('tbody');
  const menuKey = el('kbd', { 'data-keyboard': true }); // no keys in touch mode
  const fillKeys = (layout?: ReadonlyMap<string, string>) => {
    menuKey.textContent = codeLabel(MENU_KEY, { layout });
    const rows = controlRows(getActionMap(BOX_ACTION_MAP), layout).map(({ action, words, keys, pad }) =>
      el('tr', { 'data-action': action }, el('td', {}, words), el('td', {}, keys), el('td', {}, pad)),
    );
    const extra = (words: string, keys: string) => el('tr', {}, el('td', {}, words), el('td', {}, keys), el('td'));
    keyRows.replaceChildren(...rows, extra('Zoom', 'Wheel'), extra('This menu', menuKey.textContent));
  };
  fillKeys();
  void readKeyboardLayout().then((layout) => layout && fillKeys(layout)); // the keys the reader's layout prints
  const touch = getTouchLayout(BOX_TOUCH).buttons.map((button) => button.label);
  const controls = section(
    'controls',
    'Controls',
    el('table', { 'data-keyboard': true }, keyRows),
    el(
      'ul',
      { class: 'box-menu-touch' },
      el('li', {}, 'Drag anywhere on the game: move'),
      el('li', {}, `The buttons, bottom right: ${touch.join(', ')}`),
      el('li', {}, 'Tap the game: close this menu'),
    ),
    el('p', { class: 'box-menu-note' }, 'Sound starts at your first key, click or touch.'),
  );

  const panel = el(
    'nav',
    { id: 'box-menu', class: 'box-menu', 'data-panel': true, 'aria-label': 'The Stress Box' },
    el('p', {}, "The Stress Box: my-3dge's test scenes. Pick a scene, then play."),
    el(
      'div',
      { class: 'box-menu-columns' },
      el('div', {}, section('scenes', 'Scenes', sceneList), section('cameras', 'Camera', chips(...cameras))),
      el(
        'div',
        {},
        controls,
        section('looks', 'Look', chips(...looks)),
        section('replays', 'Replays', chips(...replays)),
      ),
    ),
  );
  const toggle = el(
    'button',
    { id: 'box-menu-toggle', class: 'box-menu-toggle', type: 'button', 'aria-controls': 'box-menu' },
    '☰ Menu ',
    menuKey,
  );
  toggle.dataset.key = MENU_KEY;
  toggle.setAttribute('aria-keyshortcuts', codeLabel(MENU_KEY));
  const show = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('mousedown', (event) => event.preventDefault()); // no focus: Space stays the jump
  toggle.addEventListener('click', () => show(panel.hidden));
  panel.addEventListener('close', () => show(false)); // a tap on the game closed it (engine/ui/chrome.ts)
  document.defaultView?.addEventListener('keydown', (event) => {
    if (event.code !== MENU_KEY || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    show(panel.hidden);
  });
  if (!document.getElementById('box-menu-style')) {
    document.head.append(el('style', { id: 'box-menu-style' }, STYLE));
  }
  document.body.append(toggle, panel);
  show(true);
  return panel;
}
