/**
 * @file The dialog box (PLAN.md §6.7, WP 10.6, I-50): text that types itself out a page at a time, with a speaker's
 * name and, on its last page, choices (Zelda's, Dragon Quest's, Final Fantasy's), as HTML/CSS over the overlay.
 * `createDialog(parent, { input, sound, speed, place })` makes it closed; `say(text, options)` opens it, each string a
 * page; `update(dt)` each frame types `speed` characters a second (50), reads the page's input and returns true while
 * it is open and modal, so the game waits.
 *
 * Accept (`uiAccept`: Enter, Space, the pad's south button; or a click on the box) shows the rest of a page that is
 * still typing, else turns the page, else closes it: with choices, it picks the one marked, `uiUp` and `uiDown` moving
 * the mark (held, they repeat: engine/ui/widgets.ts `createRepeat`) and a click picking one, while cancel (`uiCancel`)
 * marks the last (the "no"). `onChoice(i, choice)` then `onDone()` hear it. `auto: s` turns each typed page after `s`
 * seconds and closes after the last; `modal: false` reads no input and holds nothing back (radio chatter). Cues: `type`
 * every second character shown, `move` for the mark, `pick` on closing. A pick that changes play is the game's to send
 * as input (a dev action or a custom intent), since the system layer never reaches the intents.
 *
 * Elements: `[data-ui=dialog]` (`data-value`: `typing`, `shown` or `asking`; `data-place`), its `[data-ui=dialog-name]`
 * and `[data-ui=dialog-text]` (the characters shown), and a `[data-ui=choice]` per choice (`data-value=selected` on the
 * one marked). Invariants: presentation only; typing follows `dt` alone, so the same frames show the same text; it
 * never reads the sim. Carried from `my-3d2dge:engine/my-3d2dge.js:4194-4284` (`Dialog`: say, typing, pages, choices,
 * cancel to the last, auto, modal), the pixel-font wrap replaced by CSS.
 *
 * @example
 * // browser: the dialog needs a page
 * // const talk = createDialog(ui.root, { input, sound: (cue) => audio.play(`ui.${cue}`) });
 * // talk.say(['Hello, traveler!', 'Take the shield?'], { name: 'OLD MAN', choices: ['YES', 'NO'], onChoice: (i) => … });
 * // if (talk.update(dt)) return; // each frame: true while it is open, so play waits
 * @see engine/ui/dialog.test.ts
 * @see tests/e2e/ui.spec.ts
 */
import { codeError, defineCodes } from '../core/log';
import { createRepeat, setText, uiElement, widgetStyle, type UiInput, type UiSound } from './widgets';

/** The codes this module raises, with their fixes. */
export const DIALOG_CODES = defineCodes('ui', {
  UI_BAD_DIALOG: {
    template: 'dialog.{call}: {problem}',
    fix: "say(text, { choices }) takes a string or a list of strings, and choices as a list of strings; update(dt) takes the frame's seconds, 0 or more",
    doc: 'Raised by the dialog box (engine/ui/dialog.ts) for text that is not a string or a list of them, choices that are not, or a frame time that is not a number of seconds from 0.',
  },
});

/** Where the dialog box stands. */
export type DialogPlace = 'bottom' | 'middle' | 'top';

/** How a dialog box is made. */
export interface DialogOptions {
  /** The page's input (its system layer). */
  input: UiInput;
  /** The page's audio, for the cues; silent without. */
  sound?: UiSound;
  /** Characters typed a second (50). */
  speed?: number;
  /** Where it stands (`bottom`). */
  place?: DialogPlace;
}

/** What one `say` shows. */
export interface SayOptions {
  /** The speaker, over the box. */
  name?: string;
  /** Choices on the last page. */
  choices?: readonly string[];
  /** Seconds a typed page stays before it turns by itself; 0: it waits for accept. */
  auto?: number;
  /** False: it reads no input and holds nothing back. */
  modal?: boolean;
  /** Where it stands this time. */
  place?: DialogPlace;
  onChoice?(index: number, choice: string): void;
  onDone?(): void;
}

/** The dialog box (see the file comment). */
export interface Dialog {
  readonly el: HTMLElement;
  readonly open: boolean;
  /** Whether the page is still typing. */
  readonly typing: boolean;
  /** The page shown, from 0, and the choice marked. */
  readonly page: number;
  readonly choice: number;
  /** Opens it with `text`, one page per string (see the file comment). Throws `UI_BAD_DIALOG`. */
  say(text: string | readonly string[], options?: SayOptions): Dialog;
  /** Types and reads the input for a frame of `dt` s; true while it is open and modal. Throws `UI_BAD_DIALOG`. */
  update(dt: number): boolean;
  /** Closes it, hearing nothing. */
  close(): void;
  remove(): void;
}

