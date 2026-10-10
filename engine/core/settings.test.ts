/**
 * @file Unit tests for engine/core/settings.ts (T1): settings declared as `setting` entries (bad paths and fields
 * refused), validated `get` and `set` with the closest path for a typo, text from URLs and `x set`, the "differs from
 * default" marker and reset, JSON export and import all or nothing, URL parameters both ways, scoped overrides undone
 * in any order (a set landing in the newest layer, a reset clearing every layer), view settings kept from the hash and
 * from sim-side reads, frozen values and defaults independent of the caller's objects, and `describe`.
 * @see engine/core/settings.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry, registry } from './registry';
import { createSettings, defineSettings, type Settings } from './settings';

/** A store over a fresh registry holding the fixture settings. */
function setup(): Settings {
  const reg = createRegistry();
  defineSettings(
    {
      crowd: { type: 'integer', default: 100, minimum: 0, maximum: 5000, description: 'Walkers.', when: 'scene' },
      'hero.runSpeed': { type: 'number', default: 5, minimum: 0, unit: 'm/s', description: 'Run speed.' },
      mix: { type: 'string', enum: ['calm', 'balanced', 'wild'], default: 'balanced', description: 'Crowd mix.' },
      debug: { type: 'boolean', default: false, description: 'Debug drawing.' },
      spawnPoints: {
        type: 'array',
        items: { type: 'number' },
        default: [0, 1],
        description: 'Spawn x positions.',
        when: 'spawn',
      },
      quality: { type: 'string', enum: ['low', 'high'], default: 'high', view: true, description: 'Render quality.' },
    },
    reg,
  );
  return createSettings({ registry: reg });
}

