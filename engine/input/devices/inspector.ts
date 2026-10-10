/**
 * @file `__engine.input` (PLAN.md §8.3, WP 3.3; doctrine: Agent-operable): the inspector members that drive the virtual
 * device (engine/input/devices/virtual.ts) and record the run, registered from this file as entries of the registry
 * kind `inspectorMember` (engine/dev/members.ts), so no layer imports `dev/` and no other WP edits the inspector.
 *
 * - `input.press(action)`, `input.hold(action, down)`, `input.axis(name, value)`: change what the virtual device holds.
 *   A page's input merges it into every frame's intents; headless, `input.play` runs the steps.
 * - `input.play(script)`: runs a script one sim step at a time through the session (each step recorded), on top of
 *   what the device holds; returns the steps run and the tick after them. `input.play('30')` steps 30 times with it.
 * - `input.record()`: the run's intents from step 0 as a replay (PLAN.md §8.4), what `x replay` plays.
 * - `input.state()`: what the virtual device holds.
 *
 * Each engine has its own virtual device: the page's input when the app connects it (`connectVirtualDevice(host,
 * input.virtual)`), else one made on first use. Members change the sim only through `host.step`, which records.
 *
 * Invariants: this module registers on the shared registry when it loads, so `inspectorMember` must be declared first
 * (engine/dev/members.ts: the app and createHeadless load it before this module; a test imports it first).
 *
 * @example
 * import '../../dev/members';
 * import { createHeadless } from '../../app/headless';
 * import { createRegistry } from '../../core/registry';
 * import { defineScene } from '../../sim/scene';
 * const engine = await createHeadless({ scene: defineScene('walk', { setup: () => {} }, createRegistry()) });
 * const input = engine.input as Record<string, (...args: unknown[]) => unknown>;
 * input.axis('move', [0, 1]);
 * input.play('2 tap=jump'); // { steps: 2, tick: 2 }
 * (input.record() as { inputs: unknown[] }).inputs; // [[0, { move: [0, 1], p: ['jump'] }]]
 * @see engine/input/devices/inspector.test.ts
 */
import { def } from '../../core/registry';
import { createVirtualDevice, playScript, type VirtualDevice } from './virtual';

/** What the input members use of an inspector host (engine/dev/members.ts `InspectorHost`). */
interface InputHost {
  step(n: number, intents: unknown): void;
  readonly session: { readonly world: { readonly tick: number }; record(): unknown };
}

/** Each host's virtual device. */
const devices = new WeakMap<object, VirtualDevice>();

/** Gives `host` (the app's inspector host) the page input's virtual device, so `__engine.input` drives the page. */
export function connectVirtualDevice(host: object, device: VirtualDevice): void {
  devices.set(host, device);
}

/** The virtual device of `host`, made on first use. */
export function virtualDeviceOf(host: object): VirtualDevice {
  let device = devices.get(host);
  if (!device) devices.set(host, (device = createVirtualDevice()));
  return device;
}

/** An action's name, as the members take it. */
const ACTION = { type: 'string', required: true, description: "The action's name, as the action map names it (jump)." };

def('inspectorMember', 'input.press', {
  help: 'Taps an action on the virtual device: the next step (sampled or played) presses it.',
  args: { action: ACTION },
  impl: (host: InputHost, action: string) => {
    virtualDeviceOf(host).press(action);
    return virtualDeviceOf(host).peek();
  },
});

def('inspectorMember', 'input.hold', {
  help: 'Holds an action down on the virtual device, or lets it go (down = false).',
  args: { action: ACTION, down: { type: 'boolean', default: true, description: 'True holds, false lets go.' } },
  impl: (host: InputHost, action: string, down: boolean) => {
    virtualDeviceOf(host).hold(action, down);
    return virtualDeviceOf(host).peek();
  },
});

def('inspectorMember', 'input.axis', {
  help: "Sets a virtual axis until changed: move [right, forward] (turned by the camera), look, aim, cam or a 'game:key'.",
  args: {
    name: { type: 'string', required: true, description: "move, look, aim, cam, or a custom intent key 'game:…'." },
    value: { type: 'any', description: 'Numbers as the axis takes them ([0, 1] walks forward); null or none lets go.' },
  },
  impl: (host: InputHost, name: string, value: unknown) => {
    virtualDeviceOf(host).axis(name, value);
    return virtualDeviceOf(host).peek();
  },
});

def('inspectorMember', 'input.play', {
  help: 'Runs a script ("30 move=0,1 hold=sprint tap=jump", a line per stretch) a sim step at a time; returns { steps, tick }.',
  args: {
    script: {
      type: 'string',
      required: true,
      description:
        'Lines "<steps> [move=x,y] [look=yaw,pitch] [cam=rad] [aim=x,y,z] [hold=a,b] [tap=a] [game:key=n]", # comments.',
    },
  },
  impl: (host: InputHost, script: string) => {
    const steps = playScript(virtualDeviceOf(host), script, (intents) => host.step(1, intents));
    return { steps, tick: host.session.world.tick };
  },
});

def('inspectorMember', 'input.record', {
  help: "The run's intents from step 0 as a replay (my3dge-replay/1), for x replay.",
  impl: (host: InputHost) => host.session.record(),
});

def('inspectorMember', 'input.state', {
  help: 'What the virtual device holds: actions held, taps pending, axes.',
  impl: (host: InputHost) => virtualDeviceOf(host).peek(),
});
