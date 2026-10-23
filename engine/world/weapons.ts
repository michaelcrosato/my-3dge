/**
 * @file Weapons as data (PLAN.md WP 13.20; docs/PLAYGROUND.md §7.2; doctrine: Common ground): the registry kind
 * `weapon`, a firearm's numbers in plain terms (`defineWeapon(id, spec)`): how fast it fires (`rate`) and whether it
 * fires on while the trigger is held (`auto`), the damage a shot takes from a person and how far it reaches, the cone
 * its shots stray in (`spread`: from the hip, more on the move, little down the sights), its recoil (`recoil`: a
 * kick a shot, [up, right] degrees, the burst's aim climbing by their sum, the last repeating; `settle` seconds after
 * the last shot the burst ends and its kick falls away, `recover` its time constant), its magazine and its two
 * reloads (a tactical one, and one from empty), its sights' lens
 * (`zoom`, at Apex's 70° field) and how fast they come up, how long it takes to draw and put away, where its shots
 * leave it (`muzzle`, in its frame), the prop it is drawn as (`prop`: its parts in its frame, +Z along the barrel
 * from the grip, +Y up, so `node x gallery prop` shows it) and the sound of its shot (`sound`, an `sfx` entry a game's
 * sound map plays for its `gunshot`, WP 13.22). engine/sim/weapons.ts fires them, engine/gfx/weapons.ts draws them,
 * and `recoilStep` and `spreadOf` are the numbers both read.
 *
 * Invariants: data and pure functions only; angles in degrees as the fields say, seconds and metres. Problems raise
 * `CORE_BAD_SPEC`; a missing id gets `weapon:gun` after a warning.
 *
 * Carried as a concept from Apex Legends' weapons (a fire rate, a hip and a sights cone, a recoil pattern, a
 * magazine and two reloads, the sights' zoom, holstering's speed).
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const pistol = defineWeapon('weapon:pistol', { rate: 6, damage: 18, magazine: 12, recoil: [[1.5, 0.1]] }, createRegistry());
 * recoilStep(pistol, 4); // [1.5, 0.1]: the fifth shot's kick, the last step repeating
 * spreadOf(pistol, 1, false); // 0.15: down the sights, still
 * @see engine/world/weapons.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { defineSchema } from '../core/schema';

/** A number field of a weapon (see `WEAPON_FIELDS`). */
const num = (value: number, minimum: number, unit: string, description: string) => ({ type: 'number', default: value, minimum, unit, description }) as const; // prettier-ignore

/** A `weapon` kind's fields (see the file comment). */
export const WEAPON_FIELDS = defineSchema({
  rate: num(5, 0.1, 'shots/s', 'How fast it fires.'),
  auto: { type: 'boolean', default: false, description: 'Whether it fires on while the trigger is held.' },
  damage: num(20, 0, 'hp', 'Hit points a shot takes from a person.'),
  range: num(100, 1, 'm', 'How far its shots reach.'),
  spread: { type: 'object', description: 'The cone its shots stray in, half-angles (deg).', default: { hip: 2, move: 1.5, ads: 0.15 }, properties: { hip: num(2, 0, 'deg', 'From the hip.'), move: num(1.5, 0, 'deg', 'Added on the move.'), ads: num(0.15, 0, 'deg', 'Down the sights.') } }, // prettier-ignore
  recoil: { type: 'array', items: { type: 'array', items: { type: 'number' } }, default: [[0.5, 0]], unit: 'deg', description: "Each shot's kick in a burst, [up, right]; the last repeats." }, // prettier-ignore
  settle: num(0.3, 0, 's', 'How long after its last shot a burst ends and its kick begins to fall away.'),
  recover: num(0.15, 0, 's', 'The time constant its kick falls away in once its burst ends (0: at once).'),
  magazine: { type: 'integer', default: 12, minimum: 1, description: 'Rounds a magazine holds.' },
  reload: { type: 'object', description: 'How long a reload takes (s).', default: { tactical: 1.25, empty: 1.5 }, properties: { tactical: num(1.25, 0, 's', 'With rounds left.'), empty: num(1.5, 0, 's', 'From empty.') } }, // prettier-ignore
  zoom: num(60, 1, 'deg', "The sights' lens at a 70° field of view (Apex's): how far aiming down them zooms."),
  sights: num(0.2, 0, 's', 'How long the sights take to come up.'),
  draw: num(0.3, 0, 's', 'How long it takes to draw, and to put away.'),
  muzzle: { type: 'array', items: { type: 'number' }, default: [0, 0.06, 0.3], unit: 'm', description: 'Where shots leave it, in its frame: +Z along the barrel from the grip, +Y up.' }, // prettier-ignore
  prop: { type: 'string', default: '', description: 'The prop it is drawn as, in its frame ("": none).' },
  sound: { type: 'string', default: 'sfx:pistolShot', description: 'The sound of its shot, an sfx entry (the sim never plays it).' }, // prettier-ignore
});

