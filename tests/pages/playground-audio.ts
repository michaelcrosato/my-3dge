/**
 * @file The playground-audio page's module (`tests/pages/playground-audio.html`), Chromium's half of
 * tests/e2e/playground-audio.spec.ts's timeline test (PLAN.md WP 13.22): the house replay played in a page with no
 * renderer, its sim events read as the playground's sounds after every step (tests/pages/playgroundAudioTimeline.ts),
 * exactly as Node reads them. It publishes `window.__playgroundAudio.timeline()` and signals ready through
 * `window.__engine`; it runs nothing until the spec calls it.
 *
 * The replay arrives as its file's text (Vite's `?raw`, never a fetch), so every number reaches the player as JSON
 * wrote it; the ground is the site's (`SITE_GROUND`), as in Node.
 */
/// <reference types="vite/client" />
import siteText from '../replays/playground-site.replay.json?raw';
import '../../labs/playground/bodies/player';
import '../../labs/playground/scenes/site';
import { SITE_GROUND } from '../../labs/playground/sounds/ground';
import { SITE_TIMELINE, soundTimeline } from './playgroundAudioTimeline';

/** What the page offers the spec. */
const playgroundAudio = {
  /** The house replay's sound timeline: its count, hash, the run's last hash, the events missed and the golden. */
  timeline() {
    const { events, hash, worldHash, missed } = soundTimeline(siteText, SITE_GROUND);
    return {
      sounds: events.length,
      hash,
      worldHash,
      missed,
      log: events.map((e) => `${e.type} ${e.sfx}`),
      SITE_TIMELINE,
    };
  },
};

declare global {
  interface Window {
    __playgroundAudio: typeof playgroundAudio;
  }
}

Object.assign(window, { __playgroundAudio: playgroundAudio, __engine: { ready: true, errors: [] } });
