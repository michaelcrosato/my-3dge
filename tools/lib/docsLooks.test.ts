/**
 * @file The looks catalogue (tools/lib/docsLooks.ts): every built-in look and every filter is listed once, the whole
 * looks with their descriptions, a field's default and range read compactly, and the shared `amount` left to the
 * block's header but for the filters whose amount is their strength.
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../engine/core/registry';
import { FILTER_NAMES } from '../../engine/gfx/post/filters';
import { defineLooks, type LookEntry } from '../../engine/gfx/post/looks';
import { fieldText, looksCatalog } from './docsLooks';

const catalog = looksCatalog();
const lines = catalog.split('\n');
const registry = createRegistry();
defineLooks(registry);
const looks = registry.list('look') as LookEntry[];

describe('looksCatalog', () => {
  it('lists every whole look once, with its description', () => {
    const whole = looks.filter((look) => look.group === 'look');
    expect(whole.length).toBeGreaterThan(20);
    for (const look of whole) {
      expect(lines.filter((line) => line.startsWith(`- \`${look.id}\`: `))).toEqual([`- \`${look.id}\`: ${look.description}`]); // prettier-ignore
    }
  });

  it('lists every one-filter preset under its group', () => {
    const presets = looks.filter((look) => look.group !== 'look');
    for (const look of presets) {
      const line = lines.find((each) => each.startsWith(`- \`${look.group}\`: `));
      expect(line, look.id).toBeDefined();
      expect(line!.slice(`- \`${look.group}\`: `.length).split(', ')).toContain(look.id.split('/')[1]);
    }
  });

  it('lists every filter once, in the chain order, the screen ones marked', () => {
    const filters = lines.filter((line) => /^- `[a-z]+`( \(the whole picture\))?: [A-Z]/.test(line));
    expect(filters.map((line) => /^- `([a-z]+)`/.exec(line)![1])).toEqual([...FILTER_NAMES]);
    expect(filters.find((line) => line.startsWith('- `vignette`'))).toMatch(/^- `vignette` \(the whole picture\): /);
    expect(filters.find((line) => line.startsWith('- `grade`'))).toMatch(/^- `grade`: Colour grading\. /);
  });

  it("leaves the shared amount to the header but shows grain's and chroma's own", () => {
    // a filter's line comes after its presets' group line, which starts the same
    const line = (name: string) => lines.filter((each) => each.startsWith(`- \`${name}\``)).at(-1)!;
    expect(line('vignette')).not.toContain('`amount`');
    expect(line('vignette')).toContain("`strength` 0.45 (0–1), `softness` 0.5 (0.05–1), `roundness` 1 (0–1), `color` '#000000'."); // prettier-ignore
    expect(line('grain')).toMatch(/`amount` [\d.]+ \(0–1\)/);
    expect(line('chroma')).toMatch(/`amount` [\d.]+ \(0–1\)/);
  });
});

describe('fieldText', () => {
  it('reads a number, a choice, a colour and a switch', () => {
    expect(fieldText({ type: 'number', default: 0.45, minimum: 0, maximum: 1 })).toBe('0.45 (0–1)');
    expect(fieldText({ type: 'number', default: 8, minimum: 0, maximum: 24, unit: 'px' })).toBe('8 (0–24 px)');
    expect(fieldText({ type: 'string', default: 'kraft', enum: ['newsprint', 'kraft'] })).toBe("'kraft' (newsprint|kraft)"); // prettier-ignore
    expect(fieldText({ type: 'string', default: '#000000', unit: '#rrggbb' })).toBe("'#000000'");
    expect(fieldText({ type: 'boolean', default: true })).toBe('true');
  });
});
