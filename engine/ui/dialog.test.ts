/**
 * @file Unit tests for engine/ui/dialog.ts (T1, PLAN.md WP 10.6) over the stand-in DOM: the text types at its speed and
 * accept shows the rest, turns the page and closes; choices are marked with the directions (held, they repeat), cancel
 * marks the last, and a click picks one; `auto` turns and closes by itself; a dialog that is not modal reads no input;
 * the cues; bad text and times are coded errors.
 * @see engine/ui/dialog.ts
 */
import { describe, expect, it } from 'vitest';
import type { FakeElement } from '../../tests/unit/ui/fakeDom';
import { fakeInput, overlay } from '../../tests/unit/ui/uiKit';
import { createDialog } from './dialog';
import type { UiCue } from './widgets';

/** A dialog in a fresh overlay, its input, the cues it asked for, and a frame of `dt` s after a press of `action`. */
function setup() {
  const input = fakeInput();
  const cues: UiCue[] = [];
  const talk = createDialog(overlay().root, { input, sound: (cue) => cues.push(cue), speed: 20 });
  const frame = (dt = 0.05, action?: string) => {
    if (action) input.press(action);
    const holding = talk.update(dt);
    input.frame();
    if (action) input.release(action);
    return holding;
  };
  const shown = () => talk.el.querySelector('[data-ui=dialog-text]')!.textContent;
  return { talk, input, cues, frame, shown };
}

describe('the dialog box', () => {
  it('types at its speed; accept shows the rest, turns the page, then closes', () => {
    const { talk, frame, shown, cues } = setup();
    let done = 0;
    talk.say(['Hello, traveler!', 'Go.'], { name: 'OLD MAN', onDone: () => done++ });
    expect([talk.open, talk.el.hidden, talk.el.dataset.value, shown()]).toEqual([true, false, 'typing', '']);
    expect(frame(0.25)).toBe(true); // 5 characters at 20 a second
    expect(shown()).toBe('Hello');
    frame(0, 'uiAccept');
    expect([shown(), talk.el.dataset.value]).toEqual(['Hello, traveler!', 'shown']);
    frame(0, 'uiAccept');
    expect([talk.page, shown()]).toEqual([1, '']);
    frame(1);
    expect(frame(0, 'uiAccept')).toBe(false);
    expect([talk.open, talk.el.hidden, done]).toEqual([false, true, 1]);
    expect(cues.filter((cue) => cue === 'type')).toHaveLength(3); // every second character typed: 'Hello' 2, 'Go.' 1
    expect(cues.at(-1)).toBe('pick');
  });

  it('marks a choice with the directions, held ones repeating; cancel marks the last; accept picks it', () => {
    const { talk, input, frame } = setup();
    const picks: [number, string][] = [];
    talk.say('Take the shield?', { choices: ['YES', 'NO', 'LATER'], onChoice: (i, c) => picks.push([i, c]) });
    frame(0, 'uiDown'); // still typing: the mark waits
    frame(5);
    expect(talk.el.dataset.value).toBe('asking');
    frame(0, 'uiDown');
    expect(talk.choice).toBe(1);
    input.press('uiDown');
    for (let i = 0; i < 25; i++) frame(1 / 60); // held past 0.35 s: it repeats
    input.release('uiDown');
    expect(talk.choice).toBe(0); // 1 → 2 → 0, round the end
    frame(0, 'uiCancel');
    expect(talk.choice).toBe(2);
    const choices = (talk.el as unknown as FakeElement).querySelectorAll('[data-ui=choice]');
    expect(choices.map((c) => [c.textContent, c.dataset.value])).toEqual([['YES', ''], ['NO', ''], ['LATER', 'selected']]); // prettier-ignore
    frame(0, 'uiAccept');
    expect(picks).toEqual([[2, 'LATER']]);
  });

  it('picks a choice clicked, and shows the rest of a page clicked while it types', () => {
    const { talk, frame, shown } = setup();
    const picks: number[] = [];
    talk.say('Which way?', { choices: ['LEFT', 'RIGHT'], onChoice: (i) => picks.push(i) });
    (talk.el as unknown as FakeElement).click();
    expect(shown()).toBe('Which way?');
    frame(0);
    (talk.el as unknown as FakeElement).querySelectorAll('[data-ui=choice]')[1].click();
    expect([picks, talk.open]).toEqual([[1], false]);
  });

  it('turns its pages by itself with auto, and reads no input when not modal', () => {
    const { talk, frame } = setup();
    let done = false;
    talk.say(['Radio check.', 'Over.'], { auto: 1, modal: false, onDone: () => (done = true) });
    expect(frame(0, 'uiAccept')).toBe(false); // not modal: play goes on, accept ignored
    expect(talk.page).toBe(0);
    for (let i = 0; i < 40 && talk.open; i++) frame(0.1);
    expect([talk.open, done]).toEqual([false, true]);
  });

  it('refuses text and times it cannot take, and close() closes hearing nothing', () => {
    const { talk } = setup();
    expect(() => talk.say(3 as never)).toThrow(/UI_BAD_DIALOG/);
    expect(() => talk.say('Hi', { choices: [1] as never })).toThrow(/choices must be a list of strings/);
    let done = false;
    talk.say('Hi', { onDone: () => (done = true) });
    expect(() => talk.update(-1)).toThrow(/dt is -1/);
    talk.close();
    expect([talk.open, done, talk.update(0.1)]).toEqual([false, false, false]);
  });
});
