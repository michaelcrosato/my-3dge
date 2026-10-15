/**
 * @file The hero's fight, Box 5 (PLAN.md §9.0, WP 6.7): `heroFight(w, intents)`, the fight scene's step
 * (labs/box/scenes/fight.ts), first in each step, before the controller moves him. His numbers are `HERO_FIGHT`
 * (labs/box/cast/hero.ts).
 *
 * - **Attack** presses his combo (engine/anim/attack.ts `Combo`: slash, backslash, spin, each press within its
 *   window flowing into the next); during a dash it starts the thrust instead and cuts the dash. As a hit's strike
 *   begins he lunges along his heading (its `push`), and while its hit window is open every living foe its cone
 *   holds from his feet (engine/sim/hits.ts `coneHits`) is struck once a swing (labs/box/scenes/fight-rules.ts
 *   `strikeFoe`).
 * - **Skill** fires a bolt from just ahead of him at his heading (`fightShot`, flown by fight-foes.ts's shots), the
 *   event `shot` where it leaves, his hands thrust forward a moment (the pose `cast`).
 * - **His body** is told what plays: the move at its phase and share (the body state `body`, the arm path), the part
 *   that trails while it strikes (`trail`: his blade), a flinch after a blow (`hurt`), the cast.
 *
 * Invariants: everything he remembers is in his components (the combo and the thrust are loaded from `fightHero`
 * and saved back each step), so a restore continues exactly; nothing draws from a random stream.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the box's own files.
 *
 * @see labs/box/scenes/fight.test.ts
 */
import { coneHits, pressed, type Intents } from '../../../engine/sim-api';
import { HERO_FIGHT } from '../cast/hero';
import { foeSet, heroCombo, heroOf, heroThrust, strikeFoe, type FightWorld } from './fight-rules';

const combo = heroCombo();
const thrust = heroThrust();

/** A countdown in ticks, one step on. */
const down = (ticks: number) => Math.max(0, ticks - 1);

/** The hero's fight, one step (see the file comment). */
export function heroFight(w: FightWorld, intents: Intents): void {
  const hero = heroOf(w);
  if (!hero) return;
  const { id, actor, animator, fightHero: f } = hero;
  [f.bolt, f.cast, f.flinch, f.safe] = [down(f.bolt), down(f.cast), down(f.flinch), down(f.safe)];
  combo.load(f.combo);
  thrust.load(f.thrust);
  if (pressed(intents, 'attack')) {
    if (actor.dash > 0) {
      if (thrust.start()) [actor.dash] = [0];
    } else if (!thrust.busy) combo.press();
  }
  const attack = thrust.busy ? thrust : combo.current;
  const events = thrust.busy ? thrust.update(w.dt) : combo.update(w.dt);
  const hit = HERO_FIGHT.hits[attack.move.id];
  const [sin, cos] = [Math.sin(actor.yaw), Math.cos(actor.yaw)];
  if (hit && events.some((event) => event.type === 'active')) {
    [actor.vx, actor.vz] = [actor.vx + sin * hit.push, actor.vz + cos * hit.push];
  }
  if (hit && attack.busy && attack.hitOpen) {
    const feet: [number, number, number] = [actor.x, actor.y, actor.z];
    const struck = coneHits(foeSet(w), feet, actor.yaw, hit.shape).map((target) => ({ id: target }));
    attack.hits(
      struck,
      () => true,
      (target) => strikeFoe(w, target.id, hit, feet),
    );
  }
  if (pressed(intents, 'skill') && f.bolt === 0) {
    const { bolt } = HERO_FIGHT;
    const at: [number, number, number] = [actor.x + sin * bolt.ahead, actor.y + bolt.up, actor.z + cos * bolt.ahead];
    w.spawn({
      fightShot: {
        kind: 'bolt',
        team: 'hero',
        source: id,
        ...{ x: at[0], y: at[1], z: at[2] },
        ...{ vx: sin * bolt.speed, vy: 0, vz: cos * bolt.speed },
        ...{ radius: bolt.radius, life: bolt.life, damage: bolt.damage },
      },
    });
    w.emit('shot', { position: at, size: 1 });
    [f.bolt, f.cast] = [Math.round(bolt.cooldown / w.dt), Math.round(bolt.cast / w.dt)];
  }
  [f.combo, f.thrust] = [combo.save(), thrust.save()];
  const states = animator.states;
  const body = attack.busy ? attack.body : undefined;
  if (body) states.body = { move: attack.move.id, phase: body.phase, u: body.u };
  else delete states.body;
  const trail = attack.busy ? attack.trail(true) : undefined;
  if (trail) states.trail = trail;
  else delete states.trail;
  if (f.flinch > 0) states.hurt = true;
  else delete states.hurt;
  if (f.cast > 0) states.pose = 'cast';
  else delete states.pose;
}
