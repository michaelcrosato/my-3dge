/**
 * @file Tests for the starter game's best round (labs/game/best.ts, PLAN.md WP 10.9's Done-when: "the starter game keeps
 * its best round through it"): the fastest won round is kept through the engine's store, beaten only by a faster one,
 * read back by a page opened later on the same storage, and never written by a replay's page (the store's demo mode).
 */
import { describe, expect, it } from 'vitest';
import { createStore, memoryBackend } from '../../engine';
import { bestOf, recordBest } from './best';

describe("the starter game's best round", () => {
  it('keeps the fastest won round across pages, and a replay never sets one', () => {
    const backend = memoryBackend(); // the page's localStorage, across reloads
    const first = createStore({ prefix: 'my3dge-game:', backend });
    expect(bestOf(first)).toBeNull();
    expect([recordBest(first, 14.2), recordBest(first, 16), recordBest(first, 9.5)]).toEqual([14.2, 14.2, 9.5]);
    const later = createStore({ prefix: 'my3dge-game:', backend }); // the page opened again
    expect(bestOf(later)).toBe(9.5);
    const replay = createStore({ prefix: 'my3dge-game:', backend, mode: 'demo' });
    expect([bestOf(replay), recordBest(replay, 3)]).toEqual([null, 3]);
    expect(bestOf(createStore({ prefix: 'my3dge-game:', backend }))).toBe(9.5);
  });
});