/** A `weapon` entry (see the file comment). */
export type WeaponKind = Omit<Entry<typeof WEAPON_FIELDS>, 'recoil' | 'muzzle'> & {
  readonly recoil: readonly (readonly [number, number])[];
  readonly muzzle: readonly [number, number, number];
};

/** What `defineWeapon` takes: any of the kind's fields (`spread` and `reload` field by field), the rest at their defaults. */ // prettier-ignore
export type WeaponSpec = Partial<Omit<WeaponKind, 'id' | 'kind' | 'spread' | 'reload'>> & {
  spread?: Partial<WeaponKind['spread']>;
  reload?: Partial<WeaponKind['reload']>;
};

/** The problems of a weapon beyond its fields: a recoil of [up, right] pairs, a muzzle of three numbers. */
function weaponProblems(kind: WeaponKind): string[] {
  const problems: string[] = [];
  if (!kind.recoil.length || !kind.recoil.every((k) => k.length === 2 && k.every(Number.isFinite))) problems.push(`recoil ${JSON.stringify(kind.recoil)} is not a list of [up, right] degrees`); // prettier-ignore
  if (kind.muzzle.length !== 3 || !kind.muzzle.every(Number.isFinite)) problems.push(`muzzle ${JSON.stringify(kind.muzzle)} is not [x, y, z] in metres`); // prettier-ignore
  return problems;
}

/** Declares the kind `weapon` on `registry`, with its default `weapon:gun`, unless it has it. */
export function weaponKind(registry: Registry): void {
  if (registry.kinds().includes('weapon')) return;
  registry.defineKind('weapon', {
    description: 'Firearms: fire rate, damage, range, spread, recoil, magazine, reloads, sights, draw time, muzzle and look.', // prettier-ignore
    fields: WEAPON_FIELDS,
    fallback: 'weapon:gun',
    defineWith: "defineWeapon('<id>', { rate: 6, damage: 18, magazine: 12 })",
    check: (entry) => weaponProblems(entry as unknown as WeaponKind),
  });
  registry.def('weapon', 'weapon:gun', {});
}
weaponKind(sharedRegistry);

/** Defines a weapon on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each problem. */ // prettier-ignore
export function defineWeapon(id: string, spec: WeaponSpec, registry: Registry = sharedRegistry): WeaponKind {
  weaponKind(registry);
  return registry.def('weapon', id, { ...spec } as Record<string, unknown>) as unknown as WeaponKind;
}

/** The weapon `id` of `registry` (the shared one by default); a missing id gives `weapon:gun`, with a warning. */
export function getWeapon(id: string, registry: Registry = sharedRegistry): WeaponKind {
  weaponKind(registry);
  return registry.get('weapon', id) as unknown as WeaponKind;
}

/** The kick of shot `n` of a burst (0: the first), [up, right] degrees: its recoil step, the last repeating. */
export function recoilStep(kind: WeaponKind, n: number): readonly [number, number] {
  return kind.recoil[Math.max(0, Math.min(n, kind.recoil.length - 1))];
}

/** The cone a shot strays in now (half-angle, deg): the hip's (and the move's, `moving`) toward the sights' by `aim`, 0 to 1. */ // prettier-ignore
export function spreadOf(kind: WeaponKind, aim: number, moving: boolean): number {
  const hip = kind.spread.hip + (moving ? kind.spread.move : 0);
  return hip + (kind.spread.ads - hip) * Math.max(0, Math.min(1, aim));
}
