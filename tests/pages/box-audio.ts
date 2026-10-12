/**
 * @file The box-audio page's module (`tests/pages/box-audio.html`), Chromium's half of tests/e2e/box-audio.spec.ts's
 * timeline test (PLAN.md WP 9.5): the fight replay played in a page with no renderer, its sim events read as the
 * box's sounds after every step (tests/pages/boxAudioTimeline.ts), exactly as Node reads them. It publishes
 * `window.__boxAudio.timeline()` and signals ready through `window.__engine`; it runs nothing until the spec calls it.
 *
 * The replay arrives as its file's text (Vite's `?raw`, never a fetch), so every number reaches the player as JSON
 * wrote it; the hall's level is the scene's own compile (`HALL_LEVEL`), as in Node.
 */
/// <reference types="vite/client" />
import fightText from '../replays/box-5-fight.replay.json?raw';
import '../../labs/box/scenes/fight';
import { HALL_LEVEL } from '../../labs/box/scenes/hall';
import { FIGHT_TIMELINE, soundTimeline } from './boxAudioTimeline';

/** What the page offers the spec. */
const boxAudio = {
  /** The fight replay's sound timeline: its count, hash, the run's last hash, the events missed and the golden. */
  timeline() {
    const { events, hash, worldHash, missed } = soundTimeline(fightText, HALL_LEVEL);
    return {
      sounds: events.length,
      hash,
      worldHash,
      missed,
      log: events.map((e) => `${e.type} ${e.sfx}`),
      FIGHT_TIMELINE,
    };
  },
};

declare global {
  interface Window {
    __boxAudio: typeof boxAudio;
  }
}

Object.assign(window, { __boxAudio: boxAudio, __engine: { ready: true, errors: [] } });
