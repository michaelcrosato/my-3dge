/**
 * @file Unit tests for engine/app/look.ts (T1, PLAN.md WP 7.8, WP 13.18): before each frame the page's look shows the
 * look's sky on the stage with the quality budget, its dome's gradient and its outline shells (WP 13.24); the style
 * set joins the warm-up once, at the first look whose style
 * is not the set's own, with that style and its own, adds each later look's new style, and from then on re-points
 * what shows to the style drawn; a look in the set's own style, or none, never joins it; the view comes back as it
 * was given.
 * @see engine/app/look.ts
 */
import { Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { MaterialStyle } from '../gfx/materials/styles';
import type { LookEntry } from '../gfx/post/looks';
import type { Warmup } from '../gfx/warmup';
import { createPageLook } from './look';

/** A page look over fakes that record what it did. */
function fakes(start: Partial<LookEntry>) {
  const calls: string[] = [];
  const plain = { sky: '', style: '', skyGradient: 0, shells: { width: 0, color: '#141018' } };
  let look = { ...plain, ...start } as LookEntry;
  const warmed: MaterialStyle[] = [];
  const styles = {
    style: 'lambert' as const,
    attach: (_warmup: Warmup, _scene: unknown, asked: readonly MaterialStyle[] = []) => {
      calls.push(`attach ${asked.join(',')}`);
      warmed.push(...asked);
      return { styles: warmed, add: (style: MaterialStyle) => void (calls.push(`add ${style}`), warmed.push(style)), dispose: () => calls.push('detach') }; // prettier-ignore
    },
    apply: () => (calls.push('apply'), 0),
  };
  const stage = {
    scene: new Scene(),
    sky: {
      show: (id: string) => void calls.push(`show ${id}`),
      budget: ({ shadowCasters }: { shadowCasters: number | null }) => void calls.push(`budget ${shadowCasters}`),
      sky: { gradient: (share: number) => void calls.push(`gradient ${share}`) },
    },
    shells: {
      set: ({ width, color }: { width: number; color: string }) => void calls.push(`shells ${width} ${color}`),
    },
  } as unknown as Parameters<ReturnType<typeof createPageLook>['sync']>[0];
  const page = createPageLook({
    post: {
      get look() {
        return look;
      },
    },
    styles,
    warmup: {} as Warmup,
    quality: () => ({ shadowCasters: 1 }),
  });
  const use = (next: Partial<LookEntry>) => void (look = { ...plain, ...next } as LookEntry);
  return { calls, page, stage, use };
}

describe('the page look', () => {
  it("shows the look's sky with the quality budget, its gradient and its shells, and gives the view back", () => {
    const { calls, page, stage } = fakes({ sky: 'sky:hall', skyGradient: 1, shells: { width: 1, color: '#1a1420' } });
    const view = { scene: stage.scene };
    expect(page.sync(stage, view)).toBe(view);
    expect(calls).toEqual(['show sky:hall', 'budget 1', 'gradient 1', 'shells 1 #1a1420']);
    expect(page.styled).toBe(false);
  });

  it('joins the style set to the warm-up once, at the first look in another style, then keeps re-pointing', () => {
    const { calls, page, stage, use } = fakes({ style: 'lambert' });
    page.sync(stage, { scene: stage.scene });
    expect(calls).not.toContain('attach'); // the set's own style needs nothing more
    use({ style: 'toon', sky: 'sky:hall' });
    calls.length = 0;
    page.sync(stage, { scene: stage.scene });
    const looked = ['gradient 0', 'shells 0 #141018']; // a look without a gradient or shells: none shown
    expect(calls).toEqual(['show sky:hall', 'budget 1', ...looked, 'attach lambert,toon', 'apply']);
    use({});
    calls.length = 0;
    page.sync(stage, { scene: stage.scene });
    expect(calls).toEqual(['show ', 'budget 1', ...looked, 'apply']); // joined for good: new meshes still follow the style
    expect(page.styled).toBe(true);
  });

  it("adds a later look's style once, and none a look already warmed asks for", () => {
    const { calls, page, stage, use } = fakes({ style: 'toon' });
    page.sync(stage, { scene: stage.scene });
    for (const style of ['pbr', 'toon', 'lambert', 'pbr'] as const) {
      use({ style });
      page.sync(stage, { scene: stage.scene });
    }
    expect(calls.filter((call) => /^(attach|add)/.test(call))).toEqual(['attach lambert,toon', 'add pbr']);
  });
});
