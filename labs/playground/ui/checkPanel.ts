/**
 * @file The owner's checks screen (PLAN.md WP 13.28): a panel over the game, in the look of the engine's menus, with
 * three views:
 * - the list (`list`): a line on what the checks are for, then the decisions and the try checks, each marked by its
 *   answer (✓ settled, ✗ needs work, – skipped, • to do), then Copy my answers and Back;
 * - a check (`check:<id>`): what to try and judge (its `{action}`s as the player's keys, `key`), where it comes from,
 *   for a decision the call already taken, Go there when it has a place to go, the verdicts (a decision's choices,
 *   or labs/playground/ui/checks.ts's `TRY_VERDICTS`), a note, Next check (the next one to do) and Back;
 * - the answers (`answers`): `answersText` in a box, a Copy button (the clipboard, else the text selected for the
 *   player's own copy) and Forget my answers, which asks again before it forgets.
 * A verdict or a note calls `onAnswer` at once (the front end keeps it in the store); Go there calls `onGo`. `back()`
 * goes back to the list from a check or the answers, and otherwise (the list, or the check it opened on) `onBack`.
 * `update(input)`, each frame, works it as a menu is worked: `uiUp` and `uiDown` (the arrows, the pad's D-pad and
 * stick) move the focus over its buttons, round the ends, and `uiAccept` (Enter, Space, the pad's south button)
 * presses the one focused; a view shown while the focus was in the panel focuses its first button. A key typed in the note reaches nothing else: the
 * page's own keys (P, F, M) listen on the window, and the devices skip keys typed into a field.
 *
 * Elements: `[data-ui=checks]` (`data-value` the view), a `[data-ui=item]` per button (`data-id`: `check:<id>`,
 * `go`, `verdict:<id>`, `next`, `answers`, `copy`, `forget`, `back`; `data-value` a check's verdict in the list,
 * `selected` on the verdict given, `sure` on Forget asking again), the note `[data-ui=check-note]` and the answers'
 * text `[data-ui=answers-text]`.
 *
 * Invariants: presentation only: it shows the checks and reports answers and picks; it keeps and changes nothing.
 *
 * Game code, a page's: it imports only the playground's own files.
 *
 * @example
 * // browser: the panel needs a page
 * // const panel = createChecksPanel(ui.root, { answers: () => readAnswers(store), key: (a) => input.prompt(a), … });
 * // document.querySelector('[data-ui=item][data-id="check:sprint"]').click(); // the sprint's view, Go there in it
 * @see tests/e2e/playground-ui.spec.ts
 */
import type { UiInput } from '../../../engine';
import { answered, answersText, OWNER_CHECKS, TRY_VERDICTS, type CheckAnswer, type OwnerCheck } from './checks';

/** How the panel is made. */
export interface ChecksPanelOptions {
  /** The answers now, by check. */
  answers(): Readonly<Record<string, CheckAnswer>>;
  /** The player's key for `action`, empty for none. */
  key(action: string): string;
  /** The day an answer is given (`2026-10-26`). */
  today(): string;
  onAnswer(id: string, answer: CheckAnswer | null): void;
  onGo(check: OwnerCheck): void;
  onBack(): void;
  /** The check it opens on; the list when none. */
  open?: string;
}

/** The checks screen. */
export interface ChecksPanel {
  readonly el: HTMLElement;
  /** The view shown: `list`, `check:<id>` or `answers`. */
  view(): string;
  /** Goes back a view; from the view it opened on, calls `onBack`. */
  back(): void;
  /** Reads a frame's input: the focus moved over the buttons, the focused one pressed (see the file comment). */
  update(input: UiInput): void;
  remove(): void;
}

/** The list's two sections: the kind and its heading. */
const SECTIONS = [
  ['decide', 'Your decisions: calls made while you were away'],
  ['try', 'Try it and judge'],
] as const;

/** The marks of an answer in the list. */
const MARKS: Readonly<Record<string, string>> = { 'needs-work': '✗', skip: '–' };

