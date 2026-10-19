/**
 * @file Unit tests for the viewmodel's materials (engine/gfx/viewmodel/material.ts, PLAN.md WP 13.12): a classic
 * material is copied into the node material three.js draws it as, a node material cloned, each once per kind, with
 * their nodes (the body's folding by the `viewmodel` attribute and casting its whole shadow, the arms' lens and their
 * shadows taken where they really are) and the source's entry; a toon copy keeps the look's uniforms; a material with
 * no node material is left as it is with advice;
 * the lens's uniforms follow the frame's pose, its view matrix the drawn camera's. The GPU half (the arms drawn in front of a wall, in the ID pass) is
 * tests/e2e/playground-cameras.spec.ts.
 */
import { LineBasicMaterial, MeshLambertMaterial, MeshStandardNodeMaterial, PerspectiveCamera, type NodeMaterial } from 'three/webgpu'; // prettier-ignore
import { describe, expect, it } from 'vitest';
import { createLog } from '../../core/log';
import { createToonUniforms, MeshBandedToonNodeMaterial } from '../materials/toon';
import { apexFov } from '../cameras/effects';
import { placeCamera } from '../cameras/place';
import { makePose } from '../cameras/pose';
import { armsSpread, VIEWMODEL } from './lens';
import { createViewmodelLook } from './material';

describe('the viewmodel look', () => {
  it('copies a classic material into its node material once per kind: the body folding, the arms by their lens', () => {
    const look = createViewmodelLook();
    const source = new MeshLambertMaterial({ vertexColors: true, color: 0x336699 });
    source.userData.material = 'material:puppet';
    const [body, arms] = [look.body(source), look.arms(source)] as NodeMaterial[];
    for (const copy of [body, arms]) {
      expect(copy.isNodeMaterial).toBe(true);
      expect(copy.uuid).not.toBe(source.uuid);
      expect(copy.positionNode).not.toBeNull();
      expect(copy.userData.material).toBe('material:puppet'); // the style set re-points it by its entry
      expect((copy as unknown as MeshLambertMaterial).color.getHex()).toBe(0x336699);
    }
    expect(body.castShadowPositionNode).not.toBeNull(); // the whole body's shadow
    expect(body.receivedShadowPositionNode).toBeNull(); // shadows where skinning puts it, as any mesh takes them
    expect(arms.receivedShadowPositionNode).not.toBeNull(); // shadows where the arm really is, not where it is drawn
    expect(arms.positionNode).not.toBe(body.positionNode);
    expect([look.body(source), look.arms(source), look.arms(arms), look.body(arms)]).toEqual([body, arms, arms, arms]);
    expect([look.owns(body), look.owns(arms), look.owns(source)]).toEqual([true, true, false]);
    look.dispose();
  });

  it('clones a node material, a toon one keeping the look’s uniforms', () => {
    const look = createViewmodelLook();
    const pbr = new MeshStandardNodeMaterial({ roughness: 0.4 });
    const copy = look.arms(pbr) as MeshStandardNodeMaterial;
    expect(copy).toBeInstanceOf(MeshStandardNodeMaterial);
    expect([copy.roughness, copy.positionNode !== null]).toEqual([0.4, true]);
    const toon = createToonUniforms();
    const banded = look.body(new MeshBandedToonNodeMaterial({}, toon)) as MeshBandedToonNodeMaterial;
    expect(banded.toon).toBe(toon);
    look.dispose();
  });

  it('leaves a material with no node material as it is, with advice once', () => {
    const printed: string[] = [];
    const look = createViewmodelLook({ log: createLog({ console: { warn: (line) => printed.push(line), error: () => {} } }) }); // prettier-ignore
    const line = new LineBasicMaterial();
    expect([look.arms(line), look.body(line)]).toEqual([line, line]);
    expect(printed.filter((text) => text.includes('GFX_VIEWMODEL_MATERIAL'))).toHaveLength(1);
  });

  it('sets the lens for each frame: the spread of the picture’s lens, its near plane and the camera’s view', () => {
    const look = createViewmodelLook();
    const pose = makePose({ position: [3, 1.5, -2], yaw: 0.7, pitch: -0.3, roll: 0.1, fov: apexFov(110), near: 0.05 });
    look.frame(pose);
    expect(look.lens.spread).toBeCloseTo(armsSpread({ fov: apexFov(110), zoom: 1 }), 12);
    expect(look.lens.base).toBeCloseTo(0.05 * VIEWMODEL.lift, 12);
    // the view matrix the drawn camera has (engine/gfx/cameras/place.ts puts the pose on it)
    const camera = new PerspectiveCamera();
    placeCamera(pose, camera, 16 / 9);
    camera.updateMatrixWorld(true);
    const [mine, three] = [look.lens.view.elements, camera.matrixWorldInverse.elements];
    for (let i = 0; i < 16; i++) expect(mine[i]).toBeCloseTo(three[i], 9);
    look.frame(makePose({ position: [0, 0, 0], fov: 60, near: 0.1 }), 60);
    expect([look.lens.spread, look.lens.base]).toEqual([1, 0.1 * VIEWMODEL.lift]);
  });
});
