/**
 * @file Unit tests for feel courses (engine/dev/feel/course.ts): a course is checked when defined, its measures
 * filled (from step 1, the course's last step as the end), and each problem named at once: a measure ending before it
 * starts or after the course, a time without its end or its speed, a camera metric without its camera or a move metric
 * with one, a hand gap without its point, a measure without a tolerance, two measures of one name, change-points out
 * of step order or past the end; courses list by id.
 * @see engine/dev/feel/course.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { defineCourse, getCourse, listCourses, METRICS } from './course';

/** A course on `registry` that measures `measures` over 120 steps of the gym. */
const course = (registry: ReturnType<typeof createRegistry>, id: string, measures: object[]) =>
  defineCourse(id, { scene: 'playground:gym', steps: 120, inputs: [[0, { move: [0, 1] }]], measures }, registry);

describe('courses', () => {
  it('fill each measure from step 1 to the course’s end, and list by id', () => {
    const registry = createRegistry();
    course(registry, 'course:b', [{ name: 'run', metric: 'speed', reference: 5.07, tolerance: { share: 0.02 } }]);
    course(registry, 'course:a', [{ name: 'apex', metric: 'apex', from: 10, to: 60, reference: 1.42, tolerance: { abs: 0.02 } }]); // prettier-ignore
    expect(getCourse('course:b', registry).measures[0]).toMatchObject({ from: 1, metric: 'speed', tolerance: { share: 0.02 } }); // prettier-ignore
    expect(getCourse('course:b', registry).measures[0].to).toBeUndefined();
    expect(listCourses(registry).map((c) => c.id)).toEqual(['course:a', 'course:b']);
    expect(METRICS).toEqual(expect.arrayContaining(['speed', 'footSlide', 'cameraJump']));
  });

  it('name every problem of a measure at once', () => {
    const registry = createRegistry();
    const bad = [
      { name: 'late', metric: 'speed', from: 90, to: 60, reference: 5, tolerance: { share: 0.02 } },
      { name: 'past', metric: 'speed', to: 200, reference: 5, tolerance: { share: 0.02 } },
      { name: 'endless', metric: 'time', reference: 0.13, tolerance: { ticks: 1 } },
      { name: 'how fast', metric: 'time', until: 'speedAbove', reference: 0.13, tolerance: { ticks: 1 } },
      { name: 'no camera', metric: 'cameraJump', reference: 0, tolerance: { abs: 0.3 } },
      { name: 'stray camera', metric: 'speed', camera: 'cam3=chase', reference: 5, tolerance: { share: 0.02 } },
      { name: 'no point', metric: 'handGap', reference: 0, tolerance: { abs: 0.03 } },
      { name: 'height when', metric: 'heightAt', reference: 30, tolerance: { abs: 0.5 } },
      { name: 'loose', metric: 'apex', reference: 1.42 },
      { name: 'loose', metric: 'apex', reference: 1.42, tolerance: { abs: 0.02 } },
    ];
    let message = '';
    try {
      course(registry, 'course:bad', bad);
    } catch (error) {
      message = String((error as Error).message);
    }
    expect(message).toMatch(/CORE_BAD_SPEC/);
    for (const problem of [
      'from 90 is after to 60',
      "to 200 is past the course's 120 steps",
      'a time measure names when it ends (until)',
      'speedAbove needs a value (m/s)',
      'cameraJump names its camera',
      'only a camera metric names a camera',
      'handGap names its point',
      'a heightAt measure names the state it waits for (until)',
      'give a tolerance',
      'two measures are named "loose"',
    ])
      expect(message).toContain(problem);
  });

  it('refuse change-points out of step order, or past the course’s end', () => {
    const registry = createRegistry();
    const measures = [{ name: 'run', metric: 'speed', reference: 5.07, tolerance: { share: 0.02 } }];
    const inputs = [
      [0, { move: [0, 1] }],
      [60, { b: ['crouch'] }],
      [30, { b: null }],
    ];
    expect(() => defineCourse('course:late', { scene: 'playground:gym', steps: 120, inputs, measures }, registry)).toThrow(/inputs\[2\] at step 30 comes after step 60/); // prettier-ignore
    const past = [
      [0, { move: [0, 1] }],
      [120, { b: null }],
    ];
    expect(() => defineCourse('course:past', { scene: 'playground:gym', steps: 120, inputs: past, measures }, registry)).toThrow(/inputs\[1\] is not \[step, change\] with a step from 0 to 119/); // prettier-ignore
  });
});