describe('defineSettings', () => {
  it('declares each setting as an entry of the kind setting, with when and view filled', () => {
    const reg = createRegistry();
    const [entry] = defineSettings(
      { gravity: { type: 'number', default: -30, unit: 'm/s²', description: 'Gravity.' } },
      reg,
    );
    expect(entry).toMatchObject({ id: 'gravity', kind: 'setting', default: -30, when: 'now', view: false });
    expect(reg.describe('setting').ids).toEqual(['gravity']);
    expect(registry.kinds()).toContain('setting');
  });

  it('refuses a path that is not dotted words, and a field that breaks the schema language', () => {
    const reg = createRegistry();
    expect(() => defineSettings({ 'hero run': { type: 'number', default: 1, description: 'x' } }, reg)).toThrow(
      /\[CORE_BAD_SPEC\] defineSettings: the path "hero run" must be words joined by dots/,
    );
    expect(() =>
      defineSettings({ fov: { type: 'number', default: 500, maximum: 120, description: 'FOV.' } }, reg),
    ).toThrow(/\[CORE_BAD_SPEC\] setting "fov": fov's default is 500, above its maximum 120/);
    expect(() =>
      defineSettings({ fov: { type: 'number', default: 1, min: 0, description: 'FOV.' } as never }, reg),
    ).toThrow(/unknown key "min" \(write minimum\)/);
    expect(() => defineSettings({ fov: { type: 'number', default: 1 } as never }, reg)).toThrow(
      /description is required/,
    );
    expect(() => defineSettings({ onTick: { type: 'function', default: () => 0, description: 'x' } }, reg)).toThrow(
      /type is "function", not one of/,
    );
  });
});

describe('get and set', () => {
  it('reads defaults, sets validated values, and reports the change and when it takes effect', () => {
    const settings = setup();
    expect(settings.get('crowd')).toBe(100);
    expect(settings.set('crowd', 400)).toEqual({
      path: 'crowd',
      value: 400,
      previous: 100,
      when: 'scene',
      view: false,
    });
    expect(settings.get<number>('crowd')).toBe(400);
    expect(settings.set('quality', 'low')).toMatchObject({ when: 'now', view: true });
  });

  it('refuses an unknown path, naming the closest, and a bad value, naming the rule', () => {
    const settings = setup();
    expect(() => settings.set('crwd', 1)).toThrow(
      /\[CORE_UNKNOWN_SETTING\] there is no setting "crwd" \(did you mean "crowd"\?\)/,
    );
    expect(() => settings.get('runSpeed')).toThrow(/did you mean "hero.runSpeed"/);
    expect(() => settings.set('crowd', 9000)).toThrow('[CORE_BAD_SETTING] crowd is 9000, above its maximum 5000');
    expect(() => settings.set('mix', 'loud')).toThrow(/mix is "loud", not one of "calm", "balanced", "wild"/);
    expect(() => settings.set('crowd', 2.5)).toThrow(/crowd is a number; it must be a whole number/);
    expect(settings.get('crowd')).toBe(100);
  });

  it('parses text as a URL or x set gives it', () => {
    const settings = setup();
    settings.setText('crowd', '250');
    settings.setText('hero.runSpeed', '6.5');
    settings.setText('debug', 'true');
    settings.setText('mix', 'wild');
    settings.setText('spawnPoints', '[2,3]');
    expect(settings.values({ view: false })).toEqual({
      crowd: 250,
      debug: true,
      'hero.runSpeed': 6.5,
      mix: 'wild',
      spawnPoints: [2, 3],
    });
    expect(() => settings.setText('crowd', '')).toThrow(
      /\[CORE_BAD_SETTING\] crowd is "", which does not read as a value of type integer/,
    );
    expect(() => settings.setText('crowd', 'many')).toThrow(/crowd is NaN; it must be a whole number/);
    expect(() => settings.setText('debug', 'yes')).toThrow(/debug is a string; it must be a boolean/);
    expect(() => settings.setText('spawnPoints', '[2,')).toThrow(/CORE_BAD_SETTING/);
  });

  it('reads 1 and 0 as booleans, from x set and from URLs', () => {
    const settings = setup();
    settings.setText('debug', '1');
    expect(settings.get('debug')).toBe(true);
    settings.setText('debug', '0');
    expect(settings.get('debug')).toBe(false);
    settings.fromUrl('debug=1');
    expect(settings.get('debug')).toBe(true);
    settings.fromUrl('debug=0');
    expect(settings.get('debug')).toBe(false);
  });

  it('stores values frozen and independent of the array it was given', () => {
    const settings = setup();
    const points = [4, 5];
    settings.set('spawnPoints', points);
    points.push(6);
    const stored = settings.get<number[]>('spawnPoints');
    expect(stored).toEqual([4, 5]);
    expect(Object.isFrozen(stored)).toBe(true);
  });

  it('returns defaults frozen, so no reader can change them for everyone', () => {
    const settings = setup();
    const points = settings.sim.get<number[]>('spawnPoints');
    expect(Object.isFrozen(points)).toBe(true);
    expect(() => (points as number[]).push(9)).toThrow(TypeError);
    expect(Object.isFrozen(settings.get('spawnPoints'))).toBe(true);
    expect(settings.get('spawnPoints')).toEqual([0, 1]);
    expect(Object.isFrozen(settings.describe().find((row) => row.path === 'spawnPoints')?.default)).toBe(true);
  });

  it("keeps a default independent of the caller's object, and copies objects given to set", () => {
    const reg = createRegistry();
    const view = { at: [0, 5, 10], fov: 50 };
    defineSettings({ 'camera.view': { type: 'any', default: view, description: 'Camera view.' } }, reg);
    const settings = createSettings({ registry: reg });
    view.at.push(99);
    view.fov = 90;
    expect(settings.get('camera.view')).toEqual({ at: [0, 5, 10], fov: 50 });
    expect(Object.isFrozen(view)).toBe(false);
    const next = { at: [1], fov: 60 };
    settings.set('camera.view', next);
    next.at.push(2);
    expect(settings.get('camera.view')).toEqual({ at: [1], fov: 60 });
    expect(Object.isFrozen(next)).toBe(false);
  });

  it('sees settings declared after the store was made', () => {
    const reg = createRegistry();
    const settings = createSettings({ registry: reg });
    defineSettings({ late: { type: 'boolean', default: true, description: 'Declared later.' } }, reg);
    expect(settings.get('late')).toBe(true);
  });
});

describe('the marker, reset, values and describe', () => {
  it('marks what differs from the default and resets one setting or all', () => {
    const settings = setup();
    settings.set('crowd', 100);
    expect(settings.differs('crowd')).toBe(false);
    settings.set('crowd', 7);
    settings.set('spawnPoints', [0, 1]);
    expect([settings.differs('crowd'), settings.differs('spawnPoints')]).toEqual([true, false]);
    settings.set('mix', 'calm');
    settings.reset('crowd');
    expect(settings.get('crowd')).toBe(100);
    expect(settings.differs('mix')).toBe(true);
    settings.reset();
    expect(settings.toJSON()).toEqual({});
    expect(() => settings.reset('nope')).toThrow(/CORE_UNKNOWN_SETTING/);
  });

  it('resets to the defaults inside an active override, the override included', () => {
    const settings = setup();
    settings.set('crowd', 7);
    const scene = settings.override({ crowd: 1000, mix: 'wild' });
    settings.reset();
    expect([settings.get('crowd'), settings.get('mix')]).toEqual([100, 'balanced']);
    settings.set('crowd', 3);
    scene.dispose();
    expect(settings.get('crowd')).toBe(3);
    const variant = settings.override({ crowd: 2000 });
    settings.reset('crowd');
    expect(settings.get('crowd')).toBe(100);
    variant.dispose();
  });

  it('lists values sorted by path, all, without view settings, or only them', () => {
    const settings = setup();
    expect(Object.keys(settings.values())).toEqual([
      'crowd',
      'debug',
      'hero.runSpeed',
      'mix',
      'quality',
      'spawnPoints',
    ]);
    expect(settings.values({ view: false })).not.toHaveProperty('quality');
    expect(settings.values({ view: true })).toEqual({ quality: 'high' });
  });

  it('describes every setting with its value, default, marker and schema', () => {
    const settings = setup();
    settings.set('hero.runSpeed', 7);
    const rows = settings.describe();
    expect(rows.map((row) => row.path)).toEqual(['crowd', 'debug', 'hero.runSpeed', 'mix', 'quality', 'spawnPoints']);
    expect(rows[2]).toEqual({
      path: 'hero.runSpeed',
      value: 7,
      default: 5,
      differs: true,
      type: 'number',
      description: 'Run speed.',
      unit: 'm/s',
      minimum: 0,
      when: 'now',
      view: false,
    });
    expect(rows[4]).toMatchObject({ view: true, enum: ['low', 'high'], differs: false });
  });
});

describe('presets: JSON export and import', () => {
  it('exports what differs from the defaults and loads it back', () => {
    const settings = setup();
    settings.set('crowd', 10);
    settings.set('quality', 'low');
    const preset = JSON.parse(JSON.stringify(settings));
    expect(preset).toEqual({ crowd: 10, quality: 'low' });
    const other = setup();
    expect(other.load(preset).map((change) => change.path)).toEqual(['crowd', 'quality']);
    expect(other.values()).toEqual(settings.values());
  });

  it('applies nothing from a preset with any problem, and lists every problem with the closest path', () => {
    const settings = setup();
    expect(() => settings.load({ crowd: 5, crwod: 1, mix: 'loud', 'hero.speed': 2 })).toThrow(
      '[CORE_BAD_SETTING] there is no setting "crwod" (did you mean "crowd"?); mix is "loud", not one of "calm", "balanced", "wild"; there is no setting "hero.speed" (did you mean "hero.runSpeed"?)',
    );
    expect(settings.get('crowd')).toBe(100);
    expect(() => settings.load([1])).toThrow(/a preset is \[1\]; it must be \{ "path": value \}/);
  });
});

describe('URL parameters', () => {
  it('reads typed values, skips reserved parameters, and writes what differs back', () => {
    const settings = setup();
    settings.fromUrl('?crowd=50&debug&mix=calm&scene=box%3Ahall&spawnPoints=%5B1%5D', { reserved: ['scene'] });
    expect(settings.toJSON()).toEqual({ crowd: 50, debug: true, mix: 'calm', spawnPoints: [1] });
    expect(settings.toUrl()).toBe('crowd=50&debug=true&mix=calm&spawnPoints=%5B1%5D');
    const other = setup();
    other.fromUrl(settings.toUrl());
    expect(other.toJSON()).toEqual(settings.toJSON());
  });

  it('refuses unknown parameters and bad values, applying none of them', () => {
    const settings = setup();
    expect(() => settings.fromUrl('crowd=5&scene=x&debug=maybe&hero.runSpeed=fast')).toThrow(
      /\[CORE_BAD_SETTING\] there is no setting "scene"; debug is a string; it must be a boolean; hero.runSpeed is NaN; it must be a number:/,
    );
    expect(settings.get('crowd')).toBe(100);
    expect(() => settings.fromUrl('crowd=')).toThrow(/crowd= does not read as a value of type integer/);
  });
});

describe('scoped overrides', () => {
  it('overrides for a lifetime and undoes exactly that layer, in any order', () => {
    const settings = setup();
    settings.set('crowd', 10);
    const scene = settings.override({ crowd: 1000, mix: 'wild' }, 'scene:hall');
    const variant = settings.override({ crowd: 2000 }, 'variant:dense');
    expect([settings.get('crowd'), settings.get('mix'), scene.label]).toEqual([2000, 'wild', 'scene:hall']);
    scene.dispose();
    expect([settings.get('crowd'), settings.get('mix')]).toEqual([2000, 'balanced']);
    variant.dispose();
    variant.dispose();
    expect(settings.get('crowd')).toBe(10);
  });

  it('writes a set to the newest layer holding the path, so the change ends with it', () => {
    const settings = setup();
    const scene = settings.override({ crowd: 1000 });
    settings.set('crowd', 5);
    settings.set('debug', true);
    expect(settings.get('crowd')).toBe(5);
    scene.dispose();
    expect([settings.get('crowd'), settings.get('debug')]).toEqual([100, true]);
  });

  it('writes a set to the newest of two layers holding the path, undone with that layer', () => {
    const settings = setup();
    settings.set('crowd', 10);
    const scene = settings.override({ crowd: 1000 }, 'scene');
    const variant = settings.override({ crowd: 2000 }, 'variant');
    expect(settings.set('crowd', 5)).toMatchObject({ value: 5, previous: 2000 });
    expect(settings.get('crowd')).toBe(5);
    variant.dispose();
    expect(settings.get('crowd')).toBe(1000);
    scene.dispose();
    expect(settings.get('crowd')).toBe(10);
  });

  it('refuses bad overrides whole', () => {
    const settings = setup();
    expect(() => settings.override({ crowd: 5, mixx: 'calm' })).toThrow(
      /there is no setting "mixx" \(did you mean "mix"\?\)/,
    );
    expect(() => settings.override('crowd=5' as never)).toThrow(/overrides are "crowd=5"; write \{ path: value \}/);
    expect(settings.get('crowd')).toBe(100);
  });
});

describe('view settings and sim-side reads', () => {
  it('lets sim-side code read every setting but the view ones', () => {
    const settings = setup();
    settings.fromUrl('quality=low');
    expect(settings.get('quality')).toBe('low');
    expect(settings.sim.get('crowd')).toBe(100);
    expect(() => settings.sim.get('quality')).toThrow(
      /\[CORE_VIEW_SETTING\] sim-side code read the view setting "quality"/,
    );
    expect(() => settings.sim.get('crowdd')).toThrow(/CORE_UNKNOWN_SETTING/);
    expect(settings.sim.values()).toEqual(settings.values({ view: false }));
    expect(settings.sim.values()).not.toHaveProperty('quality');
  });
});
