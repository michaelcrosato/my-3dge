/**
 * @file Hazy air, light shafts and lamp halos (PLAN.md WP 11.5, §5.8): shardfall's volumetric light, for the look's
 * `air` section, laid on the scene's light inside the display pass (engine/gfx/post/shading.ts) behind a uniform. The
 * camera ray to each pixel's surface is marched in 32 steps through haze that is thick near its base and thins above
 * it; at each step some sunlight scatters toward the camera (a Henyey–Greenstein phase: forward scattering brightens
 * the air toward the sun), but only where the sun's shadow map says the sun reaches, so shadows cut dark shafts out of
 * the bright air; the haze glows with the sky's ambient light and dims what lies behind it. Lamp halos add the light
 * each point light scatters along the ray, in closed form. Pixels with no surface (the sky) get no haze. r182 has no
 * god-rays node; this is the plan's custom pass. With `feature:air` off, a look's `air` draws nothing.
 *
 * `createAirLights()` gathers, once a frame and only while the look's air is on, what the march reads from the scene:
 * the first visible sun that casts (its direction, colour and shadow map: the widest cascade when it casts through
 * cascades, engine/gfx/enhanced/csm.ts), the ambient and hemisphere lights' sky colour, and up to `AIR.lights` visible
 * point lights (position, reach, colour), written to a small float texture. It runs before the frame's scene pass, so
 * it brings the lights it reads up to date itself, and the shadow camera's matrix is read as the display pass draws,
 * after the scene pass has moved it. Until a sun has a shadow map, the shafts fall everywhere (`sun.w` 0).
 *
 * Carried from `shardfall:crates/pav_render/src/shaders/post.wgsl:153-255` (`unproject`, `sun_reaches`, `air_light`)
 * and `post.wgsl:312-315` (laid on as `col * a.a + a.rgb`), as WGSL; the shadow map is read with `textureLoad` and
 * compared by hand (shardfall used a comparison sampler).
 *
 * Invariants: presentation only, never in the hash; the march is a pure function of the textures and the gathered
 * uniforms; the gathering reads the scene, never changes it.
 *
 * @example
 * AIR.steps; // 32
 * // engine/gfx/post/shading.ts: const lights = createAirLights(); lights.gather(scene); // each frame the air runs
 * @see engine/gfx/enhanced/air.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import { DataTexture, DepthTexture, FloatType, Matrix4, RGBAFormat, Vector3, Vector4, type Camera, type Light, type Object3D, type PointLight } from 'three/webgpu'; // prettier-ignore
import { renderGroup, texture, uniform } from 'three/tsl';
import { defineCodes } from '../../core/log';
import { wgsl } from '../post/shaders/common';

/** Its advice code, raised by the feature registry when it is off. */
export const AIR_CODES = defineCodes('gfx', {
  GFX_NO_AIR: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: "Advice from the feature registry (engine/gfx/features.ts) when the air is off: a look's `air` section (haze, light shafts, lamp halos) draws nothing.",
  },
});

/** Its feature entry (engine/gfx/features.ts registers it). */
export const AIR_FEATURE = {
  id: 'feature:air',
  description:
    "Hazy air with light shafts cut by the sun's shadows and halos round lamps, where a look's air section asks (engine/gfx/enhanced/air.ts).",
  advice: 'GFX_NO_AIR',
  downgrade: 'clear air: no haze, light shafts or lamp halos',
} as const;

/** The march's steps, the farthest it marches (m), the most lamps with halos, and the shadow test's bias. */
export const AIR = { steps: 32, far: 150, lights: 64, bias: 0.0015 } as const;

/** A point on the camera ray through `ndc` at depth `z` (0 the near plane), in world space (shardfall's unproject). */
const airUnproject = wgsl(`
fn air_unproject(ndc: vec2<f32>, z: f32, inv_proj: mat4x4<f32>, inv_view: mat4x4<f32>) -> vec3<f32> {
  let v = inv_proj * vec4<f32>(ndc, z, 1.0);
  return (inv_view * vec4<f32>(v.xyz / v.w, 1.0)).xyz;
}`);

/** 1 where the sun reaches world point `x`, 0 in its shadow; lit outside the map (shardfall's `sun_reaches`). */
const airSun = wgsl(`
fn air_sun(x: vec3<f32>, light_vp: mat4x4<f32>, shadow_map: texture_depth_2d) -> f32 {
  let c = light_vp * vec4<f32>(x, 1.0);
  let ndc = c.xyz / c.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, -ndc.y * 0.5 + 0.5);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
    return 1.0;
  }
  let dims = vec2<f32>(textureDimensions(shadow_map));
  let d = textureLoad(shadow_map, vec2<i32>(min(uv * dims, dims - 1.0)), 0);
  return select(0.0, 1.0, ndc.z - ${AIR.bias} <= d);
}`);