/** The panel's stylesheet: one column of buttons, scrolling when taller than the game. */
const STYLE = `
.pg-checks { left: 50%; top: 50%; transform: translate(-50%, -50%); max-height: 88%; overflow-y: auto; width: min(640px, 94%); }
.pg-checks button { font: inherit; display: block; width: 100%; text-align: left; margin: 0.2em 0; }
.pg-checks button[data-value=selected] { outline: 2px solid currentColor; }
.pg-checks button:focus { outline: 2px dashed currentColor; outline-offset: 2px; }
.pg-checks h3 { margin: 0.8em 0 0.3em; font-size: 1em; }
.pg-checks p { margin: 0.4em 0; line-height: 1.35; }
.pg-checks .pg-small { font-size: 0.85em; opacity: 0.8; }
.pg-checks textarea { font: inherit; width: 100%; box-sizing: border-box; min-height: 4.5em; }
`;

/** Makes the checks screen in `parent` (see the file comment). */
export function createChecksPanel(parent: HTMLElement, options: ChecksPanelOptions): ChecksPanel {
  const doc = parent.ownerDocument;
  if (!doc.getElementById('pg-checks-style')) doc.head.append(Object.assign(doc.createElement('style'), { id: 'pg-checks-style', textContent: STYLE })); // prettier-ignore
  const el = Object.assign(doc.createElement('div'), { className: 'ui-panel ui-box pg-checks' });
  el.dataset.ui = 'checks';
  parent.append(el);
  const first = options.open && OWNER_CHECKS.some((check) => check.id === options.open) ? `check:${options.open}` : 'list'; // prettier-ignore
  let view = '';

  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}) =>
    el.appendChild(Object.assign(doc.createElement(tag), props) as HTMLElementTagNameMap[K]);
  const button = (id: string, text: string, click: () => void, value = '') => {
    const made = make('button', { type: 'button', textContent: text });
    [made.dataset.ui, made.dataset.id, made.dataset.value] = ['item', id, value];
    made.addEventListener('click', click);
    return made;
  };
  /** A field whose keys reach nothing else; Escape lets go of it. */
  const field = <T extends HTMLElement>(made: T) => {
    made.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if ((event as KeyboardEvent).key === 'Escape') made.blur();
    });
    return made;
  };
  const words = (text: string) => text.replace(/\{(\w+)\}/g, (_, action: string) => options.key(action) || action);
  /** The next check to do after `id`, round the list; none when every other is settled. */
  const nextToDo = (id: string) => {
    const at = OWNER_CHECKS.findIndex((check) => check.id === id);
    const answers = options.answers();
    const order = [...OWNER_CHECKS.slice(at + 1), ...OWNER_CHECKS.slice(0, at)];
    return order.find((check) => !answered(answers[check.id]));
  };

  /** The panel's buttons, in order. */
  const buttons = () => [...el.querySelectorAll<HTMLButtonElement>('button[data-ui=item]')];

  /** Shows `next` (see the file comment). */
  function show(next: string): void {
    const focused = el.contains(doc.activeElement);
    view = next;
    el.dataset.value = next;
    el.replaceChildren();
    if (next === 'list') list();
    else if (next === 'answers') answersView();
    else checkView(OWNER_CHECKS.find((check) => `check:${check.id}` === next)!);
    if (focused) buttons()[0]?.focus();
  }

  /** Moves the focus `step` buttons on, round the ends (from none: the first, or the last going back). */
  function move(step: number): void {
    const all = buttons();
    const at = all.indexOf(doc.activeElement as HTMLButtonElement);
    const next = all[((at < 0 ? (step > 0 ? -1 : 0) : at) + step + all.length) % all.length];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  }

  function list(): void {
    const answers = options.answers();
    make('h2', { textContent: 'Owner checks' });
    make('p', { textContent: 'What only you can judge. Pick one: it says what to try and what to judge, and takes you there. Your answers stay in this browser; when you are done, Copy my answers and paste them to Claude in the chat.' }); // prettier-ignore
    for (const [kind, heading] of SECTIONS) {
      make('h3', { textContent: heading });
      for (const check of OWNER_CHECKS.filter((one) => one.kind === kind)) {
        const verdict = answers[check.id]?.verdict ?? '';
        const mark = verdict ? (MARKS[verdict] ?? '✓') : '•';
        button(`check:${check.id}`, `${mark} ${check.title}`, () => show(`check:${check.id}`), verdict);
      }
    }
    make('h3', { textContent: 'When you are done' });
    button('answers', 'Copy my answers…', () => show('answers'));
    button('back', 'Back', () => back());
  }

  function checkView(check: OwnerCheck): void {
    const answer = options.answers()[check.id];
    make('h2', { textContent: check.title });
    make('p', { textContent: words(check.what) });
    make('p', { className: 'pg-small', textContent: `From ${check.from}.` });
    if (check.options) make('p', { textContent: `Done while you were away: ${check.options[0].label}.` });
    if (check.go) button('go', check.go.page ? 'Open it (a new tab)' : 'Go there', () => options.onGo(check));
    make('h3', { textContent: check.kind === 'decide' ? 'Your call' : 'Your verdict' });
    const note = field(Object.assign(doc.createElement('textarea'), { placeholder: 'A note (optional): what felt off, what you would change', value: answer?.note ?? '' })); // prettier-ignore
    note.dataset.ui = 'check-note';
    const save = (verdict: string) => options.onAnswer(check.id, { verdict, note: note.value, at: options.today() });
    for (const choice of check.options ?? TRY_VERDICTS) {
      const pick = button(`verdict:${choice.id}`, choice.label, () => {
        save(choice.id);
        for (const other of el.querySelectorAll<HTMLElement>('[data-id^="verdict:"]')) other.dataset.value = '';
        pick.dataset.value = 'selected';
      }, answer?.verdict === choice.id ? 'selected' : ''); // prettier-ignore
    }
    el.append(note);
    note.addEventListener('input', () => save(options.answers()[check.id]?.verdict ?? ''));
    const next = nextToDo(check.id);
    if (next) button('next', `Next check: ${next.title}`, () => show(`check:${next.id}`));
    button('back', 'Back', () => back());
  }

  function answersView(): void {
    make('h2', { textContent: 'My answers' });
    make('p', { textContent: 'Copy this and paste it to Claude in the chat: each decision is recorded and each note tuned from.' }); // prettier-ignore
    const text = field(make('textarea', { readOnly: true, value: answersText(OWNER_CHECKS, options.answers()) }));
    text.dataset.ui = 'answers-text';
    text.style.minHeight = '12em';
    const status = make('p', { className: 'pg-small' });
    button('copy', 'Copy', () => {
      text.select();
      const done = () => void (status.textContent = 'Copied: paste it in the chat.');
      const own = () => void (status.textContent = 'Selected: copy it with Ctrl+C (⌘C on a Mac).');
      void (navigator.clipboard?.writeText(text.value).then(done, own) ?? own());
    });
    const forget = button('forget', 'Forget my answers', () => {
      if (forget.dataset.value !== 'sure') {
        [forget.dataset.value, forget.textContent] = ['sure', 'Forget every answer? Click again to forget them'];
        return;
      }
      for (const check of OWNER_CHECKS) options.onAnswer(check.id, null);
      show('answers');
    });
    button('back', 'Back', () => back());
  }

  function back(): void {
    if (first === 'list' && view !== 'list') show('list');
    else options.onBack();
  }

  show(first);
  return {
    el,
    view: () => view,
    back,
    update(input) {
      const step = (input.pressed('uiDown') ? 1 : 0) - (input.pressed('uiUp') ? 1 : 0);
      if (step) return move(step);
      const at = buttons().indexOf(doc.activeElement as HTMLButtonElement);
      if (at >= 0 && input.pressed('uiAccept')) buttons()[at].click();
    },
    remove: () => el.remove(),
  };
}
