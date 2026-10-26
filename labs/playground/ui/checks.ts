/**
 * @file The owner's checks (docs/PLAYGROUND.md §9.3, PLAN.md WP 13.28; the owner's direction of 2026-10-26): what only
 * the owner can judge, listed in the game, each saying in plain words what to try and what to judge, and taking them
 * there. The list, `OWNER_CHECKS`, is labs/playground/ui/checkList.ts; it holds two kinds:
 * - `decide`: a call an agent made in the owner's absence (an escalation still awaiting review, docs/escalations/),
 *   its choices in plain words, the first the call already taken, each naming the record's option;
 * - `try`: a feel, a look, a sound or a device no number here judges (docs/PLAYGROUND.md §9.3's playtest, and what
 *   docs/PROGRESS.md names as not verifiable here), judged good, needing work (with a note) or skipped.
 *
 * A check's `go` names where it is judged: the playground's own page with a query (a scene, a camera, a look, a
 * setting) and a spot to stand (`place`, the block's and the gym's dev action, run as the page's first operation, so
 * the run records it), or another page of the repository, opened in a new tab. `checkUrl` builds the link: on the
 * playground it adds the view setting `playground.check`, which names the check under way (the HUD's line, pause's
 * Answer item), and leaves the title screen off unless the check is about it. A check's text names keys as
 * `{action}`, which the panel shows as the player's own binding (`input.prompt`).
 *
 * The answers stay in the page's store under `CHECKS_KEY` (`readAnswers`, `saveAnswer`), never in the run; the panel
 * (labs/playground/ui/checkPanel.ts) shows them, and `answersText` writes them as text to paste back to an agent, who
 * records each decision (`node x esc answer ESC-NNNN "…"`) and tunes from the notes.
 *
 * Invariants: an agent who escalates adds the record's decide check here, and one who leaves the owner something to
 * judge by eye, ear or hand adds a try check, each in plain words (checkList.ts); the test holds the decide checks to
 * the records awaiting review and the try checks to every item of §9.3's playtest.
 *
 * Game code, a page's: it imports only the engine's public API (engine/index.ts, engine/sim-api.ts's settings) and the
 * playground's own files.
 *
 * @example
 * checkUrl(ownerCheck('sprint')!, 'http://127.0.0.1:5173/labs/playground/');
 * // 'http://127.0.0.1:5173/labs/playground/?scene=gym&cam3=first&playground.title=off&playground.check=sprint'
 * checkUrl(ownerCheck('labs')!, 'http://127.0.0.1:5173/labs/playground/'); // 'http://127.0.0.1:5173/labs/index/'
 * answersText(OWNER_CHECKS, { sprint: { verdict: 'good', note: '', at: '2026-10-26' } }).split('\n')[2];
 * // '- sprint (docs/PLAYGROUND.md §9.3, item 1), Sprint the strip, in first person: Good as it is (2026-10-26)'
 * @see labs/playground/ui/checks.test.ts
 */
import type { Engine, EngineFrame, Store } from '../../../engine';
import { defineSettings } from '../../../engine/sim-api';
import { OWNER_CHECKS, type OwnerCheck } from './checkList';

export { OWNER_CHECKS, type OwnerCheck } from './checkList';

/** An answer: the verdict (a try check's `TRY_VERDICTS` id, a decide check's option id), a note, and its day. */
export interface CheckAnswer {
  readonly verdict: string;
  readonly note: string;
  readonly at: string;
}

/** A try check's verdicts. */
export const TRY_VERDICTS = [
  { id: 'good', label: 'Good as it is' },
  { id: 'needs-work', label: 'Needs work (say what in the note)' },
  { id: 'skip', label: 'Skip for now' },
] as const;

/** The store's key for the answers. */
export const CHECKS_KEY = 'checks';

/** The view setting naming the check under way (see the file comment). */
export const CHECK_SETTINGS = defineSettings({
  'playground.check': {
    type: 'string',
    enum: ['', ...OWNER_CHECKS.map((check) => check.id)],
    default: '',
    view: true,
    when: 'scene',
    description:
      "The owner's check under way on the playground page (labs/playground/ui/checks.ts): its id, which the HUD names and pause offers to answer; the page puts the player at the check's spot as it opens. Empty: none.",
  },
});

