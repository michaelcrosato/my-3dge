/**
 * @file Unit tests for actors on the stage (engine/gfx/puppets/actors.ts, PLAN.md WP 3.10), in Node: an actor with an
 * animator gets a puppet of the humanoid in its build, named and tagged for the ID pass, and one without gets none;
 * a draw puts the player's feet and puppet `alpha` of the way between its last two steps; his eye is the head socket;
 * first-person culling hides every part but the hands and shows them all again; a despawned actor's puppet goes, kept
 * for the next actor of its build and body (a restart or a respawn makes no new mesh); and drawing, posing and culling
 * never change the sim's hash. WP 8.9: an actor with clips is drawn posed by its clip
 * layer, as the clip is retargeted, in the body its component `puppet` names (the mannequin). WP 7.8: an actor's
 * `secondary` hangs its cape and hair under its puppet, named for the ID pass and counted as the actor's, and they go
 * with the component; its `reactions` bend its spine with the flinch and lay a body knocked forward on its face, read
 * from the sim and never written. WP 13.10: the feet stand on the ground the sim's queries find. WP 13.11: an actor's
 * `actions` turn its puppet over mid-roll, read from the sim and never written; one riding a zipline holds its cable.
 * @see engine/gfx/puppets/actors.ts
 */
import { PerspectiveCamera, Quaternion, type Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { getBuild } from '../../anim/builds';
import { ClipLayerPool, defineClipSet, getClipSet } from '../../anim/clip/clipsets';
import { retargetPose } from '../../anim/clip/retarget';
import { createWorldPose, forwardKinematics, socketPosition } from '../../anim/fk';
import { Pose } from '../../anim/pose';
import { lyingOf } from '../../anim/reactions';
import { createSkeleton, JOINTS } from '../../anim/skeleton';
import { Vector3 } from '../../core/math';
import { readSet } from '../../../tools/anim/repack';
import { defineMannequin } from './bodies/mannequin';
import { createCharacter } from '../../physics/character';
import { physicsOf } from '../../physics/binding';
import { spawnActor } from '../../sim/actors';
import { reactTo } from '../../sim/reactions';
import { actOn } from '../../sim/actorActions';
import { defineActions } from '../../../tools/anim/library';
import { defineScene, startScene } from '../../sim/scene';
import { eyePoint } from '../cameras/first';
import { listDrawables } from '../idpass';
import { createMaterialLibrary } from '../materials/library';
import { createActorPuppets } from './actors';

/** A floor, the player (animated, heroic) at (1, 0, 2), and an actor without an animator at (4, 0, 2). */
const scene = defineScene('test:actor-puppets', {
  physics: true,
  setup(w) {
    const floor = { shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] } as const;
    physicsOf(w).addBody({ type: 'fixed', colliders: [floor] });
    spawnActor(w, { at: [1, 0, 2], character: createCharacter(), anim: { build: 'build:heroic' } });
    spawnActor(w, { at: [4, 0, 2], character: createCharacter(), player: false });
  },
});

/** The scene started and stepped once, and its actors on a fresh module. */
function start() {
  const { world } = startScene(scene);
  world.step({});
  const actors = createActorPuppets({ materials: createMaterialLibrary() });
  return { world, actors };
}

