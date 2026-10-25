/**
 * @file The acceptance of the eval task playground-camera (evals/playground-camera/prompt.md), run by `node x evals`
 * in the attempt's copy: `cam3=crane` (labs/playground/cameras/crane.ts) is a game camera the codes reach; its rig
 * settles 10 m from the player looking down 35°, behind and above him, follows him as he goes and turns to a code's
 * heading; the playground's page loads it, and the five modes T steps through are as they were.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createCameraRig, readCameraCode } from '../../engine';
import { PLAYGROUND_CAMERAS } from '../../labs/playground/views';
import '../../labs/playground/cameras/crane';

const DEG = Math.PI / 180;

/** The rig of `code` after `frames` frames following the player standing at `at`. */
function settled(code: string, frames = 180, at: [number, number, number] = [0, 0, 0]) {
  const rig = createCameraRig(code);
  for (let k = 0; k < frames; k++) rig.update({ follow: at }, 1 / 60);
  return { rig, pose: rig.pose() };
}

describe('cam3=crane', () => {
  it('is a camera mode of the playground’s own, which the codes reach', () => {
    expect(readCameraCode('cam3=crane')).toMatchObject({ type: 'game', name: 'crane' });
  });

  it('frames the player from a 10 m arm looking down 35°, behind him and above', () => {
    const { pose } = settled('cam3=crane,0');
    expect(Math.abs(pose.distance - 10)).toBeLessThan(0.1);
    expect(Math.abs(pose.pitch + 35 * DEG)).toBeLessThan(0.5 * DEG);
    expect(pose.position[1]).toBeGreaterThan(5);
    expect(pose.position[2]).toBeLessThan(-6); // looking along +Z, it stands to the north
  });

  it('turns to the heading its code gives, in degrees, and follows the player as he goes', () => {
    expect(Math.abs(settled('cam3=crane,90', 60).pose.yaw - 90 * DEG)).toBeLessThan(0.01);
    const { rig, pose } = settled('cam3=crane,0');
    for (let k = 1; k <= 120; k++) rig.update({ follow: [k / 12, 0, 0] }, 1 / 60); // 10 m east in 2 s
    for (let k = 0; k < 60; k++) rig.update({ follow: [10, 0, 0] }, 1 / 60);
    expect(rig.pose().position[0] - pose.position[0]).toBeGreaterThan(9);
  });

  it('is loaded by the playground’s page, and is not one of the five modes T steps through', () => {
    expect(readFileSync('labs/playground/main.ts', 'utf8')).toMatch(/cameras\/(crane|\*)/);
    expect(PLAYGROUND_CAMERAS.map((mode) => mode.code)).toEqual(['cam3=shoulder', 'cam3=first', 'cam3=follow', 'cam=iso', 'cam=overhead']); // prettier-ignore
  });
});
