/**
 * @file The ring's sparring partners (docs/PLAYGROUND.md §2.2, §7.3; PLAN.md WP 10.2): two people on the ring's canvas
 * (`RING_PARTNERS`: actors on `build:adult` in its south corners, either side of the top of its steps, turned toward
 * them) who take the player's
 * blows. A punch or a shot flinches one along the blow (its reactions, engine/sim/reactions.ts); a kick or the
 * uppercut hands it off to its ragdoll (engine/sim/ragdolls.ts `handOff`, `PARTNER_BLOWS`: the kick drives it back
 * off its feet, the uppercut lifts it), and it gets up the way it lies once it lies still. Their hit points come back
 * at every blow (the component `health`, labs/playground/cast/health.ts), so they never die.
 * `standPartners(w)` stands them and adds the systems `ragdolls` and `partners` (phase `rules`, after the step's blows
 * landed), last in a scene's setup.
 *
 * Invariants: everything a partner is lives in its components; partners step in id order; no random stream.
 *
 * Game code, sim-side: it imports only engine/sim-api.ts and the playground's own files.
 *
 * @example
 * // in a scene's setup, after the dummies: standPartners(w);
 * // a kick from the south: the partner flies north off its feet, lies still, then gets up from its back
 * @see labs/playground/cast/partners.test.ts
 */
import { addRagdolls, createCharacter, defineComponent, handOff, reactTo, spawnActor, Vector3, type Health, type MeleeState, type RagdollState, type World } from '../../../engine/sim-api'; // prettier-ignore
import { CAST_HP, castHealth } from './health';

/** Where the partners stand (m, on the canvas 1 m up) and face: the canvas's south corners, toward the steps. */
export const RING_PARTNERS: readonly { readonly at: readonly [number, number, number]; readonly yaw: number }[] = [
  { at: [64, 1, 8], yaw: 0.6 },
  { at: [68, 1, 8], yaw: -0.6 },
];

/** What each hard blow does, by its move: its push along the blow and up (m/s). A blow not here flinches. */
export const PARTNER_BLOWS: Readonly<Record<string, { along: number; up: number }>> = {
  'move:kick': { along: 4, up: 1.5 },
  'move:uppercut': { along: 1.5, up: 4 },
};

defineComponent('sparringPartner', { description: 'One of the ring’s sparring partners (WP 10.2).', fields: {} });

/** A partner and a player as this module reads them. */
type Partner = { id: number; actor: { x: number; z: number; yaw: number }; health: Health; ragdoll?: RagdollState };
type Player = { id: number; actor: { x: number; z: number }; melee?: MeleeState };

const along = new Vector3();

/** The system `partners`: each partner a blow landed on this step flinches or falls (see the file comment). */
function spar(w: World): void {
  const players = w.query('melee', 'actor') as unknown as Player[];
  for (const p of w.query('sparringPartner', 'health', 'actor') as unknown as Partner[]) {
    if (p.health.hitAt !== w.tick) continue;
    p.health.hp = CAST_HP;
    const striker = players.find((player) => player.melee?.hitAt === w.tick && player.melee.struck === p.id);
    const from = striker ?? (w.get(p.health.hitBy) as unknown as Player | undefined);
    if (!from?.actor) continue;
    along.set(p.actor.x - from.actor.x, 0, p.actor.z - from.actor.z);
    if (along.lengthSq() < 1e-12) along.set(Math.sin(p.actor.yaw), 0, Math.cos(p.actor.yaw)).negate();
    along.normalize();
    const hard = striker ? PARTNER_BLOWS[striker.melee!.move] : undefined;
    if (hard) handOff(w, p.id, { push: [along.x * hard.along, hard.up, along.z * hard.along] });
    else if (!p.ragdoll) reactTo(w, p.id, (r) => r.hit(along, p.actor.yaw, striker ? 1 : 0.6));
  }
}

/** Stands the ring's partners (`RING_PARTNERS`) and adds the systems that spar with them (see the file comment). */
export function standPartners<C extends object>(world: World<C>): number[] {
  const w = world as unknown as World;
  const ids = RING_PARTNERS.map(({ at, yaw }) => {
    const components = { health: castHealth(), sparringPartner: {} };
    return spawnActor(w, { at: [...at], yaw, character: createCharacter(), player: false, anim: { build: 'build:adult' }, components }); // prettier-ignore
  });
  addRagdolls(w);
  if (!w.systems.has('partners')) w.systems.add('partners', spar, { phase: 'rules' });
  return ids;
}