describe('actors drawn as puppets', () => {
  it('draws an animated actor as a humanoid puppet in its build, and an actor without an animator not at all', () => {
    const { world, actors } = start();
    const drawn = actors.capture(world.query('actor'), world.dt);
    expect([...drawn]).toEqual([1]);
    const puppet = actors.puppets.get(1)!;
    expect(puppet.mesh.name).toBe('actor#1');
    expect(puppet.mesh.userData).toMatchObject({ entity: 1, protagonist: true, body: 'body:humanoid' });
    expect(puppet.compiled.skeleton.build.id).toBe('build:heroic');
    expect(actors.root.children).toEqual([puppet.mesh]);
  });

  it('puts the player alpha of the way between his last two steps, his eye at the head socket', () => {
    const { world, actors } = start();
    actors.capture(world.query('actor'), world.dt);
    for (let i = 0; i < 20; i++) world.step({ move: [1, 0] });
    actors.capture(world.query('actor'), world.dt);
    const x0 = (world.get(1)!.actor as { x: number }).x;
    world.step({ move: [1, 0] });
    actors.capture(world.query('actor'), world.dt);
    const x1 = (world.get(1)!.actor as { x: number }).x;
    actors.draw(0.25);
    const player = actors.player()!;
    expect(player.id).toBe(1);
    expect(player.feet[0]).toBeCloseTo(x0 + (x1 - x0) * 0.25, 9);
    const root = actors.puppets.get(1)!.mesh.skeleton.bones[0];
    expect(Math.abs(root.position.x - player.feet[0])).toBeLessThan(0.05); // the root leans with the walk
    expect(player.posed!.eye).toEqual(eyePoint(player.posed!.skeleton, player.posed!.world));
    expect(player.posed!.eye[1] - player.feet[1]).toBeGreaterThan(1.2);
  });

  it('hides every part but the hands from first person, and shows them all again', () => {
    const { world, actors } = start();
    actors.capture(world.query('actor'), world.dt);
    actors.draw(1);
    const hidden = actors.cull(actors.player()!.posed!.eye);
    expect(hidden).toEqual(JOINTS.filter((joint) => joint !== 'handL' && joint !== 'handR'));
    const geometry = actors.puppets.get(1)!.mesh.geometry;
    const [index, weight] = [geometry.getAttribute('skinIndex'), geometry.getAttribute('skinWeight')];
    const shown = new Set<string>();
    for (let v = 0; v < index.count; v++) if (weight.getX(v) === 1) shown.add(JOINTS[index.getX(v) - 1] ?? 'root');
    expect([...shown].sort()).toEqual(['handL', 'handR']);
    expect(actors.cull(null)).toEqual([]);
    for (let v = 0; v < index.count; v++) expect(weight.getX(v)).toBe(1);
  });

  it('stands the puppets’ feet on the ground the sim’s queries find (WP 13.10)', () => {
    const step = { probe: (_x: number, _z: number) => ({ y: 0.1, normal: { x: 0, y: 1, z: 0 } }) }; // a 10 cm step
    const sole = (queries: typeof step | null) => {
      const { world, actors } = start();
      actors.capture(world.query('actor'), world.dt, queries as never);
      actors.draw(1);
      const { skeleton, world: pose } = actors.player()!.posed!;
      return socketPosition(skeleton, pose, 'contactL').y;
    };
    expect(sole(step) - sole(null)).toBeGreaterThan(0.07); // up on the step
  });

  it('lets a despawned actor’s puppet go, and never changes the sim', () => {
    const { world, actors } = start();
    const { world: alone } = startScene(scene);
    alone.step({});
    for (let i = 0; i < 30; i++) {
      for (const w of [world, alone]) w.step({ move: [0, 1], b: i < 10 ? ['jump'] : [] });
      actors.capture(world.query('actor'), world.dt);
      actors.draw(0.5);
      actors.cull(actors.player()!.posed!.eye);
    }
    expect(world.hash()).toBe(alone.hash());
    world.despawn(1);
    expect([...actors.capture(world.query('actor'), world.dt)]).toEqual([]);
    expect([actors.puppets.size, actors.root.children.length]).toEqual([0, 0]);
  });

  it('keeps a puppet given up for the next actor of its build and body: a restart makes no new skinned mesh', () => {
    const { world, actors } = start();
    actors.capture(world.query('actor'), world.dt);
    const worn = actors.puppets.get(1)!.mesh;
    actors.capture([]); // a restart reads the world afresh (engine/app/view.ts)
    expect([actors.puppets.size, actors.root.children.length]).toEqual([0, 0]);
    actors.capture(world.query('actor'), world.dt);
    expect(actors.puppets.get(1)!.mesh).toBe(worn);
    expect([worn.parent, worn.name]).toEqual([actors.root, 'actor#1']);
    world.despawn(1);
    actors.capture(world.query('actor'), world.dt);
    const next = spawnActor(world, { at: [2, 0, 2], character: createCharacter(), anim: { build: 'build:heroic' } });
    world.step({});
    actors.capture(world.query('actor'), world.dt);
    expect(actors.puppets.get(next)!.mesh).toBe(worn); // the respawned actor wears it, named for him
    expect([worn.name, worn.userData.entity]).toEqual([`actor#${next}`, next]);
  });

  it('draws an actor with clips posed by its clip layer, in the body its puppet names (WP 8.9)', () => {
    defineClipSet(readSet('quaternius'));
    defineMannequin(getClipSet('clipset:quaternius'));
    const clips = { sets: ['clipset:quaternius'], ik: false, play: { clip: 'Sword_Attack', fade: 0, at: 0.6 } };
    const anim = { build: 'build:mannequin' };
    const at = [2, 0, 3] as const;
    const mannequin = defineScene('test:actor-puppets-clips', {
      physics: true,
      setup(w) {
        const floor = { shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] } as const;
        physicsOf(w).addBody({ type: 'fixed', colliders: [floor] });
        spawnActor(w, { at, character: createCharacter(), player: false, anim, clips, body: 'body:mannequin' });
      },
    });
    const { world } = startScene(mannequin);
    world.step({});
    const actors = createActorPuppets({ materials: createMaterialLibrary() });
    actors.capture(world.query('actor'), world.dt);
    actors.draw(1);
    const puppet = actors.puppets.get(1)!;
    expect(puppet.compiled.body.id).toBe('body:mannequin');
    // the clip's frame at its time now, retargeted onto the mannequin where its feet are: what the puppet shows
    const { clips: data, actor } = world.get(1) as unknown as { clips: { state: { slots: { t: number }[] } }; actor: { x: number; y: number; z: number } }; // prettier-ignore
    const skeleton = createSkeleton(getBuild('build:mannequin'));
    const baked = new ClipLayerPool().library('clipset:quaternius').bake('Sword_Attack');
    const pose = retargetPose(baked, data.state.slots[0].t, skeleton, new Pose(), { ik: false, lift: false });
    pose.rootPos.add(new Vector3(actor.x, actor.y, actor.z));
    const world2 = forwardKinematics(skeleton, pose, createWorldPose());
    const [drawn, expected] = [new Vector3(), new Vector3()];
    for (const socket of ['weaponR', 'weaponL', 'headTop', 'contactL', 'contactR'] as const) {
      expect(puppet.socketPosition(socket, drawn).distanceTo(socketPosition(skeleton, world2, socket, expected))).toBeLessThan(1e-6); // prettier-ignore
    }
  });
});

