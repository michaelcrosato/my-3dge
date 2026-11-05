/**
 * @file The playground's front end (docs/PLAYGROUND.md §8.3, PLAN.md WP 13.25; reworked at the owner's call of
 * 2026-11-03, "a UI that looks decent"): its screens over the game, each in a frame (labs/playground/ui/frame.ts) worn
 * by the theme (theme.ts), the engine's menus (engine/ui/menu.ts) and the playground's panels on a stack (closing one
 * shows the one under it again):
 * - the start menu (`title`: Play, Go to, Settings, Controls, Photo mode, Watch the tour, Owner checks, Tools), shown
 *   under the splash screen (splash.ts) as the page opens while `playground.title` says so (`auto`: unless a replay
 *   plays or automation drives the browser; `on`, `off`); Escape plays; left idle `ATTRACT.idle` seconds, it opens
 *   the attract mode (attract.ts) while `playground.attract` is `auto` and no automation drives the browser;
 * - pause (`pause`: Resume, Answer this check while one is under way, Go to, Settings, Controls, Photo mode, Owner
 *   checks, Tools, Restart, Main menu), opened by the system layer's `pause` (Escape, the pad's Start) or by the
 *   pointer lock let go while the map wants it (a browser spends the first Escape on the lock);
 * - Go to (`spawns`: the block's areas and the house's rooms, spawns.ts; M opens it in play), settings (`settings`,
 *   settings.ts), the controls sheet (`help`, help.ts; H in play), photo mode (`photo`, photo.ts), the owner's checks
 *   (`checks` on the list, `check` on the one under way: checkPanel.ts, answers to `checkStore`, Go there opening
 *   checks.ts `checkUrl`, from playground.html saying what to run for another page: `checkAway`), and Tools (`tools`,
 *   tools.ts). Each item says what it does under the menu as the cursor rests on it (frame.ts `ABOUT`), but in a
 *   window 460 px tall or less.
 * While one is open the run is paused (`__engine.pause()`) and the front end is modal (`modal()`, which the page gives
 * `createEngine`), so no key it reads reaches the run; the last closing resumes it. Escape (`uiCancel`) goes back one,
 * and plays on the start menu; each screen's footer names its keys on the device used last (frame.ts `screenKeys`),
 * and a pad works the panels as it works the menus (walk.ts: settings, the controls, Tune).
 *
 * Picks that change play are the run's recorded operations, so a replay of the run holds them: a Go to place is the
 * block's dev action `place` (`actions.run`) on a scene of the block, else the block's page opened with the pick
 * (links.ts `goToLink`, run as its first operation: `spawnOnOpen`); Restart starts the scene again on its seed
 * (`seed`); the movement profile is the sim setting `playground.movement`, set, then the scene started again; the time
 * of day and the day's length (`playground.hour`, `playground.day`) are set and, on the block, put on its clock at once
 * by its dev action `daytime` (settings.ts `clockAfter`).
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
 * @see tests/e2e/playground-ui.spec.ts
 */
import { createMenu, type CameraInput, type Engine, type EngineFrame, type Menu, type MenuItem, type Store } from '../../../engine'; // prettier-ignore
import { defineSettings } from '../../../engine/sim-api';
import { cameraMode, PLAYGROUND_CAMERAS } from '../views';
import { ATTRACT, attractPage } from './attract';
import { createChecksPanel } from './checkPanel';
import { answered, answersText, checkAway, checkUrl, OWNER_CHECKS, readAnswers, saveAnswer, type OwnerCheck } from './checks'; // prettier-ignore
import { createPhoto, type PhotoCamera } from './photo';
import { PREF_BUSES, PREF_SETTINGS, savePrefs, type Prefs } from './prefs';
import { clockAfter, createSettings, type RowSchema, type SettingRow } from './settings';
import { createTune, type LookNow } from './tune';
import { spawnPlace, spawnPlaces } from './spawns';
import { ABOUT, createFrame, screenKeys } from './frame';
import { walkPanel } from './walk';
import { createHelp } from './help';
import { goToLink, replayLink } from './links';
import { pageAbout, pageItems, pageUrl } from './pages';
import { RECORDED_RUNS } from './runs';
import { toolsItems } from './tools';

/** The start menu's view setting (see the file comment). */
export const FRONT_END_SETTINGS = defineSettings({
  'playground.title': {
    type: 'string',
    enum: ['auto', 'on', 'off'],
    default: 'auto',
    view: true,
    when: 'scene',
    description:
      "The playground page's start menu, under the splash screen (labs/playground/ui/frontEnd.ts): 'auto' shows it as the page opens unless a replay plays or automation drives the browser (navigator.webdriver: the tests, the x commands); 'on' and 'off' force it.",
  },
});

