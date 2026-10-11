/**
 * @file Unit tests for `x set` (tools/cmd/set.ts, PLAN.md §3's Agent-operable, WP 2.7): every setting the engine, the
 * box and the fixtures declare is reachable through `x set` (typed from its text as the schema says) and through
 * the URL parameter it prints, which the page's routes read back to the same value (engine/dev/inspector.test.ts
 * checks `__engine.set` for each); an unknown path names the closest, a bad value the rule (exit 2); without an
 * inspect session it prints the URL and says how to start one.
 * @see tools/cmd/set.ts
 */
import { describe, expect, it } from 'vitest';
import { parseRoutes } from '../../engine/app/routes';
import { registry } from '../../engine/core/registry';
import { createSettings } from '../../engine/core/settings';
import { defineScene } from '../../engine/sim/scene';
import { dispatch, ROOT } from '../x';
import { checkSetting, loadSettings, settingModules, settingParam } from './set';

/** Runs `node x set …` in this process; returns the exit code and the printed lines. */
async function set(...args: string[]) {
  const lines: string[] = [];
  const code = await dispatch(['set', ...args], { print: (line) => lines.push(line) });
  return { code, lines };
}

describe('every setting is reachable through x set and its URL parameter', () => {
  it('types each one from text, and the routes read its parameter back', async () => {
    const files = await loadSettings(ROOT);
    expect(files).toEqual(expect.arrayContaining(['engine/core/time.ts', 'labs/box/scenes/room.ts']));
    expect(settingModules(ROOT, 'room')).toContain('labs/box/scenes/room.ts');
    expect(settingModules(ROOT, 'room')).not.toContain('fixtures/scenes/kernel/index.ts');
    if (!registry.has('scene', 'settings:x-set')) defineScene('settings:x-set', { setup: () => {} });
    const rows = createSettings().describe();
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const text = typeof row.default === 'string' ? row.default : JSON.stringify(row.default);
      const change = checkSetting(row.path, text);
      expect(change.value, row.path).toEqual(row.default);
      const routes = parseRoutes(`?${settingParam(row.path, change.value)}`, { scenes: ['settings:x-set'] });
      expect(routes.settings[row.path], row.path).toEqual(row.default);
    }
  });
});

describe('x set', () => {
  it('prints the setting, its URL parameter and the page; without a session it says how to start one', async () => {
    const { code, lines } = await set('box.room.speed', '3', '--scene', 'room');
    expect(code).toBe(0);
    expect(lines[0]).toBe('x set: ok: box.room.speed = 3 (m/s; default 1.5; takes effect now)');
    expect(lines).toContain('URL parameter: ?box.room.speed=3');
    expect(lines).toContain('page: labs/box/?scene=room&box.room.speed=3');
    expect(lines.some((line) => line.startsWith('no inspect session: start one with node x inspect'))).toBe(true);
  });

  it('refuses an unknown setting, naming the closest, and a bad value, naming the rule (exit 2)', async () => {
    const unknown = await set('box.room.sped', '3');
    expect(unknown.code).toBe(2);
    expect(unknown.lines[1]).toContain('did you mean "box.room.speed"?');
    const bad = await set('box.room.speed', '99');
    expect([bad.code, bad.lines[1]]).toEqual([2, expect.stringContaining('above its maximum 10')]);
    expect((await set('box.room.speed')).code).toBe(2);
  });
});
