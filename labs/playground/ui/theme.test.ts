/**
 * @file Unit tests for the playground's theme (labs/playground/ui/theme.ts), read as the sheet `installTheme` adds
 * (over tests/unit/ui/fakeDom.ts): the feel panel, a child of the body beside the overlay, gets the theme's custom
 * properties and a block of its own, in the theme's glass, type and accent, every rule of it under `body >` so it
 * outranks the engine panel's sheet (engine/dev/feel/panel.ts, `.feel-panel …`) whichever comes first; a panel's
 * focused control is outlined for every kind a pad walks to (walk.ts); and the sheet is added once however often it
 * is installed. How it looks is checked in the page (tests/e2e/playground-ui.spec.ts).
 * @see labs/playground/ui/theme.ts
 */
import { describe, expect, it } from 'vitest';
import { fakePage } from '../../../tests/unit/ui/fakeDom';
import { installTheme } from './theme';

/** `list` split at its top-level commas (`a, b:is(c, d)` → `a`, `b:is(c, d)`). */
function splitSelectors(list: string): string[] {
  const out = [''];
  let depth = 0;
  for (const c of list) {
    depth += c === '(' ? 1 : c === ')' ? -1 : 0;
    if (c === ',' && depth === 0) out.push('');
    else out[out.length - 1] += c;
  }
  return out.map((one) => one.trim().replace(/\s+/g, ' '));
}

/** The theme's innermost rules, as installed: each one's selectors and its declarations' text. */
function themeRules(): { selectors: string[]; body: string }[] {
  const { document } = fakePage({ left: 0, top: 0, width: 1280, height: 720 });
  installTheme(document as unknown as Document);
  installTheme(document as unknown as Document);
  const sheets = document.head.children.filter((el) => el.id === 'pg-theme');
  expect(sheets).toHaveLength(1);
  const css = sheets[0].textContent.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, list, body]) => ({
    selectors: splitSelectors(list),
    body,
  }));
}

describe('the playground’s theme', () => {
  it('dresses the feel panel beside the overlay in its glass, type and accent, outranking the engine’s sheet', () => {
    const rules = themeRules();
    const tokens = rules.find((rule) => rule.body.includes('--pg-glass:'));
    expect(tokens?.selectors).toEqual(expect.arrayContaining(['.pg-ui', '.feel-panel']));
    const rule = (selector: string) => rules.find((one) => one.selectors.includes(selector))?.body ?? '';
    expect(rule('body > .feel-panel')).toMatch(/font: var\(--pg-font\)[\s\S]*background: var\(--pg-glass\)[\s\S]*border-radius: var\(--pg-radius\)/); // prettier-ignore
    expect(rule('body > .feel-panel h2')).toMatch(/text-transform: uppercase/); // as every panel's heading
    expect(rule('body > .feel-panel :is(button, textarea)')).toMatch(/border: 1px solid var\(--pg-line\)/);
    expect(rule('body > .feel-panel input[type=range]')).toMatch(/accent-color: var\(--pg-accent\)/);
    const panel = rules.flatMap((one) => one.selectors).filter((selector) => selector.includes('.feel-panel'));
    const outranking = panel.filter((selector) => selector.startsWith('body > .feel-panel'));
    expect(outranking.length).toBeGreaterThan(10);
    expect(panel.filter((selector) => !outranking.includes(selector))).toEqual([
      '.feel-panel', // the custom properties, which the engine's sheet never sets
      'body:has(> .feel-panel:not([hidden])) .pg-ui .ui-hud[data-id=mode]', // the HUD's camera chip, off its corner
      'body:has(.pg-ui > .pg-screen, .pg-ui > [data-ui=photo]:not([hidden])) > .feel-panel', // hidden under a screen
    ]);
  });

  it('outlines a panel’s focused control of every kind a pad walks to (walk.ts), so the pad shows where it is', () => {
    const focus = themeRules().find((rule) => rule.selectors.some((one) => /^\.pg-ui \.ui-box .*:focus$/.test(one)));
    expect(focus?.body).toMatch(/outline: 2px solid var\(--pg-accent\)/);
    const kinds = focus?.selectors[0].match(/:is\(([^)]*)\)/)?.[1].split(', ');
    expect(kinds).toEqual(expect.arrayContaining(['button', 'select', 'summary', 'input']));
  });
});