describe('an actor’s reactions and secondary motion drawn (WP 7.8)', () => {
  const chainNames = (mesh: Mesh) => mesh.children.filter((child) => (child as Mesh).isMesh).map((child) => child.name);

  it('hangs its cape and hair under its puppet, named for the ID pass and counted as the actor’s, until they go', () => {
    const { world, actors } = start();
    world.add(1, 'secondary', { cape: true, hair: 'long' });
    for (let i = 0; i < 20; i++) {
      world.step({ move: [0, 1] });
      actors.capture(world.query('actor'), world.dt);
      actors.draw(1);
    }
    const puppet = actors.puppets.get(1)!;
    expect(chainNames(puppet.mesh).sort()).toEqual(['actor#1/cape', 'actor#1/hair']);
    const feet = actors.player()!.feet;
    const cape = puppet.mesh.children.find((child) => child.name === 'actor#1/cape') as Mesh;
    const middle = cape.geometry.boundingSphere!.center;
    expect(middle.y - feet[1]).toBeGreaterThan(0.3); // on his back, above his knees
    expect(middle.z - feet[2]).toBeLessThan(0); // behind him as he walks along +Z
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(feet[0], feet[1] + 1.5, feet[2] - 4);
    camera.lookAt(feet[0], feet[1] + 1, feet[2]);
    camera.updateMatrixWorld();
    const drawn = listDrawables(actors.root, camera).drawables.find((d) => d.name === 'actor#1/cape');
    expect(drawn).toMatchObject({ entity: 1, protagonist: 'actor#1', reason: null });
    world.remove(1, 'secondary');
    world.step({});
    actors.capture(world.query('actor'), world.dt);
    actors.draw(1);
    expect(chainNames(puppet.mesh)).toEqual([]);
    expect(actors.layers().get(1)?.secondary).toBeNull();
  });

  it('bends its spine with its flinch and lays a body knocked forward on its face, never changing the sim', () => {
    const { world, actors } = start();
    const { world: alone } = startScene(scene);
    alone.step({});
    for (const w of [world, alone]) reactTo(w, 1, (r) => r.hit(new Vector3(1, 0, 0), 0, 3));
    for (let i = 0; i < 4; i++) for (const w of [world, alone]) w.step({});
    const head = (entities: Iterable<Record<string, unknown> & { id: number }>) => {
      const own = createActorPuppets({ materials: createMaterialLibrary() });
      own.capture(entities, world.dt);
      own.draw(1);
      return own.puppets.get(1)!.socketPosition('headTop');
    };
    const entities = world.query('actor') as unknown as (Record<string, unknown> & { id: number })[];
    const still = entities.map((e) => ({ ...e, reactions: { ...(e.reactions as object), flinch: [0, 0, 0, 0] } }));
    expect(head(entities).distanceTo(head(still))).toBeGreaterThan(0.03); // the flinch leans him
    for (const w of [world, alone]) reactTo(w, 1, (r) => r.knockDown(new Vector3(0, 0, 1), 0)); // pushed forward
    for (let i = 0; i < 30; i++) {
      for (const w of [world, alone]) w.step({});
      actors.capture(world.query('actor'), world.dt);
      actors.draw(1);
    }
    const chest = actors.puppets.get(1)!.mesh.skeleton.bones[JOINTS.indexOf('chest') + 1];
    expect(lyingOf(chest.getWorldQuaternion(new Quaternion()))).toBe('down'); // on his face, as the sim says
    expect(world.hash()).toBe(alone.hash());
  });

  it('puts the hands of an actor riding a zipline on its cable, over his drawn feet, as the sim says (WP 13.11)', () => {
    const { world, actors } = start();
    const [hero] = world.query('actor') as unknown as (Record<string, unknown> & { id: number; actor: { x: number; y: number; z: number } })[]; // prettier-ignore
    const { x, z } = hero.actor;
    const hang = 2.032;
    const riding = { ...hero, actor: { ...hero.actor, y: 3 }, motion: { mode: 'zipline', ride: 99, rideDir: 1 } };
    const cable = { id: 99, zipline: { from: [x, 3 + hang, z - 10], to: [x, 3 + hang, z + 10] } };
    for (let i = 0; i < 20; i++) actors.capture([riding, cable], world.dt); // the hands reaching up as the ride's weight eases in
    actors.draw(1);
    const puppet = actors.puppets.get(1)!;
    const [left, right] = [puppet.socketPosition('weaponL'), puppet.socketPosition('weaponR')];
    expect(right.distanceTo(new Vector3(x, 3 + hang, z + 0.07))).toBeLessThan(0.01); // ahead along the ride
    expect(left.distanceTo(new Vector3(x, 3 + hang, z - 0.07))).toBeLessThan(0.01);
  });

  it('turns an actor rolling as its actions say: his head under his hips mid-roll, never changing the sim (WP 13.11)', () => {
    defineActions();
    const { world, actors } = start();
    const { world: alone } = startScene(scene);
    alone.step({});
    for (const w of [world, alone]) actOn(w, 1, (a) => a.play('roll'));
    let under = false;
    for (let i = 0; i < 60; i++) {
      for (const w of [world, alone]) w.step({});
      actors.capture(world.query('actor'), world.dt);
      actors.draw(1);
      const puppet = actors.puppets.get(1)!;
      const pelvis = puppet.mesh.skeleton.bones[JOINTS.indexOf('pelvis') + 1].getWorldPosition(new Vector3());
      under ||= puppet.socketPosition('headTop').y < pelvis.y;
    }
    expect(under).toBe(true);
    expect(actors.layers().get(1)).toBeDefined();
    expect(world.hash()).toBe(alone.hash());
  });
});