/** The screens. */
export type ScreenName =
  'title' | 'pause' | 'spawns' | 'settings' | 'help' | 'tools' | 'replays' | 'pages' | 'tune' | 'photo' | 'checks' | 'check'; // prettier-ignore

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
  /** Whether an idle start menu opens the attract mode (`playground.attract` `auto`, no automation). */
  attract?: boolean;
  /** Where the owner's answers are kept: a store that keeps them while a replay plays too. */
  checkStore: Store;
  /** The owner's check under way (`playground.check`); none without one. */
  check?: OwnerCheck;
  /** Tools' recorded runs the page plays (`?replay=<id>`), by their ids in labs/playground/ui/runs.ts. */
  replays?: readonly string[];
  /** Shows or hides the feel panel (labs/playground/feel.ts). */
  toggleFeel?: () => void;
}

/** The front end (see the file comment). */
export interface FrontEnd {
  open(screen: ScreenName): void;
  /** Goes back one screen, as Escape does (the touch menu button's tap under a screen: labs/playground/main.ts). */
  back(): void;
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

/** Whether the start menu opens with the page (see the file comment). */
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

  /** A menu screen of `items` in a frame, each picked item's id run by `pick`; `about` says what an item does. */
  const menuScreen = (
    name: ScreenName,
    title: string | null,
    items: readonly MenuItem[],
    pick: (id: string) => void,
    about: (id: string) => string = (id) => ABOUT[id] ?? '',
    kind = name === 'title' ? 'title' : 'menu',
  ): Screen => {
    const { el, body, detail, refresh } = createFrame(root, kind, title, () => screenKeys(input, kind));
    // the cursor's row scrolls into a screen taller than the window (keys and a pad move it below the fold)
    const say = (item: MenuItem | undefined) => void (detail.textContent = typeof item === 'object' && item.id ? about(item.id) : ''); // prettier-ignore
    const menu: Menu = createMenu(body, items, { input, id: name, title: title ?? 'The Playground', onMove: (_i, item) => (say(item), body.querySelector<HTMLElement>('[data-ui=item][data-value=selected]')?.scrollIntoView?.({ block: 'nearest' })), onPick: (_i, item) => typeof item === 'object' && item.id && pick(item.id), onCancel: () => (name === 'title' ? closeAll() : back()) }); // prettier-ignore
    say(items.find((item) => typeof item === 'object' && !item.disabled));
    return { update: (dt) => (refresh(), void menu.update(dt)), remove: () => (menu.remove(), el.remove()) };
  };

  /**
   * A panel screen: `make` builds the panel in a frame of `kind`; Esc (or the pad's Start) goes back, and the menus'
   * keys work the panel's controls (walk.ts).
   */
  const panelScreen = (kind: string, make: (parent: HTMLElement) => { remove(): void }): Screen => {
    const { el, body, refresh } = createFrame(root, kind, '', kind === 'side' ? '' : () => screenKeys(input, kind));
    const panel = make(body);
    return {
      update: () => (refresh(), input.pressed('uiCancel') || input.pressed('pause') ? back() : walkPanel(body, input)),
      remove: () => (panel.remove(), el.remove()),
    };
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
      const clock = clockAfter(row.id, value, options.setting); // Time of day, Day length: the block's clock, live, recorded
      if (clock && options.scene()?.site === 'site:block') (inspector.actions as { run(name: string, args: unknown): unknown }).run('daytime', clock); // prettier-ignore
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
    for (const path of PREF_SETTINGS) out[path] = now(path);
    for (const bus of PREF_BUSES) out[`volume:${bus}`] = options.audio?.volume(bus) ?? 1;
    return out;
  };

