/**
 * @file The mixer (PLAN.md WP 9.3, I-23): four buses, `effects`, `music`, `ui` and `ambience`, into a master gain,
 * with ducking and the room's reverb, as a Web Audio graph on any `BaseAudioContext` (a page's `AudioContext`, or an
 * `OfflineAudioContext` in a test).
 *
 * Each bus is a volume gain, then a duck gain, into the master gain (`volume('master')` and `mute`), then the
 * destination. The `effects` and `ambience` buses also feed the room's reverb (engine/audio/runtime/reverb.ts): a send
 * at the room's `wet` level into a `ConvolverNode`, into the master. `ui` and `music` stay dry.
 *
 * Ducking lowers the `music` and `ambience` buses to `DUCK.level` (the source's 0.35) over `DUCK.attack` seconds, and
 * brings them back over `DUCK.release` seconds once no duck holds: `duck(true)` holds until `duck(false)` (a dialogue,
 * a pause menu), `duck(seconds)` holds for that long (an effect played with `duck`), and timed ducks overlap.
 *
 * Invariants: volumes are clamped to [0, 1]; `BUS_VOLUMES` are the starting levels (the source's: master 0.7, music
 * 0.5, the rest 1). A room change fades the old reverb out and the new one in over `ROOM_FADE` seconds. Nothing here
 * reads a clock but the context's own `currentTime`.
 *
 * Carried from `my-3d2dge:engine/my-3d2dge.js:3714-3735` (`_init`, `_levels`, `setVolume`, `mute`, `_duck`): the
 * master, sfx and music buses and their levels, the 0.35 duck; `ui`, `ambience`, timed ducks and the reverb added.
 *
 * @example
 * const mixer = createMixer(new OfflineAudioContext(2, 44100, 44100));
 * mixer.volume('music', 0.8);
 * mixer.duck(0.5); // music and ambience at 0.35 for half a second
 * mixer.room('hall');
 * @see tests/e2e/audio.spec.ts
 */
import { impulseResponse, roomSpec, type RoomName, type RoomSpec } from './reverb';

/** The mixer's buses. */
export const BUSES = Object.freeze(['effects', 'music', 'ui', 'ambience'] as const);

/** One of the buses. */
export type Bus = (typeof BUSES)[number];

/** The starting volumes, the master's included. */
export const BUS_VOLUMES: Readonly<Record<Bus | 'master', number>> = Object.freeze({
  master: 0.7,
  effects: 1,
  music: 0.5,
  ui: 1,
  ambience: 1,
});

/** How ducking sounds: the level the ducked buses fall to, and how fast, s. */
export const DUCK = Object.freeze({
  level: 0.35,
  attack: 0.04,
  release: 0.3,
  buses: Object.freeze(['music', 'ambience'] as const),
});

/** Seconds a room change takes to fade from the old reverb to the new. */
export const ROOM_FADE = 0.2;

/** The buses that feed the reverb. */
const WET_BUSES: readonly Bus[] = ['effects', 'ambience'];

/** What `info()` reports. */
export interface MixerInfo {
  volumes: Record<Bus | 'master', number>;
  muted: boolean;
  /** Whether a duck holds now. */
  ducked: boolean;
  /** The room's numbers. */
  room: RoomSpec;
}

/** The mixer of a context. */
export interface Mixer {
  /** Where a voice on `bus` connects. */
  input(bus: Bus): AudioNode;
  /** The volume of `bus` (or the master), set first when `value` is given (clamped to [0, 1]). */
  volume(bus: Bus | 'master', value?: number): number;
  /** Mutes everything (`true`), or unmutes; toggles without an argument. Returns whether it is muted. */
  mute(on?: boolean): boolean;
  /** `true` holds a duck, `false` lets it go, a number of seconds ducks for that long from `when` (now). */
  duck(on: boolean | number, when?: number): void;
  /** Puts the mix in `room` (a preset's name or its numbers). */
  room(room: RoomName | RoomSpec): void;
  info(): MixerInfo;
}

/** Makes the mixer's graph on `context`, into its destination. */
export function createMixer(context: BaseAudioContext): Mixer {
  const gain = (value: number, to: AudioNode) => {
    const node = new GainNode(context, { gain: value });
    node.connect(to);
    return node;
  };
  const volumes = { ...BUS_VOLUMES };
  let muted = false;
  const master = gain(volumes.master, context.destination);
  const reverbIn = new GainNode(context);
  const ducks = new Map<Bus, GainNode>();
  const buses = new Map<Bus, GainNode>();
  for (const bus of BUSES) {
    const duck = gain(1, master);
    if (WET_BUSES.includes(bus)) duck.connect(reverbIn);
    ducks.set(bus, duck);
    buses.set(bus, gain(volumes[bus], duck));
  }
  let held = false;
  let until = -Infinity;
  let current: RoomSpec = roomSpec('none');
  type Reverb = { send: GainNode; convolver: ConvolverNode } | null;
  let reverb: Reverb = null;
  let fading: Reverb = null as Reverb;

  const level = (bus: Bus | 'master') => (bus === 'master' ? master : (buses.get(bus) as GainNode));
  const apply = (bus: Bus | 'master') => {
    const value = bus === 'master' && muted ? 0 : volumes[bus];
    level(bus).gain.setValueAtTime(value, context.currentTime);
  };
  const scheduleDuck = (now: number) => {
    for (const bus of DUCK.buses) {
      const param = (ducks.get(bus) as GainNode).gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      if (!held && until <= now) {
        param.linearRampToValueAtTime(1, now + DUCK.release);
        continue;
      }
      param.linearRampToValueAtTime(DUCK.level, now + DUCK.attack);
      if (held) continue;
      const end = Math.max(until, now + DUCK.attack);
      param.setValueAtTime(DUCK.level, end);
      param.linearRampToValueAtTime(1, end + DUCK.release);
    }
  };

  return {
    input: (bus) => buses.get(bus) as GainNode,
    volume(bus, value) {
      if (value !== undefined) {
        volumes[bus] = Math.min(1, Math.max(0, value));
        apply(bus);
      }
      return volumes[bus];
    },
    mute(on = !muted) {
      muted = on;
      apply('master');
      return muted;
    },
    duck(on, when = context.currentTime) {
      if (on === true || on === false) held = on;
      else until = Math.max(until, when + on);
      scheduleDuck(Math.max(when, context.currentTime));
    },
    room(room) {
      const spec = roomSpec(room);
      const now = context.currentTime;
      if (fading) {
        reverbIn.disconnect(fading.send);
        fading.convolver.disconnect();
      }
      fading = reverb;
      if (reverb) {
        reverb.send.gain.setValueAtTime(current.wet, now);
        reverb.send.gain.linearRampToValueAtTime(0, now + ROOM_FADE);
      }
      current = spec;
      reverb = null;
      const response = impulseResponse(spec, context.sampleRate);
      if (!response) return;
      const buffer = context.createBuffer(2, response[0].length, context.sampleRate);
      response.forEach((channel, i) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i));
      const convolver = new ConvolverNode(context, { buffer, disableNormalization: true });
      convolver.connect(master);
      const send = new GainNode(context, { gain: 0 });
      send.gain.setValueAtTime(0, now);
      send.gain.linearRampToValueAtTime(spec.wet, now + ROOM_FADE);
      reverbIn.connect(send).connect(convolver);
      reverb = { send, convolver };
    },
    info: () => ({
      volumes: { ...volumes },
      muted,
      ducked: held || until > context.currentTime,
      room: current,
    }),
  };
}
