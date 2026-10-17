/**
 * @file Unit tests for the shooter model's numbers and state (engine/physics/movement/model.ts): every default whose
 * description gives a source value in Apex's units is that value converted (1 u = 0.0254 m), the gaits' side and back
 * scales are Apex's 1, a spec fills what it leaves out from the defaults, and a new motion state is a character at rest
 * on flat ground, standing (its duck too) and holstered, with every field the component `motion` declares.
 * @see engine/physics/movement/model.ts
 */
import { describe, expect, it } from 'vitest';
import { parse, type Field } from '../../core/schema';
import { createMotionState, MODEL_FIELDS, MOTION_FIELDS } from './model';

describe('the shooter model’s numbers', () => {
  it('converts every source value its descriptions give from Apex’s units (1 u = 0.0254 m)', () => {
    const checked: string[] = [];
    for (const [group, field] of Object.entries(MODEL_FIELDS)) {
      const properties = (field as { properties?: Record<string, Field> }).properties ?? {};
      for (const [name, each] of Object.entries(properties)) {
        const sources = [...(each.description ?? '').matchAll(/([\d,.]+) u(?:\/s²|\/s)?(?!\w)/g)];
        if (!sources.length) continue;
        const units = Number(sources.at(-1)![1].replace(/,/g, ''));
        expect(each.default, `${group}.${name}: ${sources.at(-1)![0]}`).toBeCloseTo(units * 0.0254, 9);
        checked.push(`${group}.${name}`);
      }
    }
    // the gaits' 3, accel's 5, decel's 3, air's 3, the hop's cost, the stun's 2, the crouched hull, the slide's 12
    expect(checked).toHaveLength(30);
  });

  it('scales no gait by its direction from the view, as Apex does, and fills what a spec leaves out', () => {
    const m = parse(MODEL_FIELDS, { gaits: { run: 5 } });
    expect([m.gaits.side, m.gaits.back]).toEqual([1, 1]);
    expect(m.gaits).toMatchObject({ run: 5, sprint: 6.604, holstered: 1.15 });
    expect(m.turnRate).toBeCloseTo(4 * Math.PI, 12); // 720°/s, ours
  });

  it('starts a motion state at rest on the ground, standing and holstered, every field at its default', () => {
    expect(createMotionState()).toEqual({
      mode: 'ground',
      gait: 'idle',
      stance: 'stand',
      duck: 'standing',
      duckLeft: 0,
      duckTotal: 0,
      airDuck: false,
      crouchHeld: false,
      crouchToggle: false,
      sliding: false,
      slideAge: -1,
      slideBoost: 0,
      longJump: false,
      floorX: 0,
      floorY: 1,
      floorZ: 0,
      holstered: true,
      sprinting: false,
      sticky: false,
      stickyLeft: 0,
      jumped: false,
      fatigued: false,
      landAge: -1,
      fall: 0,
      flight: -1,
      keyRight: 0,
      keyForward: 0,
    });
    expect(Object.keys(createMotionState())).toEqual(Object.keys(MOTION_FIELDS));
  });
});
