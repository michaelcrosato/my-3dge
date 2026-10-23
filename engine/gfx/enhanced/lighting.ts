/**
 * @file Tiled lighting (PLAN.md WP 11.5, I-17): every lamp lit at once, not only the light pool's nearest 12. With
 * `feature:tiledLighting` on, engine/gfx/renderer.ts gives the renderer `PoolTiledLighting` (through
 * engine/gfx/features.ts), and the light pool may hold up to `TILED.pool` lights (engine/gfx/lights.ts). A compute pass
 * before each render bins the point lights into 32 px screen tiles, at most `TILED.perTile` (16) a tile, and a lit
 * fragment loops over its tile's lights: what a shader costs no longer grows with the lights, and lights come and go
 * without rebuilding a shader. Off, the pool's 12 point lights are in every lit shader, as before.
 *
 * Built on r182's `TiledLightsNode` addon, with seven of its habits changed, each measured against what the engine
 * keeps: a light that casts shadows stays an ordinary light, since the tiles carry no shadow maps (r182 tiles every
 * point light, so the pool's two shadow casters lost their shadows); the tile buffers are made once for the largest
 * drawing buffer, `TILED.width` × `TILED.height`, with the tile grid in uniforms (r182 bakes the size into the
 * shaders, so a resize, as the resolution modes make, rebuilt every lit pipeline after the warm-up); the grid is the
 * render target's being drawn (a post pass's, a shot's), else the drawing buffer's (r182 takes the drawing buffer's
 * always, so a target of another size read other tiles' lights); and the compute pass covers the grid's tiles, no
 * more (r182 dispatches width × height / 32 invocations, 32 times its tiles). A light joins the tiles its reach
 * covers in pixels, from the projection (r182 takes reach / depth as a radius in screen units, which misses the
 * projection's scale, the aspect and orthographic cameras: under the box's top-down camera it dropped lights), and a
 * tile holds 16 (r182's 8 left the tiles near the focus darker than the 12 the pool lit without tiles); and each tiled
 * light reaches the lighting model as a light of its own colour (r182 hands over the tiles' node, which has none, so the
 * toon style, which reads a light's colour for its bands, failed to build: engine/gfx/materials/toon.ts). Only lights
 * that shine are tiled (the pool's empty slots are not), and none wholly behind a perspective camera.
 *
 * Invariants: presentation only, never in the hash; the lights node's shader key holds the non-tiled lights alone, as
 * r182's does; a target past `TILED.width` × `TILED.height` lights its outer tiles with the ordinary lights only.
 *
 * @example
 * // engine/gfx/features.ts: renderer.lighting = new PoolTiledLighting(); // before the first frame
 * TILED.pool; // 64: the light pool's most lights with tiled lighting
 * splitLights([{ isPointLight: true, castShadow: true }, { isPointLight: true, castShadow: false }]).tiled.length; // 1
 * @see engine/gfx/enhanced/lighting.test.ts
 * @see tests/e2e/enhanced.spec.ts
 */
import { DataTexture, FloatType, Lighting, LightsNode, RGBAFormat, Vector2, Vector3, type ComputeNode, type Light, type Node, type NodeBuilder, type NodeFrame, type PointLight } from 'three/webgpu'; // prettier-ignore
import { attributeArray, Break, directPointLight, float, Fn, If, instanceIndex, int, ivec4, Loop, positionView, renderGroup, Return, screenCoordinate, select, uniform, vec2 } from 'three/tsl'; // prettier-ignore
import TiledLightsNode, { circleIntersectsAABB } from 'three/addons/tsl/lighting/TiledLightsNode.js';
import { defineCodes } from '../../core/log';
import { POOL_SIZES } from '../lights';

/** Its advice code, raised by the feature registry when it is off. */
export const LIGHTING_CODES = defineCodes('gfx', {
  GFX_NO_TILED_LIGHTING: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there',
    doc: 'Advice from the feature registry (engine/gfx/features.ts) when tiled lighting is off: the light pool lights only its 12 lights nearest the focus.',
  },
});

