/**
 * @file Unit tests for labs/playground/ui/checks.ts and checkList.ts (WP 13.28): the list stands for every escalation
 * awaiting the owner's review and every item of docs/PLAYGROUND.md §9.3's playtest, its choices naming the records'
 * options and its text naming keys the maps have; each check's link opens a page that parses (`parseRoutes`) or a
 * page the repository has; each spot to stand holds the player there through the scene's recorded dev action `place`;
 * the answers keep only what is of their shape, and come out as the text to paste back.
 * @see labs/playground/ui/checks.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless, createStore, getActionMap, memoryBackend, parseRoutes } from '../../../engine';
import { readRecords } from '../../../tools/lib/escalations';
import '../bodies/player';
import { PLAYGROUND_MAPS } from '../controls';
import '../looks/cel';
import '../looks/pixel';
import { gym } from '../scenes/gym';
import { hill } from '../scenes/hill';
import { SITE_SCENES } from '../scenes/site';
import '../weather';
import './attract';
import { answersText, CHECKS_KEY, checkUrl, OWNER_CHECKS, ownerCheck, readAnswers, saveAnswer } from './checks';
import './frontEnd';
import { PREFS_PREFIX } from './prefs';

/** The repository's root. */
const ROOT = new URL('../../../', import.meta.url).pathname;

/** The playground's page, as a browser reaches it. */
const HERE = 'http://127.0.0.1:5173/labs/playground/';

/** Every scene the playground page offers. */
const SCENES = [gym, hill, ...Object.values(SITE_SCENES)];

/** A store in memory, under the playground's prefix. */
const memory = () => createStore({ prefix: PREFS_PREFIX, backend: memoryBackend() });

