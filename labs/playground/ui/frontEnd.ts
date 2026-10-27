/**
 * @file The playground's front end (docs/PLAYGROUND.md §8.3, PLAN.md WP 13.25): its screens over the game, the engine's
 * menus (engine/ui/menu.ts) and the playground's panels, on a stack (closing one shows the one under it again):
 * - the title screen (`title`: Play, Owner checks, Spawn, Settings, Photo mode, Watch the tour), shown as the page
 *   opens while the view setting `playground.title` says so (`auto`: unless a replay plays or automation drives the
 *   browser, as the menu for humans; `on`, `off`); Escape plays; left idle there `ATTRACT.idle` seconds, it opens the
 *   attract mode (labs/playground/ui/attract.ts) while `playground.attract` is `auto` and no automation drives the
 *   browser;
 * - pause (`pause`: Resume, Answer this check while one is under way, Spawn, Settings, Photo mode, Owner checks,
 *   Restart, Title screen), opened by the system layer's `pause` (Escape, the pad's Start) or by the pointer lock let
 *   go while the map wants it (a browser spends the first Escape on the lock);
 * - the spawn picker (`spawns`, labs/playground/ui/spawns.ts), settings (`settings`, labs/playground/ui/settings.ts),
 *   photo mode (`photo`, labs/playground/ui/photo.ts) and the owner's checks (`checks`, opened on the list; `check`,
 *   on the check under way: labs/playground/ui/checkPanel.ts), whose answers go to `checkStore` and whose Go there
 *   opens the check's link (labs/playground/ui/checks.ts `checkUrl`; another page in a new tab).
 * While one is open the run is paused (`__engine.pause()`) and the front end is modal (`modal()`, which the page gives
 * `createEngine`), so no key it reads reaches the run; the last closing resumes it. Escape (`uiCancel`) goes back one.
 *
 * Picks that change play are the run's recorded operations, so a replay of the run holds them: a spawn is the block's
 * dev action `place` (`actions.run`) on a scene of the block, else the block's page opened with the pick
 * (`?scene=site&playground.spawn=<id>`, run as its first operation: `spawnOnOpen`); Restart starts the scene again on
 * its seed (`seed`); the movement profile is the sim setting `playground.movement`, set, then the scene started again.
 * The camera mode, the view settings and the audio levels change the view alone; the store keeps them (prefs.ts).
 * `state()`, `window.__playgroundUi.state()` in the page, names the open screens for the tests;
 * `__playgroundUi.checks()` lists the owner's checks with their answers, and `__playgroundUi.answers()` gives them as
 * the text to paste.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts) and the playground's own files.
 *
 * @example
 * // labs/playground/main.ts, once the engine is up:
 * // const ui = createFrontEnd({ engine, canvas, store, prefs, audio: sound.audio, scene: () => last?.scene ?? null, … });
 * // ui.open('title'); // and each drawn frame: ui.frame(dt)
 * @see tests/e2e/playground.spec.ts
 */
import { createMenu, type CameraInput, type Engine, type EngineFrame, type Menu, type MenuItem, type Store } from '../../../engine'; // prettier-ignore
import { defineSettings } from '../../../engine/sim-api';
import { cameraMode, PLAYGROUND_CAMERAS } from '../views';
import { ATTRACT, attractPage } from './attract';
import { createChecksPanel } from './checkPanel';
import { answered, answersText, checkUrl, OWNER_CHECKS, readAnswers, saveAnswer, type OwnerCheck } from './checks';
import { createPhoto, type PhotoCamera } from './photo';
import { PREF_BUSES, savePrefs, type Prefs } from './prefs';
import { createSettings, type RowSchema, type SettingRow } from './settings';
import { spawnPlace, spawnPlaces } from './spawns';

