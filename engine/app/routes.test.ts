/**
 * @file Unit tests for engine/app/routes.ts (T1, PLAN.md §6.1, WP 2.7): `?scene` by id or by the name after its colon
 * (the page's first scene by default), `?seed`, `?cam` and `?cam3` as camera codes, `?replay`, and every other key
 * as a setting typed by the schema; every malformed or unknown key is an error naming the fix, and `routeQuery`
 * writes a query back that reads the same.
 * @see engine/app/routes.ts
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/log';
import { createRegistry } from '../core/registry';
import { defineSettings } from '../core/settings';
import { defineScene } from '../sim/scene';
import { parseRoutes, routeQuery } from './routes';

/** A registry with two scenes and two settings. */
function pageRegistry() {
  const registry = createRegistry();
  defineSettings(
    {
      'demo.speed': { type: 'number', default: 1, minimum: 0, maximum: 10, description: 'How fast.' },
      'demo.look': { type: 'string', default: 'plain', enum: ['plain', 'fancy'], view: true, description: 'A look.' },
    },
    registry,
  );
  defineScene('box:room', { setup: () => {} }, registry);
  defineScene('box:hall', { setup: () => {} }, registry);
  return registry;
}

const scenes = ['box:room', 'box:hall'];

/** The code of the error `fn` throws. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof EngineError ? `${error.code}: ${error.message}` : String(error);
  }
  return 'no error';
}

describe('parseRoutes', () => {
  it("picks a scene by id or by its name, the page's first by default, and reads the seed", () => {
    const registry = pageRegistry();
    expect(parseRoutes('', { scenes, registry })).toEqual({ scene: 'box:room', seed: 1, settings: {} });
    expect(parseRoutes('?scene=hall&seed=7', { scenes, registry })).toMatchObject({ scene: 'box:hall', seed: 7 });
    expect(parseRoutes('?scene=box:hall', { scenes, registry }).scene).toBe('box:hall');
  });

  it('reads cameras as codes and settings by path, typed by the schema', () => {
    const registry = pageRegistry();
    const routes = parseRoutes('?cam=iso,45,2&demo.speed=3&demo.look=fancy&replay=box-1-room', { scenes, registry });
    expect(routes).toEqual({
      scene: 'box:room',
      seed: 1,
      cam: 'cam=iso,45,2',
      replay: 'box-1-room',
      settings: { 'demo.speed': 3, 'demo.look': 'fancy' },
    });
    expect(parseRoutes('?cam3=orbit', { scenes, registry }).cam).toBe('cam3=orbit');
  });

  it('refuses what it cannot read, naming the fix', () => {
    const registry = pageRegistry();
    const read = (search: string) => codeOf(() => parseRoutes(search, { scenes, registry }));
    expect(read('?scene=rom')).toMatch(
      /APP_BAD_ROUTE.*names no scene of this page \(did you mean "room"\?\).*use one of room, hall/,
    );
    expect(read('?seed=-1')).toMatch(/APP_BAD_ROUTE.*not a whole number/);
    expect(read('?seed=1&seed=2')).toMatch(/APP_BAD_ROUTE.*more than once/);
    expect(read('?cam=iso&cam3=orbit')).toMatch(/APP_BAD_ROUTE.*give one camera/);
    expect(read('?cam=nosuch')).toMatch(/GFX_UNKNOWN_CAMERA/);
    expect(read('?replay=../x')).toMatch(/APP_BAD_ROUTE.*not a replay name/);
    expect(read('?demo.sped=2')).toMatch(/CORE_BAD_SETTING.*demo\.speed/);
    expect(read('?demo.speed=99')).toMatch(/CORE_BAD_SETTING.*maximum 10/);
    expect(codeOf(() => parseRoutes('', { scenes: [], registry }))).toMatch(/APP_BAD_ROUTE/);
  });
});

describe('routeQuery', () => {
  it('writes a query that reads back the same', () => {
    const registry = pageRegistry();
    const query = routeQuery({ scene: 'hall', seed: 3, cam: 'cam=topdown', settings: { 'demo.speed': 2 } });
    expect(query).toBe('?scene=hall&seed=3&cam=topdown&demo.speed=2');
    expect(parseRoutes(query, { scenes, registry })).toEqual({
      scene: 'box:hall',
      seed: 3,
      cam: 'cam=topdown',
      settings: { 'demo.speed': 2 },
    });
    expect(routeQuery({})).toBe('');
  });
});
