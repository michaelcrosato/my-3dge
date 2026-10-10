/**
 * @file Unit tests for skeleton contact sheets (engine/anim/sheet.ts): a sheet is reproducible, hashed (PLAN.md
 * WP 3.4, Done when), laid out as asked, and draws each view the way its name says.
 */
import { describe, expect, it } from 'vitest';
import { Fnv64 } from '../core/hash';
import { Quaternion, Vector3 } from '../core/math';
import { Pose } from './pose';
import { animSheet, SHEET_VIEWS, type SheetView } from './sheet';
import { createSkeleton } from './skeleton';

/** A pose with the left knee raised and the arms down. */
function stepping(): Pose {
  const turn = (x: number, y: number, z: number, angle: number) =>
    new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), angle);
  return new Pose()
    .setRotation('upperArmL', turn(0, 0, 1, -1.3))
    .setRotation('upperArmR', turn(0, 0, 1, 1.3))
    .setRotation('thighL', turn(1, 0, 0, -0.5))
    .setRotation('shinL', turn(1, 0, 0, 0.9));
}

/** The SVG's bone lines, as numbers. */
const lines = (svg: string) =>
  [
    ...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)" stroke="(#\w+)" stroke-width/g),
  ].map((match) => ({ x1: +match[1], y1: +match[2], x2: +match[3], y2: +match[4], color: match[5] }));

describe('animSheet', () => {
  it('is reproducible: the same frames give the same SVG and hash', () => {
    const make = () =>
      animSheet([new Pose(), { pose: stepping(), label: 'step' }], { views: ['front', 'side', 'top'] });
    const [a, b] = [make(), make()];
    expect(a.svg).toBe(b.svg);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(new Fnv64().string(a.svg).hex());
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('pins the rest sheet (a golden: it changes only when the drawing or the chibi build changes)', () => {
    expect(animSheet([new Pose()], { title: 'rest' }).hash).toBe('8f7539de0bbc1301');
  });

  it('changes its hash with the pose, the build, the views and the label', () => {
    const base = animSheet([stepping()]).hash;
    const moved = stepping().setRotation('head', new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2));
    const hashes = new Set([
      base,
      animSheet([moved]).hash,
      animSheet([stepping()], { skeleton: createSkeleton('build:bulky') }).hash,
      animSheet([stepping()], { views: ['front'] }).hash,
      animSheet([{ pose: stepping(), label: 'other' }]).hash,
    ]);
    expect(hashes.size).toBe(5);
  });

  it('lays frames out in rows of `columns` cards, one panel per view', () => {
    const frames = Array.from({ length: 5 }, () => new Pose());
    const sheet = animSheet(frames, { views: ['front', 'side', 'back'], columns: 2, cell: 100, title: 'five' });
    expect(sheet.frames).toBe(5);
    expect(sheet.width).toBe(2 * 300 + 3 * 6);
    expect(sheet.height).toBe(22 + 3 * (14 + 100) + 4 * 6);
    expect(sheet.svg.match(/<g transform=/g)).toHaveLength(5);
    expect(sheet.svg.match(/fill="#f6f6f4"/g)).toHaveLength(15);
    expect(sheet.svg).toContain('>five</text>');
    expect(animSheet([{ pose: new Pose(), label: 'a < b & "c"' }]).svg).toContain('a &lt; b &amp; &quot;c&quot;');
  });

  it("draws each view the way its name says: the character's left is blue", () => {
    const blueX = (view: SheetView) => {
      const sheet = animSheet([new Pose()], { views: [view], cell: 200, sockets: false });
      const segments = lines(sheet.svg);
      const mean = (color: string) => {
        const xs = segments.filter((s) => s.color === color).flatMap((s) => [s.x1, s.x2]);
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      };
      return mean('#2f6fd0') - mean('#d0412f');
    };
    expect(blueX('front')).toBeGreaterThan(30); // facing the viewer: its left on the page's right
    expect(blueX('back')).toBeLessThan(-30);
    expect(blueX('top')).toBeLessThan(-30); // from above and behind
    expect(Math.abs(blueX('side'))).toBeLessThan(5); // the sides overlap
    expect(Object.keys(SHEET_VIEWS)).toEqual(['front', 'side', 'back', 'top', 'threeQuarter']);
  });

  it('frames every pose inside its panel', () => {
    const raised = stepping();
    raised.rootPos.set(0.5, 0.4, 0);
    const sheet = animSheet([new Pose(), raised], { views: ['front', 'side', 'top', 'threeQuarter'], cell: 120 });
    for (const segment of lines(sheet.svg)) {
      for (const x of [segment.x1, segment.x2]) expect(x).toBeGreaterThanOrEqual(0);
      for (const x of [segment.x1, segment.x2]) expect(x).toBeLessThanOrEqual(4 * 120);
      for (const y of [segment.y1, segment.y2]) expect(y).toBeGreaterThanOrEqual(14);
      for (const y of [segment.y1, segment.y2]) expect(y).toBeLessThanOrEqual(14 + 120);
    }
  });
});
