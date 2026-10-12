/**
 * @file Unit tests for engine/app/look.ts (T1, PLAN.md WP 7.8): before each frame the page's look shows the look's sky
 * on the stage with the quality budget; the style set joins the warm-up once, at the first look whose style is not
 * the set's own, and from then on re-points what shows to the style drawn; a look in the set's own style, or none,
 * never joins it; the view comes back as it was given.
 * @see engine/app/look.ts
 */
import { Scene } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { LookEntry } from '../gfx/post/looks';
import type { Warmup } from '../gfx/warmup';
import { createPageLook } from './look';

/** A page look over fakes that record what it did. */
function fakes(start: Partial<LookEntry>) {
  const calls: string[] = [];
  let look = { sky: '', style: '', ...start } as LookEntry;
  const styles = {
    style: 'lambert' as const,
    attach: () => (calls.push('attach'), { dispose: () => calls.push('detach') }),
    apply: () => (calls.push('apply'), 0),
  };
  const stage = {
    scene: new Scene(),
    sky: {
      show: (id: string) => void calls.push(`show ${id}`),
      budget: ({ shadowCasters }: { shadowCasters: number | null }) => void calls.push(`budget ${shadowCasters}`),
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
  const use = (next: Partial<LookEntry>) => void (look = { sky: '', style: '', ...next } as LookEntry);
  return { calls, page, stage, use };
}

describe('the page look', () => {
  it("shows the look's sky with the quality budget, and gives the view back", () => {
    const { calls, page, stage } = fakes({ sky: 'sky:hall' });
    const view = { scene: stage.scene };
    expect(page.sync(stage, view)).toBe(view);
    expect(calls).toEqual(['show sky:hall', 'budget 1']);
    expect(page.styled).toBe(false);
  });

  it('joins the style set to the warm-up once, at the first look in another style, then keeps re-pointing', () => {
    const { calls, page, stage, use } = fakes({ style: 'lambert' });
    page.sync(stage, { scene: stage.scene });
    expect(calls).not.toContain('attach'); // the set's own style needs nothing more
    use({ style: 'toon', sky: 'sky:hall' });
    calls.length = 0;
    page.sync(stage, { scene: stage.scene });
    expect(calls).toEqual(['show sky:hall', 'budget 1', 'attach', 'apply']);
    use({});
    calls.length = 0;
    page.sync(stage, { scene: stage.scene });
    expect(calls).toEqual(['show ', 'budget 1', 'apply']); // joined for good: new meshes still follow the style
    expect(page.styled).toBe(true);
  });
});
