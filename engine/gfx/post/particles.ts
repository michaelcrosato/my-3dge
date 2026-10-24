/**
 * @file The post chain's particle layer (PLAN.md WP 11.3; ADR-0025 amendment 32): the frame's GPU particles
 * (engine/gfx/enhanced/particles.ts) drawn in a pass of their own and laid premultiplied over the scene's light,
 * before bloom's glow and the display pass, so the looks' filters reach them. Drawn apart from the scene pass, they
 * write nothing into its normals and flags (r182 has no write mask a target) and stay out of the ID pass; in their pass
 * they are tested by hand against the scene pass's depth, and a plain frame draws them after the scene straight,
 * against the screen's own. The pass is cleared to nothing: r182 clears a pass to the renderer's clear colour.
 *
 * Each frame: `view(particles, camera)` takes the frame's (none on a page without them), `prepare` moves the ring
 * once (`step`, its births and the move) and says whether the pass runs: while a particle lives, and in the warm
 * frame, which draws a slot of it either way, so the warm-up builds the pass's, the plain frame's and the step's
 * pipelines; `straight` draws them over a plain frame; `done` ends the warm frame's slot.
 *
 * Invariants: presentation only; the output graph holds the layer from the chain's first build, whether or not a frame
 * brings particles, so a page's first particles build nothing; with none live the pass never runs and the light is
 * as it was.
 *
 * @example
 * // const layer = createParticleLayer(scenePass); // where feature:gpuParticles is on
 * // lit = layer.over(shading.apply(scenePass.getTextureNode('output'))); // once, in the output graph
 * // layer.view(frame.particles, frame.camera); if (layer.prepare(renderer, warming)) …
 * @see tests/e2e/enhanced-particles.spec.ts
 */
import { Color, PassNode, Scene, type Camera, type Node, type NodeFrame, type WebGPURenderer } from 'three/webgpu';
import { renderGroup, uniform, vec4 } from 'three/tsl';
import type { GpuParticles } from '../features';
import { gateUpdates } from './aa';

/** The chain's particle layer (see the file comment). */
export interface ParticleLayer {
  /** `light` with the particles laid over it: built once, into the chain's output graph. */
  over(light: Node): Node;
  /** Takes the frame's particles (or none), seen through `camera`. */
  view(particles: GpuParticles | undefined, camera: Camera): void;
  /** Moves the ring once, before the frame draws it; returns whether its pass runs (`warming`: the warm frame). */
  prepare(renderer: WebGPURenderer, warming: boolean): boolean;
  /** Draws them over a plain frame just drawn straight, depth-tested against it. */
  straight(renderer: WebGPURenderer): void;
  /** Ends the frame: the warm frame's slot put away. */
  done(): void;
  dispose(): void;
}

/** The particles' pass: r182's, cleared to nothing, with a hook just before it draws. */
class ParticlePass extends PassNode {
  beforeDraw: () => void = () => {};
  // r182 keeps the clear colour as a Color4, which three/webgpu does not export; a Color takes its r, g and b.
  private readonly kept = new Color() as unknown as Parameters<WebGPURenderer['getClearColor']>[0];

  updateBefore(frame: NodeFrame): void {
    const renderer = frame.renderer as WebGPURenderer;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.kept);
    renderer.setClearColor(0x000000, 0);
    this.beforeDraw();
    try {
      super.updateBefore(frame);
    } finally {
      renderer.setClearColor(this.kept, alpha);
    }
  }
}

/** Makes the layer over `scenePass`, whose camera and depth it shares (see the file comment). */
export function createParticleLayer(scenePass: PassNode): ParticleLayer {
  const none = new Scene();
  const pass = new ParticlePass(PassNode.COLOR, none, scenePass.camera, { depthBuffer: false });
  const gate = uniform(0).setGroup(renderGroup);
  let [ring, run] = [null as GpuParticles | null, false];
  pass.beforeDraw = () => ring?.depth(scenePass.renderTarget.depthTexture, true);
  gateUpdates(pass, () => run);
  return {
    over(light) {
      const p = pass.getTextureNode().mul(gate);
      return vec4(light.rgb.mul(p.a.oneMinus()).add(p.rgb), light.a);
    },
    view(particles, camera) {
      ring = particles ?? null;
      pass.scene = ring?.scene ?? none;
      pass.camera = camera;
    },
    prepare(renderer, warming) {
      ring?.warm(warming);
      ring?.step(renderer);
      run = !!ring && (warming || ring.live);
      gate.value = ring?.live ? 1 : 0;
      return run;
    },
    straight(renderer) {
      if (!ring || !run) return;
      ring.depth(null, false);
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      try {
        renderer.render(ring.scene, pass.camera);
      } finally {
        renderer.autoClear = auto;
      }
    },
    done() {
      ring?.warm(false);
    },
    dispose() {
      pass.dispose();
    },
  };
}