/** Its feature entry (engine/gfx/features.ts registers it). */
export const TILED_FEATURE = {
  id: 'feature:tiledLighting',
  description:
    'Tiled lighting: a compute pass bins the point lights into screen tiles, so the light pool lights up to 64 lamps at once (engine/gfx/enhanced/lighting.ts).',
  advice: 'GFX_NO_TILED_LIGHTING',
  downgrade: 'the light pool lights only its 12 lights nearest the focus',
} as const;

/** The numbers: the pool's most lights, the node's, the tile size (px), lights a tile and the largest buffer (px). */
export const TILED = {
  pool: POOL_SIZES.tiled,
  maxLights: 256,
  tileSize: 32,
  perTile: 16,
  width: 4096,
  height: 4096,
} as const;

/** A tile's lights are this many `ivec4`s: four light numbers each. */
const BLOCKS = TILED.perTile / 4;

/** A light as the split reads it. */
type SplitLight = Pick<Light, 'castShadow'> & { isPointLight?: boolean };

/** Which lights the tiles carry (point lights that cast no shadow) and which stay ordinary lights. */
export function splitLights<L extends SplitLight>(lights: readonly L[]): { tiled: L[]; material: L[] } {
  const tiled = lights.filter((light) => light.isPointLight === true && !light.castShadow);
  return { tiled, material: lights.filter((light) => !tiled.includes(light)) };
}

/** The tile grid a drawing buffer of `width` × `height` px covers, clamped to the buffers made. */
export function tileGrid(width: number, height: number): { columns: number; rows: number; tiles: number } {
  const columns = Math.min(Math.ceil(width / TILED.tileSize), TILED.width / TILED.tileSize);
  const rows = Math.min(Math.ceil(height / TILED.tileSize), TILED.height / TILED.tileSize);
  return { columns, rows, tiles: columns * rows };
}

/** A TSL node, as this module handles them. */
type N = Node;

/** r182's fields this node reads and sets in place of the addon's own `create` (see the file comment). */
type Fields = {
  tiledLights: Light[];
  materialLights: Light[];
  maxLights: number;
  tileSize: number;
  _bufferSize: Vector2 | null;
  _lightIndexes: N;
  _screenTileIndex: N;
  _compute: ComputeNode;
  _lightsTexture: DataTexture & { image: { data: Float32Array; width: number } };
  _lightsCount: N & { value: number };
  _tileLightCount: number;
  _screenSize: N & { value: Vector2 };
  _cameraProjectionMatrix: N & { value: unknown };
  _cameraViewMatrix: N & { value: unknown };
  getLightData(index: N): { color: N; decay: N; viewPosition: N; distance: N };
};

const size = new Vector2();
const at = new Vector3();

/** r182's tiled lights node with the engine's seven changes (see the file comment). */
class PoolTiledLightsNode extends TiledLightsNode {
  /** The tile grid now: columns (for the compute pass and the fragments) and tiles. */
  readonly columns = uniform(1, 'uint').setGroup(renderGroup);
  readonly columnsF = uniform(1).setGroup(renderGroup);
  readonly rowsF = uniform(1).setGroup(renderGroup);
  readonly tiles = uniform(1, 'uint').setGroup(renderGroup);
  /** Whether a fragment's tile is in the grid: past the buffers made, a fragment gets the ordinary lights alone. */
  private inGrid: N = float(1).greaterThan(0);

  constructor() {
    super(TILED.maxLights, TILED.tileSize);
    const self = this as unknown as Fields;
    self._tileLightCount = TILED.perTile;
    // Each frame's, so the render group: an object-group uniform refreshes only when its object or material changes,
    // so a still floor kept the first frame's camera and grid (engine/gfx/sky.ts measured it for fog).
    for (const each of [self._lightsCount, self._screenSize, self._cameraProjectionMatrix, self._cameraViewMatrix])
      (each as unknown as { setGroup(group: unknown): void }).setGroup(renderGroup);
    this.create(); // the size is fixed, so now: r182 asks for the compute pass's key before the first frame
  }

