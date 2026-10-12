/**
 * @file Unit tests for actors on the stage (engine/gfx/puppets/actors.ts, PLAN.md WP 3.10), in Node: an actor with an
 * animator gets a puppet of the humanoid in its build, named and tagged for the ID pass, and one without gets none;
 * a draw puts the player's feet and puppet `alpha` of the way between its last two steps; his eye is the head socket;
 * first-person culling hides every part but the hands and shows them all again; a despawned actor's puppet goes; and
 * drawing, posing and culling never change the sim's hash. WP 8.9: an actor with clips is drawn posed by its clip
 * layer, as the clip is retargeted, in the body its component `puppet` names (the mannequin).
 * @see engine/gfx/puppets/actors.ts
 */
import { describe, expect, it } from 'vitest';
import { getBuild } from '../../anim/builds';
import { ClipLayerPool, defineClipSet, getClipSet } from '../../anim/clip/clipsets';
import { retargetPose } from '../../anim/clip/retarget';
import { createWorldPose, forwardKinematics, socketPosition } from '../../anim/fk';
import { Pose } from '../../anim/pose';
import { createSkeleton, JOINTS } from '../../anim/skeleton';
import { Vector3 } from '../../core/math';
import { readSet } from '../../../tools/anim/repack';
import { defineMannequin } from './bodies/mannequin';
import { createCharacter } from '../../physics/character';
import { physicsOf } from '../../physics/world';
import { spawnActor } from '../../sim/actors';
import { defineScene, startScene } from '../../sim/scene';
import { eyePoint } from '../cameras/first';
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