/**
 * The air between the camera and the surface at `px` (shardfall's `air_light`): rgb the light it adds, a how much of
 * the surface shows through. `air` = (haze, height m, base m, shafts), `air2` = (forward, halos), `sun` = (direction
 * the light travels, 1 with a shadow map), `sun_color` = (rgb, lamps), `sky` = the ambient light's colour.
 */
export const shadeAir = wgsl(
  `
fn shade_air(depth: texture_depth_2d, px: vec2<i32>, dims: vec2<i32>, inv_proj: mat4x4<f32>, inv_view: mat4x4<f32>, air: vec4<f32>, air2: vec4<f32>, sun: vec4<f32>, sun_color: vec4<f32>, sky: vec4<f32>, light_vp: mat4x4<f32>, shadow_map: texture_depth_2d, lamps: texture_2d<f32>) -> vec4<f32> {
  let d = textureLoad(depth, px, 0);
  let ndc = vec2<f32>((f32(px.x) + 0.5) / f32(dims.x) * 2.0 - 1.0, 1.0 - (f32(px.y) + 0.5) / f32(dims.y) * 2.0);
  let ro = air_unproject(ndc, 0.0, inv_proj, inv_view);
  var rd = air_unproject(ndc, min(d, 0.99999), inv_proj, inv_view) - ro;
  var len = length(rd);
  rd = rd / max(len, 1e-4);
  len = min(len, ${AIR.far}.0);
  var light = vec3<f32>(0.0);
  var trans = 1.0;
  let sigma0 = air.x * 0.05;
  if (sigma0 > 0.0 && d < 1.0) {
    let h = max(air.y, 0.1);
    let base = air.z;
    let top = base + h * 5.0;
    let bottom = base - 1.0;
    var t0 = 0.0;
    var t1 = len;
    if (abs(rd.y) > 1e-5) {
      let tt = (top - ro.y) / rd.y;
      let tb = (bottom - ro.y) / rd.y;
      if (rd.y < 0.0) {
        t0 = max(t0, tt);
        t1 = min(t1, tb);
      } else {
        t0 = max(t0, tb);
        t1 = min(t1, tt);
      }
    } else if (ro.y > top || ro.y < bottom) {
      t1 = 0.0;
    }
    if (t1 > t0) {
      let ds = (t1 - t0) / ${AIR.steps}.0;
      let g = air2.x;
      let cos_t = dot(-rd, sun.xyz);
      let phase = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cos_t, 1e-4), 1.5);
      let lit = sun_color.rgb * phase * air.w;
      let amb = sky.rgb * 0.3;
      let shafts = sun.w > 0.5 && air.w > 0.0;
      let jitter = fract(52.9829189 * fract(0.06711056 * f32(px.x) + 0.00583715 * f32(px.y)));
      for (var i = 0; i < ${AIR.steps}; i++) {
        let x = ro + rd * (t0 + (f32(i) + jitter) * ds);
        let k = sigma0 * exp(-max(x.y - base, 0.0) / h) * smoothstep(bottom, base, x.y) * ds;
        var vis = 1.0;
        if (shafts) {
          vis = air_sun(x, light_vp, shadow_map);
        }
        light += trans * k * (lit * vis + amb);
        trans *= exp(-k);
      }
    }
  }
  let halos = air2.y;
  if (halos > 0.0) {
    let n = i32(sun_color.w);
    for (var i = 0; i < n; i++) {
      let at = textureLoad(lamps, vec2<i32>(i, 0), 0);
      let colour = textureLoad(lamps, vec2<i32>(i, 1), 0);
      let r = at.w;
      let tc = dot(at.xyz - ro, rd);
      let hd = max(length(ro + rd * tc - at.xyz), 0.03);
      if (hd < r) {
        let s = (atan((len - tc) / hd) - atan(-tc / hd)) / hd;
        let fade = (1.0 - hd / r) * (1.0 - hd / r);
        light += colour.rgb * s * fade * halos * 0.035;
      }
    }
  }
  return vec4<f32>(light, trans);
}`,
  [airUnproject, airSun],
);

