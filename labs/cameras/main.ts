/**
 * @file The Cameras Lab (PLAN.md WP 10.8; my-3d2dge's Perspective Lab: one room in every camera view): the gallery's
 * look set on its stage (a crate, a barrel, three cubes and a figure: `#gallery/look/look:clean`, engine/dev/
 * gallery.ts) seen through every camera the engine has, each a camera code (engine/gfx/cameras/codes.ts): the classic
 * views (isometric, three-quarter, top-down, brawler, side, overhead) fixed on the set, orbit round it, fly and fixed.
 * Each is a link (`?cam=` or `?cam3=`, so the address is the camera), and a button blends to it over `cam.blend`
 * seconds as a game's live switch does (`__engine.camera.set(code, { blend: true })`); the panel says in words what
 * the camera shows (`__engine.camera.get()`).
 *
 * The same job without the page: `node x shot <page> --cam <code>` (any page, any camera, with what the ID pass sees)
 * and `__engine.camera.set` / `camera.get` in an `x inspect` session.
 *
 * @example
 * // browser
 * // labs/cameras/?cam3=orbit,30,25,6,8,0.8,8
 * @see tests/e2e/labs.spec.ts
 */
import { button, entryList, labPanel } from '../index/lab';
import { galleryBoot } from '../index/gallery';

/** The cameras, as codes: the classic views fixed on the set's middle (8, 0.5, 8), then the 3D ones round it. */
const CAMERA_CODES = [
  ...['iso', 'threequarter', 'topdown', 'brawler', 'side', 'overhead'].map((view) => `cam=${view},0,3,8,0.5,8`),
  'cam3=orbit,30,25,6,8,0.8,8',
  'cam3=fly,8,1.6,3,0,-5',
  'cam3=fixed,12,3,4,-40,-18',
];

/** What the lab reads and sets through the engine's inspector (`__engine`). */
interface CameraInspector {
  camera: { set(code: string, options?: { blend?: boolean }): unknown; get(): { code: string; describe: string } };
}

const params = new URLSearchParams(location.search);
const asked = params.has('cam') ? `cam=${params.get('cam')}` : params.has('cam3') ? `cam3=${params.get('cam3')}` : CAMERA_CODES[0]; // prettier-ignore
const panel = labPanel(document, {
  title: 'Cameras Lab',
  what: 'One set of things seen through every camera the engine has: the classic views, orbit, fly and fixed.',
  command: 'node x shot <page> --cam <code>',
});
const engine = await galleryBoot(document, '#gallery/look/look:clean');
const inspector = engine.inspector as unknown as CameraInspector | null;
if (inspector) {
  const say = () => {
    const { code, describe } = inspector.camera.get();
    panel.status(`${code}: ${describe}`);
  };
  inspector.camera.set(asked); // after the gallery fitted its own, once
  say();
  const linkOf = (code: string) => {
    const [key, value] = code.split(/=(.*)/s);
    return { label: code, href: `?${key}=${value}`, current: code === asked };
  };
  entryList(panel.section('Cameras (links)'), CAMERA_CODES.map(linkOf));
  const blends = panel.section('Blend to');
  for (const code of CAMERA_CODES)
    button(blends, code.replace(/^cam3?=/, '').split(',')[0], () => {
      inspector.camera.set(code, { blend: true });
      setTimeout(say, 600);
    });
} else panel.status('the engine did not start: the page’s message says why');