/** The title screen's view setting (see the file comment). */
export const FRONT_END_SETTINGS = defineSettings({
  'playground.title': {
    type: 'string',
    enum: ['auto', 'on', 'off'],
    default: 'auto',
    view: true,
    when: 'scene',
    description:
      "The playground page's title screen (labs/playground/ui/frontEnd.ts): 'auto' shows it as the page opens unless a replay plays or automation drives the browser (navigator.webdriver: the tests, the x commands); 'on' and 'off' force it.",
  },
});

/** The screens. */
export type ScreenName = 'title' | 'pause' | 'spawns' | 'settings' | 'photo' | 'checks' | 'check';

/** What the front end needs of the page. */
export interface FrontEndOptions {
  engine: Engine;
  canvas: HTMLCanvasElement;
  /** Where the preferences are kept, and what was kept. */
  store: Store;
  prefs: Prefs;
  /** The page's audio, whose buses the settings set; null without one. */
  audio: { volume(bus: string, value?: number): number } | null;
  /** The scene the last frame drew; null before one. */
  scene(): EngineFrame['scene'] | null;
  /** A setting's value now, view settings among them (the last frame's `setting`). */
  setting(path: string): unknown;
  /** The camera mode or the look changed here, for the page's HUD. */
  onView(change: { camera?: string; look?: string }): void;
  /** Whether an idle title screen opens the attract mode (`playground.attract` `auto`, no automation). */
  attract?: boolean;
  /** Where the owner's answers are kept: a store that keeps them while a replay plays too. */
  checkStore: Store;
  /** The owner's check under way (`playground.check`); none without one. */
  check?: OwnerCheck;
}

/** The front end (see the file comment). */
export interface FrontEnd {
  open(screen: ScreenName): void;
  /** Runs one drawn frame of `dt` s: the pause key, the top screen's input. */
  frame(dt: number): void;
  modal(): boolean;
  cameraInput(): CameraInput | undefined;
  state(): { screens: ScreenName[]; paused: boolean };
}

/** The screen on top of the stack, made: what it reads each frame, and how it goes. */
interface Screen {
  update(dt: number): void;
  remove(): void;
}

/** Whether the title screen opens with the page (see the file comment). */
export function titleOnOpen(setting: string, search: URLSearchParams, webdriver: boolean): boolean {
  return setting === 'on' || (setting === 'auto' && !webdriver && !search.has('replay'));
}

/** Runs `search`'s spawn pick (`playground.spawn`) on a scene of the block once the page is up; false when none ran. */
export function spawnOnOpen(engine: Engine, search: URLSearchParams, scene: EngineFrame['scene']): boolean {
  const place = spawnPlace(search.get('playground.spawn') ?? '');
  if (!place || scene.site !== 'site:block' || !engine.inspector) return false;
  (engine.inspector.actions as { run(name: string, args: unknown): unknown }).run('place', place.args);
  return true;
}