/** What the march reads of the scene, as uniforms and textures, gathered each frame (see the file comment). */
export interface AirLights {
  /** (direction the sunlight travels, 1 when its shadow map is read). */
  readonly sun: ReturnType<typeof uniform<Vector4>>;
  /** (sunlight's rgb times its intensity, lamps in `lamps`). */
  readonly sunColor: ReturnType<typeof uniform<Vector4>>;
  /** The ambient lights' sky colour times their intensity. */
  readonly sky: ReturnType<typeof uniform<Vector4>>;
  /** The sun's shadow camera: projection times view, read as the display pass draws. */
  readonly lightVp: ReturnType<typeof uniform<Matrix4>>;
  /** The sun's shadow map (a stand-in until it has one). */
  readonly shadow: ReturnType<typeof texture>;
  /** The lamps: row 0 (position, reach), row 1 (colour times intensity). */
  readonly lamps: ReturnType<typeof texture>;
  /** Reads the scene's lights (see the file comment). */
  gather(scene: Object3D): void;
  dispose(): void;
}

/** The shadow a light casts through: its own, or its widest cascade's (engine/gfx/enhanced/csm.ts). */
function shadowOf(light: Light): { map?: { depthTexture?: DepthTexture | null } | null; camera: Camera } | undefined {
  const cascades = (light.shadow?.shadowNode as { lights?: { shadow?: Light['shadow'] }[] } | undefined)?.lights;
  return (cascades?.length ? cascades[cascades.length - 1].shadow : light.shadow) as ReturnType<typeof shadowOf>;
}

const [to, from] = [new Vector3(), new Vector3()];

/** three.js's intensities light a surface through a BRDF that divides by π; shardfall's march takes radiances. */
const RADIANCE = 1 / Math.PI;

/** Makes the gathering (see the file comment). */
export function createAirLights(): AirLights {
  const stand = new DepthTexture(1, 1);
  const data = new Float32Array(AIR.lights * 2 * 4);
  const lampData = new DataTexture(data, AIR.lights, 2, RGBAFormat, FloatType);
  let sunShadow: ReturnType<typeof shadowOf> | null = null;
  const lightVp = uniform(new Matrix4()).setGroup(renderGroup);
  lightVp.onRenderUpdate(() => {
    if (sunShadow) lightVp.value.multiplyMatrices(sunShadow.camera.projectionMatrix, sunShadow.camera.matrixWorldInverse); // prettier-ignore
  });
  const air: AirLights = {
    sun: uniform(new Vector4()).setGroup(renderGroup),
    sunColor: uniform(new Vector4()).setGroup(renderGroup),
    sky: uniform(new Vector4()).setGroup(renderGroup),
    lightVp,
    shadow: texture(stand),
    lamps: texture(lampData),
    gather(scene) {
      let [sunFound, lamps] = [false, 0];
      sunShadow = null;
      air.sky.value.set(0, 0, 0, 0);
      scene.traverseVisible((object) => {
        const light = object as Light & { isDirectionalLight?: boolean; isAmbientLight?: boolean; isHemisphereLight?: boolean; target?: Object3D }; // prettier-ignore
        if (!light.isLight || light.intensity <= 0) return;
        const k = light.intensity * RADIANCE;
        if (light.isAmbientLight || light.isHemisphereLight) {
          air.sky.value.x += light.color.r * k;
          air.sky.value.y += light.color.g * k;
          air.sky.value.z += light.color.b * k;
        } else if (light.isDirectionalLight && light.castShadow && !sunFound && light.target) {
          sunFound = true;
          light.updateWorldMatrix(true, false);
          light.target.updateWorldMatrix(true, false);
          to.setFromMatrixPosition(light.target.matrixWorld).sub(from.setFromMatrixPosition(light.matrixWorld)).normalize(); // prettier-ignore
          const shadow = shadowOf(light);
          const map = shadow?.map?.depthTexture;
          air.sun.value.set(to.x, to.y, to.z, map ? 1 : 0);
          air.sunColor.value.set(light.color.r * k, light.color.g * k, light.color.b * k, 0);
          if (map && shadow) {
            air.shadow.value = map;
            sunShadow = shadow;
          }
        } else if ((light as PointLight).isPointLight && lamps < AIR.lights) {
          const lamp = light as PointLight;
          lamp.updateWorldMatrix(true, false);
          from.setFromMatrixPosition(lamp.matrixWorld);
          data.set([from.x, from.y, from.z, lamp.distance > 0 ? lamp.distance : 20], lamps * 4);
          data.set([lamp.color.r * k, lamp.color.g * k, lamp.color.b * k, 0], (AIR.lights + lamps) * 4);
          lamps++;
        }
      });
      if (!sunFound) air.sun.value.set(0, -1, 0, 0);
      air.sunColor.value.w = lamps;
      lampData.needsUpdate = true;
    },
    dispose() {
      stand.dispose();
      lampData.dispose();
    },
  };
  return air;
}