/** The check `id`; undefined for none. */
export function ownerCheck(id: string | null | undefined): OwnerCheck | undefined {
  return OWNER_CHECKS.find((check) => check.id === id);
}

/** The link that opens `check` where it is judged, from the playground page at `here` (see the file comment). */
export function checkUrl(check: OwnerCheck, here: string): string {
  const query = new URLSearchParams(check.go?.query ?? {});
  if (check.go?.page) return new URL(`../../${check.go.page}${query.size ? `?${query}` : ''}`, here).href;
  if (!query.has('playground.title')) query.set('playground.title', 'off');
  query.set('playground.check', check.id);
  const url = new URL(here);
  [url.search, url.hash] = [`?${query}`, ''];
  return url.href;
}

/** The answers kept in `store`, each of a known check and of its shape. */
export function readAnswers(store: Store): Record<string, CheckAnswer> {
  const kept = store.get<Record<string, Partial<CheckAnswer>>>(CHECKS_KEY, {});
  const out: Record<string, CheckAnswer> = {};
  for (const [id, answer] of Object.entries(kept && typeof kept === 'object' ? kept : {})) {
    const { verdict, note, at } = answer ?? {};
    if (ownerCheck(id) && typeof verdict === 'string' && typeof note === 'string' && typeof at === 'string') {
      out[id] = { verdict, note, at };
    }
  }
  return out;
}

/** Keeps `answer` to check `id` in `store` (null forgets it); false when the store refused it. */
export function saveAnswer(store: Store, id: string, answer: CheckAnswer | null): boolean {
  const answers = readAnswers(store);
  if (answer) answers[id] = answer;
  else delete answers[id];
  return store.set(CHECKS_KEY, answers);
}

/** Whether `answer` settles its check: a verdict given. */
export const answered = (answer: CheckAnswer | undefined): boolean => !!answer?.verdict;

/** The words of `check`'s verdict `verdict`, its option named for a decide check. */
export function verdictLabel(check: OwnerCheck, verdict: string): string {
  const option = check.options?.find((one) => one.id === verdict);
  if (option) return `option ${option.option}: ${option.label}`;
  return TRY_VERDICTS.find((one) => one.id === verdict)?.label ?? verdict;
}

/** The answers as text to paste back to an agent: the decisions, then the try checks, then what is left. */
export function answersText(checks: readonly OwnerCheck[], answers: Readonly<Record<string, CheckAnswer>>): string {
  const done = checks.filter((check) => answered(answers[check.id]));
  const line = (check: OwnerCheck) => {
    const { verdict, note, at } = answers[check.id];
    const head = check.kind === 'decide' ? `${check.from}, ${check.title}` : `${check.id} (${check.from}), ${check.title}`; // prettier-ignore
    return `- ${head}: ${verdictLabel(check, verdict)}${note.trim() ? `. Note: ${note.trim()}` : ''} (${at})`;
  };
  const kind = (which: OwnerCheck['kind']) => done.filter((check) => check.kind === which).map(line);
  const left = checks.filter((check) => !answered(answers[check.id])).map((check) => check.id);
  return [
    `My answers to the owner checks: ${done.length} of ${checks.length}, from labs/playground/ui/checks.ts.`,
    ...(kind('decide').length ? ['Decisions:', ...kind('decide')] : []),
    ...(kind('try').length ? ['Tried:', ...kind('try')] : []),
    left.length ? `Not answered yet: ${left.join(', ')}.` : 'Every check answered.',
  ].join('\n');
}

/** The HUD's line while `check` is under way. */
export const checkLine = (check: OwnerCheck): string => `Checking: ${check.title} · Esc, then Answer this check`;

/** Puts the player at `check`'s spot once its scene is up (the dev action `place`, recorded); false when none ran. */
export function placeOnOpen(engine: Engine, check: OwnerCheck | undefined, scene: EngineFrame['scene']): boolean {
  const place = check?.go?.place;
  if (!place || scene.id !== `playground:${check.go?.query?.scene}` || !engine.inspector) return false;
  (engine.inspector.actions as { run(name: string, args: unknown): unknown }).run('place', { at: [...place.at], yaw: place.yaw }); // prettier-ignore
  return true;
}