/** Makes the front end, nothing open (see the file comment). */
export function createFrontEnd(options: FrontEndOptions): FrontEnd {
  const { engine, store, prefs } = options;
  const inspector = engine.inspector!;
  const [root, input] = [engine.ui!.root, engine.input!];
  const camera = () => (inspector.camera as PhotoCamera & { set(code: string, o?: { blend?: boolean }): { code: string } }) ?? null; // prettier-ignore
  const photo = createPhoto(root, options.canvas, input, camera);
  const stack: ScreenName[] = []; // only the top one is made: closing it makes the one under it again
  let current: Screen | null = null;
  let paused = false;

  const keep = () => void savePrefs(store, prefs);
  const pauseRun = (on: boolean) => {
    if (on === paused) return;
    paused = on;
    if (on) inspector.pause();
    else inspector.resume();
  };
  /** The scene started again on its seed, paused still while a screen is open. */
  const restart = () => {
    inspector.seed(inspector.seed());
    if (paused) inspector.pause();
  };
  const render = () => {
    current?.remove();
    current = stack.length ? make(stack.at(-1)!) : null;
  };
  const show = (name: ScreenName) => {
    stack.push(name);
    render();
    pauseRun(true);
  };
  const back = () => {
    stack.pop();
    render();
    if (!stack.length) pauseRun(false);
  };
  const closeAll = () => {
    stack.length = 0;
    render();
    pauseRun(false);
  };

  /** A menu screen of `items`, each picked item's id run by `pick`. */
  const menuScreen = (
    name: ScreenName,
    title: string,
    items: readonly MenuItem[],
    pick: (id: string) => void,
  ): Screen => {
    const menu: Menu = createMenu(root, items, { input, id: name, title, onPick: (_i, item) => typeof item === 'object' && item.id && pick(item.id), onCancel: () => (name === 'title' ? closeAll() : back()) }); // prettier-ignore
    return { update: (dt) => void menu.update(dt), remove: () => menu.remove() };
  };

  /** Applies a setting's row (see labs/playground/ui/settings.ts) and keeps it. */
  const change = (row: SettingRow, value: string | number | boolean) => {
    if (row.kind === 'camera') {
      const mode = PLAYGROUND_CAMERAS.find((one) => one.name === value);
      if (!mode) return;
      prefs.camera = mode.name;
      options.onView({ camera: cameraMode(camera()?.set(mode.code, { blend: true }).code ?? '')?.name ?? mode.name });
    } else if (row.kind === 'volume') {
      const bus = row.id.slice('volume:'.length) as (typeof PREF_BUSES)[number];
      prefs.volumes[bus] = Number(value);
      options.audio?.volume(bus, Number(value));
    } else {
      prefs.settings[row.id as keyof Prefs['settings']] = value;
      inspector.set(row.id, value);
      if (row.id === 'post.look') options.onView({ look: String(value) });
      if (row.id === 'playground.movement') restart(); // a sim setting read as the scene starts: recorded, replayed
    }
    keep();
  };

  /** A setting's schema, from the registry (the inspector's `describe`). */
  const schema = (path: string): RowSchema => {
    const entry = inspector.describe('setting', path) as { fields: { key: string; value: unknown }[] };
    return Object.fromEntries(entry.fields.map(({ key, value }) => [key, value])) as unknown as RowSchema;
  };
  const values = (): Record<string, string | number | boolean> => {
    const now = (path: string) => options.setting(path) as string | number | boolean;
    const out: Record<string, string | number | boolean> = { camera: cameraMode(camera()?.get().code ?? '')?.name ?? 'shooter' }; // prettier-ignore
    for (const path of ['cam.fov', 'input.sensitivity', 'input.invert', 'playground.movement', 'post.look', 'quality', 'gfx.governor']) out[path] = now(path); // prettier-ignore
    for (const bus of PREF_BUSES) out[`volume:${bus}`] = options.audio?.volume(bus) ?? 1;
    return out;
  };

  /** The owner's checks item: how many are left to do. */
  const checksItem = (): MenuItem => {
    const answers = readAnswers(options.checkStore);
    const left = OWNER_CHECKS.filter((check) => !answered(answers[check.id])).length;
    return { label: `Owner checks… (${left ? `${left} to do` : 'all answered'})`, id: 'checks' };
  };
  /** Opens `check` where it is judged: this page at its link, or another page in a new tab. */
  const go = (check: OwnerCheck) => {
    const url = checkUrl(check, location.href);
    if (check.go?.page) open(url, '_blank', 'noopener');
    else location.assign(url);
  };

  /** Makes screen `name`. */
  function make(name: ScreenName): Screen {
    if (name === 'title' || name === 'pause') {
      const items: MenuItem[] = [
        { label: name === 'title' ? 'Play' : 'Resume', id: 'play' },
        ...(name === 'title' ? [checksItem()] : []),
        ...(name === 'pause' && options.check ? [{ label: 'Answer this check…', id: 'check' }] : []),
        { label: 'Spawn…', id: 'spawns' },
        { label: 'Settings…', id: 'settings' },
        { label: 'Photo mode', id: 'photo' },
        ...(name === 'title' ? [{ label: 'Watch the tour', id: 'tour' }] : []),
        ...(name === 'pause' ? [checksItem(), { label: 'Restart', id: 'restart' }, { label: 'Title screen', id: 'title' }] : []), // prettier-ignore
      ];
      return menuScreen(name, name === 'title' ? 'The Playground' : 'Paused', items, (id) => {
        if (id === 'tour') return location.assign(attractPage(location.pathname));
        if (id === 'restart') restart();
        if (id === 'play' || id === 'restart' || id === 'title') closeAll();
        if (id === 'title') show('title');
        else if (id !== 'play' && id !== 'restart') show(id as ScreenName);
      });
    }
    if (name === 'spawns') {
      const items: MenuItem[] = [...spawnPlaces().map((place) => ({ label: place.label, id: place.id })), { label: 'Back', id: 'back' }]; // prettier-ignore
      return menuScreen('spawns', 'Spawn', items, (id) => {
        const place = spawnPlace(id);
        if (!place) return back();
        if (options.scene()?.site === 'site:block') {
          (inspector.actions as { run(name: string, args: unknown): unknown }).run('place', place.args);
          return closeAll();
        }
        const search = new URLSearchParams(location.search);
        search.set('scene', 'site');
        search.set('playground.spawn', place.id);
        location.assign(`${location.pathname}?${search}`);
      });
    }
    if (name === 'checks' || name === 'check') {
      const panel = createChecksPanel(root, {
        answers: () => readAnswers(options.checkStore),
        key: (action) => input.prompt(action),
        today: () => new Date().toISOString().slice(0, 10),
        onAnswer: (id, answer) => void saveAnswer(options.checkStore, id, answer),
        onGo: go,
        onBack: back,
        open: name === 'check' ? options.check?.id : undefined,
      });
      return {
        update: () => (input.pressed('uiCancel') || input.pressed('pause') ? panel.back() : panel.update(input)),
        remove: () => panel.remove(),
      };
    }
    if (name === 'settings') {
      const panel = createSettings(root, { values: values(), schema, input, onChange: change, onBack: back });
      return {
        update: () => void ((input.pressed('uiCancel') || input.pressed('pause')) && back()),
        remove: () => panel.remove(),
      };
    }
    photo.enter();
    return {
      update: () => void ((input.pressed('uiCancel') || input.pressed('pause')) && back()),
      remove: () => photo.leave(),
    };
  }

  // a browser spends the first Escape on the pointer lock: the lock let go while the run plays pauses it (the engine
  // lets go of it itself when the run is paused, or the map takes no lock)
  document.addEventListener('pointerlockchange', () => {
    const playing = !stack.length && options.setting('time.paused') !== true && input.bindings.map.lock;
    if (!document.pointerLockElement && playing) show('pause');
  });
  // an idle title screen opens the attract mode: any key, click or move of the pointer counts as a player there
  let idle = 0;
  const awake = () => void (idle = 0);
  for (const type of ['keydown', 'pointerdown', 'pointermove']) addEventListener(type, awake);
  const state = () => ({ screens: [...stack], paused });
  const checks = () => {
    const answers = readAnswers(options.checkStore);
    return OWNER_CHECKS.map(({ id, kind, title }) => ({ id, kind, title, verdict: answers[id]?.verdict ?? '', note: answers[id]?.note ?? '' })); // prettier-ignore
  };
  const answers = () => answersText(OWNER_CHECKS, readAnswers(options.checkStore));
  Object.assign(window, { __playgroundUi: { state, checks, answers } });
  return {
    open: (name) => show(name),
    frame(dt) {
      if (current) current.update(dt);
      else if (input.pressed('pause')) show('pause');
      idle = stack.at(-1) === 'title' && options.attract ? idle + dt : 0;
      if (idle >= ATTRACT.idle) location.assign(attractPage(location.pathname));
    },
    modal: () => stack.length > 0,
    cameraInput: () => photo.cameraInput(),
    state,
  };
}
