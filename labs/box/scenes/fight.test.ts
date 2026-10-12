/**
 * @file Unit tests for the fight, Box 5 (labs/box/scenes/fight.ts and its rules, PLAN.md WP 6.7): the scripted fight
 * (tests/replays/box-5-fight.replay.json) gives its golden hash twice over, kills at least three foes and throws a
 * body more than 1 m up (Done-when 1), its blows landing as `damage` events with their hit points; the hero's combo
 * chains slash, backslash and spin, and out of a dash attack is the thrust; at most three foes swing or pounce at
 * once (his attack tokens), and every foe winding up shows its telegraph, filling; a foe's swing hits a hero who
 * stands in its arc and misses one who stepped out; `box:fight-1000` is the same fight with 1,000. WP 6.2 in the box
 * (WP 7.8, ADR-0018 amendment 1): the fight's blows go through the bodies' reactions: the big ones knock walkers down,
 * they lie (their bodies told `down`) and get up the way they lie, attacking nothing meanwhile, and the slain die; a
 * foe's blow flinches the hero, and his flinch springs back; he wears his cape (`secondary`), which the view draws
 * (engine/gfx/puppets/actors.test.ts, tests/e2e/box-fight.spec.ts).
 * @see labs/box/scenes/fight.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHeadless, floorHeight, type Intents } from '../../../engine';
import { ATTACK_TOKENS, defineScene, inTelegraph, nearMiss, type DamageEvent } from '../../../engine/sim-api';
import { HERO } from '../cast/hero';
import { WALKER_ATTACK, WALKER_SWING } from '../cast/walker';
import { HALL_LEVEL } from './hall';
import { fight, fightStep, setupFight } from './fight';
import { fight1000 } from './fight-1000';
import {
  heroOf,
  hurtHero,
  type FightComponents,
  type FightEvents,
  type FightFoe,
  type FightHero,
  type FightTelegraph,
} from './fight-rules';

type Engine = Awaited<ReturnType<typeof createHeadless>>;
type Foe = {
  crowdMember: { state: string; x: number; y: number; z: number };
  crowdWisp?: object;
  crowdWalker?: object;
  crowdBody: { state: { state?: { weights: { down: number } } } };
  reactions?: FightComponents['reactions'];
  fightFoe: FightFoe;
  fightTelegraph: FightTelegraph;
  fightHealth: { hp: number };
};
type Replay = {
  steps: number;
  inputs: [number, Record<string, unknown>][];
  hashes: Record<string, Record<string, string>>;
};

const REPLAY = JSON.parse(readFileSync('tests/replays/box-5-fight.replay.json', 'utf8')) as Replay;
const golden = (replay: Replay) => replay.hashes[`${process.platform}-${process.arch}`][replay.steps];
const foes = (engine: Engine) =>
  engine.entities('fightFoe').map(({ id }) => [id, engine.get(id) as unknown as Foe] as const);

/** Plays a replay's inputs step by step (held intents repeat, `p` for its step, null clears), calling `each`. */
function drive(engine: Engine, replay: Replay, each: (step: number) => void): void {
  const held: Record<string, unknown> = {};
  let next = 0;
  for (let k = 0; k < replay.steps; k++) {
    let pressed: unknown;
    while (next < replay.inputs.length && replay.inputs[next][0] === k) {
      for (const [key, value] of Object.entries(replay.inputs[next++][1])) {
        if (key === 'p') pressed = value;
        else if (value === null) delete held[key];
        else held[key] = value;
      }
    }
    engine.step(1, { ...held, ...(pressed ? { p: pressed } : {}) } as Intents);
    each(k + 1);
  }
}