  /** A fragment's tile's `element`th light number (0: none), `BLOCKS` `ivec4`s a tile. */
  getTile(element: N): N {
    const self = this as unknown as Fields;
    const n = int(element);
    const light = self._lightIndexes.element(self._screenTileIndex.mul(int(BLOCKS)).add(n.div(int(4)))).element(n.mod(int(4))); // prettier-ignore
    return select(this.inGrid, light, int(0));
  }

  /** Point lights that cast no shadow go to the tiles; the rest stay ordinary lights (see the file comment). */
  setLights(lights: Light[]): this {
    const self = this as unknown as Fields;
    const { tiled, material } = splitLights(lights);
    self.tiledLights.splice(0, Infinity, ...tiled);
    self.materialLights.splice(0, Infinity, ...material);
    LightsNode.prototype.setLights.call(this, self.materialLights);
    return this;
  }

  /** The buffers are made once, with the node: a resize changes only the grid's uniforms. */
  updateProgram(): void {}

  /** r182's, packing only the tiled lights that shine: the pool's empty slots (intensity 0) are left out. */
  updateLightsTexture(): void {
    const self = this as unknown as Fields;
    const { data, width } = self._lightsTexture.image;
    let n = 0;
    for (const light of self.tiledLights as PointLight[]) {
      if (!(light.intensity > 0) || n >= self.maxLights) continue;
      at.setFromMatrixPosition(light.matrixWorld);
      data.set([at.x, at.y, at.z, light.distance], n * 4);
      data.set([light.color.r * light.intensity, light.color.g * light.intensity, light.color.b * light.intensity, light.decay], width * 4 + n * 4); // prettier-ignore
      n++;
    }
    self._lightsCount.value = n;
    self._lightsTexture.needsUpdate = true;
  }

  /** r182's, but each tiled light reaches the lighting model as a light of its own colour (see the file comment). */
  setupLights(builder: NodeBuilder, lightNodes: Node[]): void {
    const self = this as unknown as Fields;
    const lights = builder as unknown as { context: { reflectedLight: Record<string, N & { toStack(): void }> }; lightsNode: { setupDirectLight(builder: NodeBuilder, light: object, data: unknown): void } }; // prettier-ignore
    const { directDiffuse, directSpecular } = lights.context.reflectedLight;
    directDiffuse.toStack(); // declared before the loop, as r182 does
    directSpecular.toStack();
    (LightsNode.prototype as unknown as { setupLights(b: NodeBuilder, l: Node[]): void }).setupLights.call(this, builder, lightNodes); // prettier-ignore
    Fn(() => {
      Loop(self._tileLightCount, ({ i }: { i: N }) => {
        const index = this.getTile(i);
        If(index.equal(int(0)), () => {
          Break();
        });
        const { color, decay, viewPosition, distance } = self.getLightData(index.sub(1));
        const light = { colorNode: color, baseColorNode: null, light: null };
        // r182 reads `lightVector` (src/nodes/lighting/PointLightNode.js:7); its type declarations name another key.
        const point = { color, lightVector: viewPosition.sub(positionView), cutoffDistance: distance, decayExponent: decay }; // prettier-ignore
        const data = directPointLight(point as unknown as Parameters<typeof directPointLight>[0]);
        lights.lightsNode.setupDirectLight(builder, light, data);
      });
    }, 'void')();
  }

