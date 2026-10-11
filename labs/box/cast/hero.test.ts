/**
 * @file Unit tests for the box's hero (labs/box/cast/hero.ts, PLAN.md WP 3.10): his numbers are the prototype's,
 * converted at 16 units a metre (PLAN.md Appendix C), over the controller's defaults only where the prototype set a
 * value; the feel meter measures them back (walk 5 m/s, apex v² / 2g, a dash of speed × duration, a reach above the
 * room's 0.75 m low wall and below its 3 m walls); a scene's tuning wins over his own; and he spawns as an animated
 * player actor.
 * @see labs/box/cast/hero.ts
 */
import { describe, expect, it } from 'vitest';
import { createCharacter, defineScene, measureFeel, physicsOf, type FeelReport } from '../../../engine/sim-api';
import { createHeadless } from '../../../engine';
import { HERO, HERO_BODY, heroCharacter, PROTOTYPE, spawnHero } from './hero';

describe('the hero', () => {
  it('has the prototype’s numbers in metres, over the controller’s defaults only where the prototype set one', () => {
    const defaults = createCharacter();
    expect(HERO.speed).toBe(PROTOTYPE.speed / 16);
    expect([HERO.speed, HERO.jumpSpeed, HERO.characterGravity, HERO.maxFall]).toEqual([5, 9.375, 30, 37.5]);
    expect([HERO.acceleration, HERO.deceleration, HERO.skid]).toEqual([56.25, 56.25, 56.25]);
    expect(HERO.feel.airControl).toBeCloseTo(420 / 900, 12);
    expect(HERO.feel.dash).toEqual({ speed: 16.25, duration: 0.2, cooldown: 0.45 });
    expect(HERO.feel.buffer).toBe(0.12);
    // what the prototype left unset keeps shardfall's values and the measured controller's
    expect([HERO.feel.coyote, HERO.feel.variableJump, HERO.feel.wallJump]).toEqual([
      defaults.feel.coyote,
      defaults.feel.variableJump,
      defaults.feel.wallJump,
    ]);
    expect([HERO.capsule, HERO.offset, HERO.snap, HERO.autostep]).toEqual([
      defaults.capsule,
      defaults.offset,
      defaults.snap,
      defaults.autostep,
    ]);
    expect(HERO_BODY).toEqual({ build: 'build:chibi', weapon: 'none' });
  });

  it('measures as tuned: 5 m/s, an apex of v²/2g, a dash of speed × duration, onto the low wall but not the walls', () => {
    const feel: FeelReport = measureFeel(HERO);
    expect(feel.topSpeed).toBeCloseTo(5, 6);
    expect(feel.apex).toBeCloseTo(9.375 ** 2 / (2 * 30), 1); // 1.46 m, within 2 cm
    expect(Math.abs(feel.apex - 9.375 ** 2 / 60)).toBeLessThan(0.02);
    expect(Math.abs(feel.dashDistance - 16.25 * 0.2)).toBeLessThan(0.02);
    expect(feel.reach).toBeGreaterThan(0.75);
    expect(feel.reach).toBeLessThan(3);
  });

  it('takes a scene’s tuning over his own numbers', () => {
    const tuned = heroCharacter({ speed: 6, jumpSpeed: 8, dashSpeed: 0 });
    expect([tuned.speed, tuned.jumpSpeed, tuned.feel.dash.speed]).toEqual([6, 8, 0]);
    expect(tuned.feel.dash.duration).toBe(0.2);
    expect(() => heroCharacter({ speed: -1 })).toThrow(/speed/);
  });

  it('spawns as the player, with an animator in his make', async () => {
    const scene = defineScene('test:hero-spawn', {
      physics: true,
      setup(w) {
        physicsOf(w).addBody({
          type: 'fixed',
          colliders: [{ shape: { type: 'box', size: [20, 1, 20] }, position: [0, -0.5, 0] }],
        });
        spawnHero(w, [1, 0, 2], Math.PI / 2);
      },
    });
    const engine = await createHeadless({ scene });
    engine.step(10);
    const [{ id }] = engine.entities('actor');
    const hero = engine.get(id) as unknown as { actor: Record<string, unknown>; animator: Record<string, unknown> };
    expect([hero.actor.player, hero.actor.yaw, hero.actor.grounded]).toEqual([true, Math.PI / 2, true]);
    expect([hero.actor.x, hero.actor.z]).toEqual([1, 2]);
    expect([hero.animator.build, hero.animator.weapon]).toEqual(['build:chibi', 'none']);
  });
});