/** Makes a closed dialog box in `parent` (see the file comment). */
export function createDialog(parent: HTMLElement, options: DialogOptions): Dialog {
  widgetStyle(parent.ownerDocument);
  const { input, sound = () => {} } = options;
  const speed = options.speed ?? 50;
  const el = uiElement(parent, 'ui-panel ui-dialog', 'dialog');
  const name = uiElement(el, 'ui-dialog-name', 'dialog-name');
  const text = uiElement(el, 'ui-dialog-text', 'dialog-text');
  const choicesEl = uiElement(el, 'ui-dialog-choices');
  el.append(name, text, choicesEl);
  el.hidden = true;
  parent.append(el);
  const repeat = createRepeat();
  let said: { pages: string[]; options: SayOptions } = { pages: [], options: {} };
  let [open, page, shown, choice, waited, typed] = [false, 0, 0, 0, 0, 0];

  const pageText = () => said.pages[page] ?? '';
  const last = () => page >= said.pages.length - 1;
  const asking = () => open && last() && !!said.options.choices?.length && shown >= pageText().length;
  /** The page as it stands: its text, its state and the marked choice. */
  const draw = () => {
    setText(text, pageText().slice(0, Math.floor(shown)));
    const state = shown < pageText().length ? 'typing' : asking() ? 'asking' : 'shown';
    if (el.dataset.value !== state) el.dataset.value = state;
    choicesEl.hidden = !asking();
    Array.from(choicesEl.children as HTMLCollectionOf<HTMLElement>).forEach((item, i) => {
      const value = i === choice ? 'selected' : '';
      if (item.dataset.value !== value) item.dataset.value = value;
    });
  };
  const finish = (picked: boolean) => {
    open = false;
    el.hidden = true;
    const { choices, onChoice, onDone } = said.options;
    if (!picked) return;
    sound('pick');
    if (choices?.length) onChoice?.(choice, choices[choice]);
    onDone?.();
  };
  /** Accept: the rest of the page, the next page, or the end (see the file comment). */
  const accept = () => {
    if (shown < pageText().length)
      shown = typed = pageText().length; // the rest at once, without its cues
    else if (!last()) [page, shown, waited, typed] = [page + 1, 0, 0, 0];
    else finish(true);
    if (open) draw();
  };
  const mark = (to: number) => {
    const count = said.options.choices?.length ?? 0;
    if (!count || to === choice) return;
    choice = ((to % count) + count) % count;
    sound('move');
    draw();
  };
  el.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement | null)?.closest?.('[data-ui=choice]') as HTMLElement | null;
    if (target && asking()) choice = Number(target.dataset.index);
    if (open && said.options.modal !== false) accept();
  });

  const dialog: Dialog = {
    el,
    get open() {
      return open;
    },
    get typing() {
      return open && shown < pageText().length;
    },
    get page() {
      return page;
    },
    get choice() {
      return choice;
    },
    say(content, sayOptions = {}) {
      const pages = typeof content === 'string' ? [content] : content;
      if (!Array.isArray(pages) || !pages.every((p) => typeof p === 'string')) {
        throw codeError('UI_BAD_DIALOG', { call: 'say', problem: 'its text is not a string or a list of strings' });
      }
      const { choices } = sayOptions;
      if (choices !== undefined && !(Array.isArray(choices) && choices.every((c) => typeof c === 'string'))) {
        throw codeError('UI_BAD_DIALOG', { call: 'say', problem: 'choices must be a list of strings' });
      }
      said = { pages: pages.length ? [...pages] : [''], options: sayOptions };
      [open, page, shown, choice, waited, typed] = [true, 0, 0, 0, 0, 0];
      setText(name, sayOptions.name ?? '');
      name.hidden = !sayOptions.name;
      el.dataset.place = sayOptions.place ?? options.place ?? 'bottom';
      choicesEl.textContent = '';
      (choices ?? []).forEach((label, i) => {
        const item = uiElement(choicesEl, 'ui-choice', 'choice', String(i));
        item.dataset.index = String(i);
        item.textContent = label;
        choicesEl.append(item);
      });
      el.hidden = false;
      draw();
      return dialog;
    },
    update(dt) {
      if (!(dt >= 0 && Number.isFinite(dt))) throw codeError('UI_BAD_DIALOG', { call: 'update', problem: `dt is ${dt}` }); // prettier-ignore
      if (!open) return false;
      shown = Math.min(pageText().length, shown + speed * dt);
      for (; typed + 2 <= Math.floor(shown); typed += 2) sound('type');
      const modal = said.options.modal !== false;
      const auto = said.options.auto ?? 0;
      if (auto > 0 && !said.options.choices?.length && shown >= pageText().length && (waited += dt) >= auto) {
        if (last()) finish(true);
        else [page, shown, waited, typed] = [page + 1, 0, 0, 0];
      } else if (modal) {
        if (asking() && (repeat(input, 'uiUp', dt) || repeat(input, 'uiLeft', dt))) mark(choice - 1);
        if (asking() && (repeat(input, 'uiDown', dt) || repeat(input, 'uiRight', dt))) mark(choice + 1);
        if (input.pressed('uiAccept')) accept();
        else if (asking() && input.pressed('uiCancel')) mark((said.options.choices?.length ?? 1) - 1);
      }
      if (open) draw();
      return open && modal;
    },
    close: () => finish(false),
    remove: () => el.remove(),
  };
  return dialog;
}