describe('the fight', () => {
  it('kills at least 3 and throws a body more than 1 m up in box-5-fight, to its golden hash, twice', async () => {
    const run = async () => {
      const engine = await createHeadless({ scene: fight });
      const killed = new Map<number, { from: number; peak: number }>();
      let attackers = 0;
      drive(engine, REPLAY, () => {
        let busy = 0;
        for (const [id, foe] of foes(engine)) {
          const a = foe.crowdMember;
          if (foe.fightHealth.hp <= 0 && !killed.has(id)) killed.set(id, { from: a.y, peak: a.y });
          const fall = killed.get(id);
          if (fall) fall.peak = Math.max(fall.peak, a.y);
          if (!foe.crowdWisp && foe.fightFoe.phase !== 'idle') busy++;
          if (foe.fightFoe.phase === 'wind' && !foe.crowdWisp) {
            expect(foe.fightTelegraph.telegraph).not.toBe('');
            expect(foe.fightTelegraph.u).toBeGreaterThanOrEqual(0);
            expect(foe.fightTelegraph.u).toBeLessThanOrEqual(1);
          }
        }
        attackers = Math.max(attackers, busy);
      });
      return { engine, killed, attackers, hash: engine.hash() };
    };
    const [first, again] = [await run(), await run()];
    expect(first.hash).toBe(golden(REPLAY));
    expect(again.hash).toBe(first.hash);
    expect(first.killed.size).toBeGreaterThanOrEqual(3); // Done-when 1: at least 3 deaths
    const rises = [...first.killed.values()].map(({ from, peak }) => peak - from);
    expect(Math.max(...rises)).toBeGreaterThan(1); // Done-when 1: a body launched more than 1 m up
    expect(first.attackers).toBeGreaterThan(0);
    expect(first.attackers).toBeLessThanOrEqual(ATTACK_TOKENS.cap); // the hero's tokens: three at once
  }, 120_000);

  it('lands its blows as damage events with their hit points, as the page draws its numbers from them', async () => {
    const events: DamageEvent[] = [];
    const watched = defineScene<FightComponents, FightEvents>('box:fight-watched', {
      level: 'level:hall',
      physics: true,
      settings: fight.settings,
      setup(w) {
        setupFight(w);
        w.events.on('damage', (event) => events.push(event));
      },
      step: fightStep,
    });
    const engine = await createHeadless({ scene: watched });
    drive(engine, REPLAY, () => {});
    expect(engine.hash()).toBe(golden(REPLAY)); // a listener changes nothing
    const dealt = events.filter((event) => event.source === 1);
    expect(dealt.length).toBeGreaterThanOrEqual(3);
    expect(dealt.every((event) => event.amount > 0 && event.at.every(Number.isFinite))).toBe(true);
    expect(dealt.filter((event) => event.killed).length).toBeGreaterThanOrEqual(3);
  });

  it('chains the combo slash, backslash, spin; out of a dash attack is the thrust', async () => {
    const engine = await createHeadless({ scene: fight });
    engine.step(1);
    const moves: string[] = [];
    const watch = () => {
      const hero = engine.get(1) as unknown as { animator: { states: { body?: { move: string } } } };
      const move = hero.animator.states.body?.move;
      if (move && moves.at(-1) !== move) moves.push(move);
    };
    for (let k = 0; k < 3; k++) {
      engine.step(1, { p: ['attack'] });
      watch();
      for (let i = 0; i < 20; i++) {
        engine.step(1);
        watch();
      }
    }
    expect(moves).toEqual(['move:slash', 'move:backslash', 'move:spin']);
    for (let i = 0; i < 60; i++) engine.step(1);
    engine.step(1, { move: [1, 0], p: ['dash'] });
    engine.step(1, { move: [1, 0], p: ['attack'] });
    watch();
    expect(moves.at(-1)).toBe('move:thrust');
    const hero = engine.get(1) as unknown as { actor: { dash: number }; fightHero: FightHero };
    expect(hero.actor.dash).toBe(0); // the thrust cuts the dash
  });

  it('hits a hero who stands in a walker’s arc as it strikes, and calls one who stepped just out a near miss', () => {
    const place = { telegraph: WALKER_SWING.id, position: [0, 0, 0], yaw: 0, u: 1 } as const;
    const middle = (z: number) => [0, HERO.capsule.radius + HERO.capsule.height / 2, z] as const;
    const r = HERO.capsule.radius;
    expect(inTelegraph(WALKER_SWING, place, middle(WALKER_ATTACK.stand), r)).toBe(true); // where it winds up from
    expect(inTelegraph(WALKER_SWING, place, middle(1.8), r)).toBe(false); // stepped back
    expect(nearMiss(WALKER_SWING, place, middle(1.8), r)).toBe(true);
    expect(inTelegraph(WALKER_SWING, { ...place, yaw: Math.PI }, middle(WALKER_ATTACK.stand), r)).toBe(false);
  });

  it('knocks walkers down with its big blows: they lie, get up the way they lie and attack nothing meanwhile; the slain die', async () => {
    const engine = await createHeadless({ scene: fight });
    const played = new Map<number, string[]>();
    let lying = 0;
    drive(engine, REPLAY, () => {
      for (const [id, foe] of foes(engine)) {
        const react = foe.reactions;
        if (!react) continue;
        expect(foe.crowdWalker).toBeDefined(); // only humanoids react
        const list = played.get(id) ?? [];
        if (list.at(-1) !== react.playing) list.push(react.playing);
        played.set(id, list);
        if (foe.crowdMember.state !== 'alive' || react.playing === '') continue;
        expect([foe.fightFoe.phase, foe.fightTelegraph.telegraph]).toEqual(['idle', '']); // down: no attack
        if (react.playing === 'down' && react.timeline[0] === 1) {
          expect(foe.crowdBody.state.state!.weights.down).toBeGreaterThan(0.9); // its reaction lays its body down
          lying++;
        }
      }
    });
    const runs = [...played.values()].map((list) => list.join('>'));
    expect(runs.some((run) => /down>getUp(Back|Front)/.test(run))).toBe(true);
    expect(runs.filter((run) => run.includes('down')).length).toBeGreaterThanOrEqual(3);
    expect(runs.some((run) => run.endsWith('die'))).toBe(true);
    expect(lying).toBeGreaterThan(0);
  });

  it('flinches the hero through his reactions when a foe’s blow lands, springing back; he wears his cape', async () => {
    const hurt = defineScene<FightComponents, FightEvents>('box:fight-hurt', {
      level: 'level:hall',
      physics: true,
      settings: fight.settings,
      setup: setupFight,
      step(w, intents) {
        fightStep(w, intents);
        const hero = heroOf(w);
        if (w.tick === 30 && hero) hurtHero(w, 5, [hero.actor.x - 1, hero.actor.y, hero.actor.z], -1);
      },
    });
    const engine = await createHeadless({ scene: hurt });
    const flinch = () => (engine.get(1) as unknown as FightComponents).reactions.flinch;
    engine.step(32);
    const [side, forward] = flinch();
    expect(Math.hypot(side, forward)).toBeGreaterThan(0.02); // a blow from his left leans him
    engine.step(120);
    expect(Math.hypot(flinch()[0], flinch()[1])).toBeLessThan(1e-3); // and the spring brings him back
    expect((engine.get(1) as unknown as FightComponents).secondary).toMatchObject({ cape: true });
  });

  it('has a preset for 1,000, the same fight with more', async () => {
    expect(fight1000.settings).toEqual({ 'box.crowd.count': 1000 });
    const engine = await createHeadless({ scene: fight1000 });
    engine.step(2);
    expect(foes(engine)).toHaveLength(1000);
    expect(foes(engine).every(([, foe]) => foe.fightHealth.hp > 0)).toBe(true);
    const hero = engine.get(1) as unknown as { fightTokens: object; animator: { weapon: string } };
    expect(hero.fightTokens).toEqual(expect.objectContaining({ cap: ATTACK_TOKENS.cap }));
    expect(hero.animator.weapon).toBe('sword');
    expect(floorHeight(HALL_LEVEL, 32, 22)).toBeGreaterThanOrEqual(0);
  });
});
