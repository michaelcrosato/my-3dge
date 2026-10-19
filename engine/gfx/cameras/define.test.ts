/**
 * @file Unit tests for a game's own cameras (engine/gfx/cameras/define.ts): `defineCamera` adds a mode whose code
 * `cam3=<name>[,…]` `readCameraCode` and `createCamera` hand to its `create`, with the camera before it, so the rig
 * switches to it and blends into it; a name an engine camera has, or one that is not a word, is refused, and so is a
 * `create` that returns no camera (`GFX_BAD_GAME_CAMERA`).
 * @see engine/gfx/cameras/define.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry, registry } from '../../core/registry';
import { cameraEntry, CAMERA_NAMES, defineCamera, madeCamera } from './define';
import { createCamera, readCameraCode } from './place';
import { createCameraRig } from './rig';
import { createShoulderCamera } from './shoulder';

describe('a game’s own cameras', () => {
  it('are made from their code and the camera before them, and the rig blends into them', () => {
    const made: string[] = [];
    defineCamera('lowShot', {
      description: 'The shooter, low and close.',
      create: (code, { from }) => {
        made.push(code);
        return createShoulderCamera({ pitch: 0.2, distance: 2, from });
      },
    });
    expect(cameraEntry('lowShot')?.description).toBe('The shooter, low and close.');
    expect(readCameraCode('cam3=lowShot,1')).toEqual({ type: 'game', name: 'lowShot', code: 'cam3=lowShot,1' });
    expect(createCamera('cam3=lowShot').type).toBe('shoulder');
    const rig = createCameraRig('cam=iso');
    rig.update({ follow: [0, 0, 0] }, 1 / 60);
    rig.set('cam3=lowShot,2', { blend: true });
    rig.update({ follow: [0, 0, 0] }, 1);
    expect(rig.pose().distance).toBeCloseTo(2, 6);
    expect(made).toEqual(['cam3=lowShot', 'cam3=lowShot,2']);
    expect(registry.has('camera', 'lowShot')).toBe(true);
  });

  it('refuse an engine camera’s name, and a name that is not a word', () => {
    const own = createRegistry();
    const create = () => createShoulderCamera();
    expect(CAMERA_NAMES).toContain('shoulder');
    expect(() => defineCamera('shoulder', { create }, own)).toThrow(/CORE_BAD_SPEC.*engine camera's name/);
    expect(() => defineCamera('two words', { create }, own)).toThrow(/CORE_BAD_SPEC.*not a word/);
    expect(cameraEntry('mine', own)).toBeUndefined();
  });

  it('refuse a create that returns no camera, naming the camera and the fix, when it is made', () => {
    defineCamera('broken', { create: () => ({ position: [0, 0, 0] }) });
    expect(() => createCamera('cam3=broken')).toThrow(/GFX_BAD_GAME_CAMERA.*broken's create returned an object with position, not a camera/); // prettier-ignore
    expect(() => madeCamera('none', undefined)).toThrow(/returned undefined/);
    expect(madeCamera('ok', createShoulderCamera()).type).toBe('shoulder');
  });
});
