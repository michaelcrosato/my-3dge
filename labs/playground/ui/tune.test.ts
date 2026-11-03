/**
 * @file Unit tests for the Tune panel's copy (labs/playground/ui/tune.ts `lookText`): the look drawn now, tuned and
 * combined through the settings, copied as a `defineLook` that the look kind's check accepts and that, drawn, gives
 * the same filters; the fields at their defaults left out of it. The panel's DOM is tests/e2e/playground-ui.spec.ts's.
 */
import { describe, expect, it } from 'vitest';
import { createHeadless, defineLook } from '../../../engine';
import { gym } from '../scenes/gym';
import { lookText, type LookNow } from './tune';

describe('Copy as look', () => {
  it('copies the filters drawn now as a defineLook that draws them again, defaults left out', async () => {
    const engine = await createHeadless({ scene: gym });
    const look = () => (engine as unknown as { look(): LookNow }).look();
    engine.set('post.combine', [{ look: 'look:cinematic', amount: 0.5 }]);
    engine.set('post.filters', { grade: { contrast: 1.3 }, duotone: { scope: 'objects', mid: '#ff0000' } });
    engine.set('post.strength', 0.8);
    const now = look();
    const text = lookText(now, 'look:test-tuned');
    expect(text.startsWith("defineLook('look:test-tuned', {")).toBe(true);
    expect(text).not.toContain('"tint": 0'); // grade's tint at its default
    const spec = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    expect(spec.filters.duotone).toEqual({ scope: 'objects', amount: 0.8, mid: '#ff0000' });
    defineLook('look:test-tuned', spec); // the kind's check accepts it
    engine.set('post.combine', []);
    engine.set('post.filters', {});
    engine.set('post.strength', 1);
    engine.set('post.look', 'look:test-tuned');
    expect(look().filters).toEqual(now.filters);
  });
});
