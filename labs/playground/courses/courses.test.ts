/**
 * @file Unit tests for the playground's feel courses (labs/playground/courses/): each runs on the gym from a start on its
 * open floor, checks the bounds (labs/playground/courses/bounds.ts) besides its own numbers, and passes, every number
 * within its tolerance: the run `node x feel labs/playground` makes (tools/cmd/feel.test.ts runs it through the
 * command). The bounds take four numbers for each camera, three for first person.
 * @see labs/playground/courses/strip.ts
 * @see labs/playground/courses/jumps.ts
 * @see labs/playground/courses/air.ts
 * @see labs/playground/courses/bounds.ts
 */
import { describe, expect, it } from 'vitest';
import { getCourse, runCourse } from '../../../engine';
import { topHeight } from '../../../engine/sim-api';
import { GYM } from '../scenes/gym';
import { AIR_START } from './air';
import { bodyBounds, cameraBounds } from './bounds';
import { JUMPS_START } from './jumps';
import { STRIP_START } from './strip';

/** Each course's start. */
const STARTS = { strip: STRIP_START, jumps: JUMPS_START, air: AIR_START } as const;

describe('the playground’s courses', () => {
  it('check the body’s bounds and four of each camera’s, three of first person’s', () => {
    expect(bodyBounds(2).map((m) => m.metric)).toEqual(['footSlide', 'pop']);
    expect(cameraBounds(2)).toHaveLength(19);
  });

  for (const [name, start] of Object.entries(STARTS)) {
    it(`${name}: starts on the gym’s open floor and keeps every number within its tolerance`, () => {
      const course = getCourse(`course:playground-${name}`);
      expect(course.scene).toBe('playground:gym');
      expect(topHeight(GYM, start[0], start[2])).toBe(0); // nothing stands there
      const result = runCourse(course);
      expect(result.results.filter((r) => !r.pass && r.watch === undefined)).toEqual([]);
      expect(result.pass).toBe(true);
    });
  }
});