  /** The buffers and the compute pass, for `TILED.width` × `TILED.height` (see the file comment). */
  create(): void {
    const self = this as unknown as Fields;
    const { tileSize, maxLights } = self;
    const most = (TILED.width / tileSize) * (TILED.height / tileSize);
    const lightsData = new Float32Array(maxLights * 4 * 2);
    const lightsTexture = new DataTexture(lightsData, maxLights, 2, RGBAFormat, FloatType);
    const lightIndexes = attributeArray(new Int32Array(most * 4 * BLOCKS), 'ivec4').setName('lightIndexes');
    const tile = (index: number) => lightIndexes.element(instanceIndex.mul(int(BLOCKS)).add(int(index)));
    const slot = (n: N) => lightIndexes.element(instanceIndex.mul(int(BLOCKS)).add(n.div(int(4)))).element(n.mod(int(4))); // prettier-ignore
    const compute = Fn(() => {
      If(instanceIndex.greaterThanEqual(this.tiles), () => {
        Return(); // a block, not a value: TSL would emit a second, unreachable return
      });
      // In pixels, where a light's reach projects round under either kind of camera (see the file comment).
      const minBounds = vec2(instanceIndex.mod(this.columns), instanceIndex.div(this.columns)).mul(tileSize);
      const maxBounds = minBounds.add(float(tileSize));
      const projection = self._cameraProjectionMatrix;
      const scale = projection.element(int(1)).y.mul(0.5).mul(self._screenSize.y); // px a metre at w = 1
      const perspective = projection.element(int(3)).w.lessThan(0.5); // its w is the depth; an orthographic one's is 1
      const found = int(0).toVar();
      for (let block = 0; block < BLOCKS; block++) tile(block).assign(ivec4(0));
      Loop(maxLights, ({ i }: { i: N }) => {
        If(found.greaterThanEqual(self._tileLightCount).or(int(i).greaterThanEqual(int(self._lightsCount))), () => void Return()); // prettier-ignore
        const { viewPosition, distance } = self.getLightData(i);
        const clip = projection.mul(viewPosition);
        const centre = clip.xy.div(clip.w).mul(0.5).add(0.5).flipY().mul(self._screenSize);
        const radius = distance.mul(scale).div(clip.w.max(1e-4));
        const reaches = perspective.and(clip.w.lessThan(distance)); // the camera inside its reach: every tile
        const behind = perspective.and(clip.w.add(distance).lessThanEqual(0)); // wholly behind the camera: none
        If(behind.not().and(reaches.or(circleIntersectsAABB(centre, radius, minBounds, maxBounds))), () => {
          slot(found).assign(i.add(int(1)));
          found.addAssign(int(1));
        });
      });
    })()
      .compute(most)
      .setName('Tile the lights');
    const screenTile = screenCoordinate.div(tileSize).floor().toVar();
    self._bufferSize = new Vector2(TILED.width, TILED.height);
    self._lightIndexes = lightIndexes;
    const [column, row] = [screenTile.x.min(this.columnsF.sub(1)), screenTile.y.min(this.rowsF.sub(1))];
    self._screenTileIndex = column.add(row.mul(this.columnsF));
    this.inGrid = screenTile.x.lessThan(this.columnsF).and(screenTile.y.lessThan(this.rowsF));
    self._compute = compute;
    self._lightsTexture = lightsTexture as Fields['_lightsTexture'];
  }

  /** Before each render: the lights' data, the camera, the grid, then the compute pass over the grid's tiles. */
  updateBefore(frame: NodeFrame): void {
    const self = this as unknown as Fields;
    const [renderer, camera] = [frame.renderer!, frame.camera!];
    this.updateLightsTexture();
    self._cameraProjectionMatrix.value = camera.projectionMatrix;
    self._cameraViewMatrix.value = camera.matrixWorldInverse;
    const target = renderer.getRenderTarget(); // a pass's or a shot's: its fragments' coordinates are its own
    if (target) size.set(target.width, target.height);
    else renderer.getDrawingBufferSize(size);
    self._screenSize.value.copy(size);
    const grid = tileGrid(size.x, size.y);
    [this.columns.value, this.columnsF.value, this.rowsF.value, this.tiles.value] = [grid.columns, grid.columns, grid.rows, grid.tiles]; // prettier-ignore
    renderer.compute(self._compute, grid.tiles);
  }
}

/** The renderer's lighting with tiled point lights (see the file comment), as `renderer.lighting`. */
export class PoolTiledLighting extends Lighting {
  createNode(lights: Light[] = []): LightsNode {
    return new PoolTiledLightsNode().setLights(lights);
  }
}
