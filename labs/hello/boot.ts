/**
 * @file The hello page's entry (labs/hello/index.html), a harness page proving that three.js r182 draws on WebGPU
 * here: it publishes `window.__engine` with `ready`, `errors` and a minimal `info()` (PLAN.md §8.3), then loads the
 * scene (labs/hello/hello.ts) by dynamic import and draws it on every animation frame.
 *
 * Errors show on the page as text naming the fix (shardfall:web/index.html:34-40, 62-65), since whoever opens a
 * deployed page sees the page, not its console. Without WebGPU (`GFX_NO_WEBGPU`), when the scene fails to load (a
 * missing export, a failed request), or when it fails to start, the page records one error in `__engine.errors`
 * (`{ code, message, fix }`), shows it in `#msg`, prints it once with `console.error`, and does nothing else.
 *
 * URL parameters: `?post=0` draws the scene directly; by default it is drawn through the post pass.
 *
 * Invariants: this module has no static imports (types aside), so a module that fails to load cannot stop it from
 * reporting; `ready` turns true only once the first frame is done on the GPU, and never after an error.
 *
 * @see tests/e2e/hello.spec.ts
 */
import type { GfxError, GfxInfo } from '../../engine/gfx/renderer';
import type { HelloView } from './hello';

/** One structured error record, as `window.__engine.errors` holds them. */
interface ErrorRecord {
  code: string;
  message: string;
  fix: string;
}

/** What `__engine.info()` returns on this page. */
interface HelloInfo extends Partial<GfxInfo> {
  /** The page's name. */
  page: 'hello';
  /** Whether frames go through the post pass (`?post=0` turns it off). */
  post: boolean;
}

/** The ready-or-error signal this page publishes as `window.__engine` (PLAN.md §8.3). */
interface HelloSignals {
  ready: boolean;
  errors: ErrorRecord[];
  info(): HelloInfo;
}

/** The fix shown for a scene that failed to load or start. */
const RELOAD_FIX =
  'reload the page; if it still fails, the console names the cause, and node x shot labs/hello reports it headless';

const post = new URLSearchParams(location.search).get('post') !== '0';
const message = document.querySelector<HTMLElement>('#msg');
const canvas = document.querySelector<HTMLCanvasElement>('#view');
let info: HelloInfo = { page: 'hello', post };
const signals: HelloSignals = { ready: false, errors: [], info: () => info };
Object.assign(window, { __engine: signals });

/**
 * Records the page's one error, shows it as page text and prints it once: an engine code as `[CODE] message. Fix: …`
 * (the advice trap's form), a page failure as `hello: message` followed by its cause.
 */
function fail(record: ErrorRecord, cause?: unknown): void {
  signals.errors.push(record);
  if (message) {
    message.textContent = `${record.code}: ${record.message}\nFix: ${record.fix}`;
    message.hidden = false;
  }
  if (cause === undefined) console.error(`[${record.code}] ${record.message}. Fix: ${record.fix}`);
  else console.error(`hello: ${record.message}`, cause);
}

/** Loads the scene, draws its first frame, keeps drawing on animation frames, and signals ready. */
async function boot(): Promise<void> {
  let scene: typeof import('./hello');
  try {
    scene = await import('./hello');
  } catch (error) {
    return fail({ code: 'HELLO_LOAD', message: `the scene could not load (${String(error)})`, fix: RELOAD_FIX }, error);
  }
  if (!canvas) {
    const missing = new Error('labs/hello/index.html has no <canvas id="view">');
    return fail({ code: 'HELLO_START', message: 'the page has no canvas', fix: RELOAD_FIX }, missing);
  }
  let view: HelloView;
  try {
    view = await scene.startHello(canvas, { post });
  } catch (error) {
    const gfx = error as Partial<GfxError>;
    if (gfx.name === 'GfxError' && gfx.code && gfx.fix) {
      return fail({ code: gfx.code, message: gfx.message ?? '', fix: gfx.fix });
    }
    return fail(
      { code: 'HELLO_START', message: `the scene could not start (${String(error)})`, fix: RELOAD_FIX },
      error,
    );
  }
  info = { page: 'hello', post, ...view.info };
  const started = performance.now();
  const frame = (now: number) => {
    view.draw((now - started) / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('resize', () => view.resize(innerWidth, innerHeight));
  if (message) message.hidden = true;
  signals.ready = true;
}

void boot();