describe('the owner’s checks', () => {
  it('stands for each escalation awaiting review, its choices naming the record’s options', () => {
    expect(new Set(OWNER_CHECKS.map((check) => check.id)).size).toBe(OWNER_CHECKS.length);
    const awaiting = readRecords(ROOT).filter(({ fields }) => fields.status === 'open' || fields.status === 'decided-in-absence'); // prettier-ignore
    const decide = OWNER_CHECKS.filter((check) => check.kind === 'decide');
    expect(decide.map((check) => check.from).sort()).toEqual(awaiting.map(({ fields }) => fields.id).sort());
    for (const check of decide) {
      const record = awaiting.find(({ fields }) => fields.id === check.from)!;
      const options = check.options ?? [];
      expect(options.length, check.id).toBeGreaterThanOrEqual(2);
      expect(new Set(options.map((one) => one.id)).size, check.id).toBe(options.length);
      expect(new Set(options.map((one) => one.option)).size, check.id).toBe(options.length);
      for (const { option } of options) expect(option, check.id).toBeLessThanOrEqual((record.fields.options as unknown[]).length); // prettier-ignore
    }
    for (const check of OWNER_CHECKS.filter((one) => one.kind === 'try'))
      expect(check.options, check.id).toBeUndefined();
  });

  it('covers every item of the playtest, and names only keys the maps have', () => {
    const doc = readFileSync(`${ROOT}docs/PLAYGROUND.md`, 'utf8');
    const playtest = doc.slice(doc.indexOf('### 9.3'), doc.indexOf('## 10.'));
    const items = [...playtest.matchAll(/^(\d+)\. /gm)].map((match) => Number(match[1]));
    expect(items.length).toBeGreaterThanOrEqual(14);
    const cited = new Set(OWNER_CHECKS.flatMap((check) => [...check.from.matchAll(/§9\.3, item (\d+)/g)].map((m) => Number(m[1])))); // prettier-ignore
    expect(items.filter((n) => !cited.has(n))).toEqual([]);
    const actions = new Set(Object.values(PLAYGROUND_MAPS).flatMap((id) => Object.keys(getActionMap(id).actions)));
    const named = OWNER_CHECKS.flatMap((check) => [...check.what.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    expect(named.filter((action) => !actions.has(action))).toEqual([]);
  });

  it('links each check to a page that parses, or to a page the repository has', () => {
    for (const check of OWNER_CHECKS.filter((one) => one.go)) {
      const url = new URL(checkUrl(check, HERE));
      if (check.go?.page) {
        expect(url.pathname, check.id).toBe(`/${check.go.page}`);
        expect(existsSync(`${ROOT}${check.go.page}index.html`), check.id).toBe(true);
        continue;
      }
      expect(url.pathname, check.id).toBe('/labs/playground/');
      const routes = parseRoutes(url.search, { scenes: SCENES.map((scene) => scene.id) });
      expect(routes.settings['playground.check'], check.id).toBe(check.id);
      expect(routes.settings['playground.title'], check.id).toBe(check.id === 'front-end' ? 'on' : 'off');
      if (check.go?.place) expect(SCENES.find((scene) => scene.id === `playground:${check.go?.query?.scene}`)?.actions?.place, check.id).toBeDefined(); // prettier-ignore
    }
    expect(checkUrl(ownerCheck('labs')!, `${HERE}?scene=site#x`)).toBe('http://127.0.0.1:5173/labs/index/');
    expect(checkUrl(ownerCheck('esc-0005')!, HERE)).toBe('http://127.0.0.1:5173/labs/box/?scene=crowd-5000');
    expect(() => parseRoutes('?playground.check=nowhere', { scenes: [gym.id] })).toThrow(/playground\.check/);
  });

  it('holds the player at each spot through the scene’s recorded dev action place', async () => {
    for (const scene of SCENES) {
      const checks = OWNER_CHECKS.filter((check) => check.go?.place && `playground:${check.go.query?.scene}` === scene.id); // prettier-ignore
      if (!checks.length) continue;
      const live = await createHeadless({ scene });
      live.step(2);
      for (const check of checks) {
        const { at, yaw } = check.go!.place!;
        (live.actions as { run(name: string, args: unknown): unknown }).run('place', { at: [...at], yaw });
        live.step(30);
        const [player] = (live.state('actor').entities as unknown as { actor: { player: boolean; x: number; y: number; z: number } }[]).filter((e) => e.actor.player); // prettier-ignore
        expect(Math.hypot(player.actor.x - at[0], player.actor.z - at[2]), check.id).toBeLessThan(0.25);
        expect(Math.abs(player.actor.y - at[1]), check.id).toBeLessThan(0.3);
      }
      const replay = (live.input as { record(): { inputs: [number, { dev?: unknown }][] } }).record();
      expect(replay.inputs.filter(([, change]) => JSON.stringify(change.dev ?? '').includes('place'))).toHaveLength(checks.length); // prettier-ignore
    }
  }, 240_000);

  it('keeps only answers of their shape, and writes them as the text to paste back', () => {
    const store = memory();
    expect(readAnswers(store)).toEqual({});
    saveAnswer(store, 'sprint', { verdict: 'needs-work', note: ' too slow to stop ', at: '2026-10-26' });
    saveAnswer(store, 'esc-0003', { verdict: 'supply', note: '', at: '2026-10-26' });
    saveAnswer(store, 'mantle', { verdict: '', note: 'not tried yet', at: '2026-10-26' });
    store.set(CHECKS_KEY, { ...store.get(CHECKS_KEY, {}), nowhere: { verdict: 'good', note: '', at: '' }, slide: { verdict: 3 } }); // prettier-ignore
    expect(Object.keys(readAnswers(store)).sort()).toEqual(['esc-0003', 'mantle', 'sprint']);
    const text = answersText(OWNER_CHECKS, readAnswers(store)).split('\n');
    expect(text[0]).toBe(`My answers to the owner checks: 2 of ${OWNER_CHECKS.length}, from labs/playground/ui/checks.ts.`); // prettier-ignore
    expect(text).toContain('Decisions:');
    expect(text).toContain('- ESC-0003, The Quaternius animation files: option 1: I will supply the files (in the chat, or a link) (2026-10-26)'); // prettier-ignore
    expect(text).toContain('- sprint (docs/PLAYGROUND.md §9.3, item 1), Sprint the strip, in first person: Needs work (say what in the note). Note: too slow to stop (2026-10-26)'); // prettier-ignore
    expect(text.at(-1)).toMatch(/^Not answered yet: esc-0002, esc-0004, .*mantle.*gamepad\.$/);
    saveAnswer(store, 'sprint', null);
    expect(Object.keys(readAnswers(store)).sort()).toEqual(['esc-0003', 'mantle']);
  });
});