  /** The owner's checks item: how many are left to do. */
  const checksItem = (): MenuItem => {
    const answers = readAnswers(options.checkStore);
    const left = OWNER_CHECKS.filter((check) => !answered(answers[check.id])).length;
    return { label: `Owner checks${left ? ` (${left} to do)` : ''}…`, id: 'checks' };
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
      const title = name === 'title';
      const items: MenuItem[] = [
        { label: title ? 'Play' : 'Resume', id: 'play' },
        ...(!title && options.check ? [{ label: 'Answer this check…', id: 'check' }] : []),
        { label: 'Go to…', id: 'spawns' },
        { label: 'Settings', id: 'settings' },
        { label: 'Controls', id: 'help' },
        { label: 'Photo mode', id: 'photo' },
        ...(title ? [{ label: 'Watch the tour', id: 'tour' }] : []),
        checksItem(),
        { label: 'Tools…', id: 'tools' },
        ...(!title
          ? [
              { label: 'Restart', id: 'restart' },
              { label: 'Main menu', id: 'title' },
            ]
          : []),
      ];
      return menuScreen(name, title ? null : 'Paused', items, (id) => {
        if (id === 'tour') return location.assign(attractPage(location.pathname));
        if (id === 'restart') restart();
        if (id === 'play' || id === 'restart' || id === 'title') closeAll();
        if (id === 'title') show('title');
        else if (id !== 'play' && id !== 'restart') show(id as ScreenName);
      });
    }
    if (name === 'tools') {
      const items = toolsItems({ replays: !!options.replays?.length, feel: !!options.toggleFeel });
      return menuScreen('tools', 'Tools', items, (id) => {
        if (id === 'back') return back();
        if (id === 'feel') return (options.toggleFeel?.(), closeAll());
        show(id as ScreenName);
      });
    }
    if (name === 'replays') {
      const runs = RECORDED_RUNS.filter((run) => options.replays?.includes(run.id)); // each by its name, on the block
      const items: MenuItem[] = [...runs.map(({ label, id }) => ({ label, id })), { label: 'Back', id: 'back' }];
      const about = (id: string) => runs.find((run) => run.id === id)?.about ?? '';
      return menuScreen('replays', 'Recorded runs', items, (id) => {
        if (id === 'back') return back();
        location.assign(replayLink(location, id));
      }, about, 'list'); // prettier-ignore
    }
    if (name === 'pages') {
      const here = location.href; // each a page of its own beside the block, opened in a new tab
      const pick = (id: string) => (id === 'back' ? back() : void open(pageUrl(id, here), '_blank', 'noopener'));
      return menuScreen('pages', 'The Stress Box and the labs', [...pageItems(here), { label: 'Back', id: 'back' }], pick, (id) => pageAbout(id, here), 'list'); // prettier-ignore
    }
    if (name === 'spawns') {
      const places = spawnPlaces();
      const group = (name: 'area' | 'room') => places.filter((place) => place.group === name).map(({ label, id }) => ({ label, id })); // prettier-ignore
      const items: MenuItem[] = [
        { label: 'Areas of the block', disabled: true },
        ...group('area'),
        { label: 'Rooms of the house', disabled: true },
        ...group('room'),
        { label: 'Back', id: 'back' },
      ];
      const about = (id: string) => spawnPlace(id)?.about ?? '';
      return menuScreen('spawns', 'Go to', items, (id) => {
        const place = spawnPlace(id);
        if (!place) return back();
        if (options.scene()?.site === 'site:block') {
          (inspector.actions as { run(name: string, args: unknown): unknown }).run('place', place.args);
          return closeAll();
        }
        location.assign(goToLink(location, place.id));
      }, about, 'list'); // prettier-ignore
    }
    if (name === 'checks' || name === 'check') {
      const { el, body } = createFrame(root, 'panel', '', '');
      const panel = createChecksPanel(body, {
        answers: () => readAnswers(options.checkStore),
        key: (action) => input.prompt(action),
        today: () => new Date().toISOString().slice(0, 10),
        onAnswer: (id, answer) => void saveAnswer(options.checkStore, id, answer),
        onGo: go,
        away: (check) => checkAway(check, location.href),
        onBack: back,
        open: name === 'check' ? options.check?.id : undefined,
      });
      return {
        update: () => (input.pressed('uiCancel') || input.pressed('pause') ? panel.back() : panel.update(input)),
        remove: () => (panel.remove(), el.remove()),
      };
    }
    if (name === 'settings') {
      return panelScreen('panel', (parent) => createSettings(parent, { values: values(), schema, input, onChange: change, onBack: back })); // prettier-ignore
    }
    if (name === 'help') return panelScreen('panel', (parent) => createHelp(parent, { input, onBack: back }));
    if (name === 'tune') {
      const look = () => (inspector as unknown as { look(): LookNow }).look();
      const looks = (inspector.describe('look') as { ids: string[] }).ids;
      return panelScreen('side', (parent) => createTune(parent, { now: look, looks, get: options.setting, set: (path, value) => void inspector.set(path, value), onBack: back })); // prettier-ignore
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
  // an idle start menu opens the attract mode: any key, click or move of the pointer counts as a player there, heard
  // in the capture phase before the splash's (made later), which keeps the key that starts from the page
  let idle = 0;
  const awake = () => void (idle = 0);
  for (const type of ['keydown', 'pointerdown', 'pointermove']) addEventListener(type, awake, true);
  const state = () => ({ screens: [...stack], paused });
  const checks = () => {
    const answers = readAnswers(options.checkStore);
    return OWNER_CHECKS.map(({ id, kind, title }) => ({ id, kind, title, verdict: answers[id]?.verdict ?? '', note: answers[id]?.note ?? '' })); // prettier-ignore
  };
  const answers = () => answersText(OWNER_CHECKS, readAnswers(options.checkStore));
  Object.assign(window, { __playgroundUi: { state, checks, answers } });
  return {
    open: (name) => show(name),
    back: () => void (stack.length && back()),
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
