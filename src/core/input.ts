export type ActionName =
  | 'light'
  | 'heavy'
  | 'block'
  | 'roll'
  | 'jump'
  | 'lock'
  | 'heal'
  | 'pause'
  | 'confirm'
  | 'back'
  | 'hints'
  | 'up'
  | 'down';

export const ACTIONS: ActionName[] = [
  'light',
  'heavy',
  'block',
  'roll',
  'jump',
  'lock',
  'heal',
  'pause',
  'confirm',
  'back',
  'hints',
  'up',
  'down',
];

interface Binding {
  keys: string[];
  mouse: number[];
  pad: number[];
}

// Ctrl is never bound: Ctrl+W would close the tab.
const BINDINGS: Record<ActionName, Binding> = {
  light: { keys: [], mouse: [0], pad: [5] },
  heavy: { keys: [], mouse: [2], pad: [7] },
  block: { keys: ['ShiftLeft', 'ShiftRight'], mouse: [], pad: [4] },
  roll: { keys: ['Space'], mouse: [], pad: [1] },
  jump: { keys: ['KeyF'], mouse: [], pad: [0] },
  lock: { keys: ['KeyQ', 'Tab'], mouse: [1], pad: [11] },
  heal: { keys: ['KeyR'], mouse: [], pad: [2] },
  pause: { keys: ['Escape', 'KeyP'], mouse: [], pad: [9] },
  confirm: { keys: ['Enter', 'NumpadEnter'], mouse: [], pad: [0] },
  back: { keys: ['Escape', 'Backspace'], mouse: [], pad: [1] },
  hints: { keys: ['KeyH'], mouse: [], pad: [8] },
  up: { keys: ['ArrowUp', 'KeyW'], mouse: [], pad: [12] },
  down: { keys: ['ArrowDown', 'KeyS'], mouse: [], pad: [13] },
};

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyF', 'KeyQ', 'KeyR', 'KeyH']);

export interface InputFrame {
  moveX: number; // +1 = right
  moveY: number; // +1 = forward
  lookX: number; // yaw delta (radians), + = turn camera right
  lookY: number; // pitch delta (radians), + = look up
  held: Record<ActionName, boolean>;
  pressed: Record<ActionName, boolean>;
  released: Record<ActionName, boolean>;
  gamepad: boolean;
}

export interface VirtualInput {
  moveX: number;
  moveY: number;
  lookX: number;
  lookY: number;
  held: Set<ActionName>;
}

function blankRecord(): Record<ActionName, boolean> {
  const r = {} as Record<ActionName, boolean>;
  for (const a of ACTIONS) r[a] = false;
  return r;
}

export interface InputSettings {
  sensitivity: number; // radians per pixel
  invertY: boolean;
  padLookSpeed: number; // radians per second at full stick
}

export class Input {
  readonly settings: InputSettings = { sensitivity: 0.0024, invertY: false, padLookSpeed: 3.0 };
  private keys = new Set<string>();
  private mouse = new Set<number>();
  private mouseDX = 0;
  private mouseDY = 0;
  private prevHeld = blankRecord();
  private padPrev: boolean[] = [];
  private lastPadUse = -1;
  private lastKbUse = 0;
  virtual: VirtualInput | null = null;
  /** When false, keyboard/mouse/gamepad are ignored (bot runs). */
  humanEnabled = true;
  pointerLocked = false;
  onPointerLockChange: ((locked: boolean) => void) | null = null;
  /** Called on any key/mouse/pad press, before gameplay sees it (menus use this). */
  onAnyPress: (() => void) | null = null;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      if (PREVENT.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (!e.repeat) this.onAnyPress?.();
      this.keys.add(e.code);
      this.lastKbUse = performance.now();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.clear();
    });
    target.addEventListener('mousedown', (e) => {
      this.mouse.add(e.button);
      this.lastKbUse = performance.now();
      this.onAnyPress?.();
      if (e.button === 1) e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.delete(e.button);
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      // Ignore absurd spikes (some browsers report a huge delta when the lock engages).
      if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.target;
      this.onPointerLockChange?.(this.pointerLocked);
    });
  }

  requestPointerLock(): void {
    if (this.pointerLocked) return;
    try {
      const p = this.target.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    } catch {
      /* not allowed yet (needs a user gesture) */
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get usingGamepad(): boolean {
    return this.lastPadUse > this.lastKbUse;
  }

  private readPad(): { pad: Gamepad | null; buttons: boolean[] } {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    const buttons: boolean[] = [];
    if (pad) {
      for (let i = 0; i < pad.buttons.length; i++) {
        const b = pad.buttons[i];
        buttons[i] = b.pressed || b.value > 0.5;
      }
      let any = buttons.some((b) => b);
      for (let i = 0; i < Math.min(4, pad.axes.length); i++) if (Math.abs(pad.axes[i]) > 0.3) any = true;
      if (any) this.lastPadUse = performance.now();
      for (let i = 0; i < buttons.length; i++) if (buttons[i] && !this.padPrev[i]) this.onAnyPress?.();
    }
    this.padPrev = buttons;
    return { pad, buttons };
  }

  /** Sample once per rendered frame. */
  frame(dt: number): InputFrame {
    const { pad, buttons } = this.readPad();
    const held = blankRecord();
    const human = this.humanEnabled;
    if (human) {
      for (const a of ACTIONS) {
        const b = BINDINGS[a];
        let on = false;
        for (const k of b.keys) if (this.keys.has(k)) on = true;
        for (const m of b.mouse) if (this.mouse.has(m)) on = true;
        for (const p of b.pad) if (buttons[p]) on = true;
        held[a] = on;
      }
    }
    let moveX = 0;
    let moveY = 0;
    let lookX = 0;
    let lookY = 0;
    if (human) {
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveY += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveY -= 1;
      const s = this.settings;
      lookX += this.mouseDX * s.sensitivity;
      lookY += -this.mouseDY * s.sensitivity * (s.invertY ? -1 : 1);
      if (pad) {
        const dz = (v: number, d: number) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
        const lx = dz(pad.axes[0] ?? 0, 0.18);
        const ly = dz(pad.axes[1] ?? 0, 0.18);
        moveX += lx;
        moveY -= ly;
        const rx = dz(pad.axes[2] ?? 0, 0.15);
        const ry = dz(pad.axes[3] ?? 0, 0.15);
        const curve = (v: number) => Math.sign(v) * v * v;
        lookX += curve(rx) * s.padLookSpeed * dt;
        lookY += -curve(ry) * s.padLookSpeed * 0.7 * dt * (s.invertY ? -1 : 1);
        if (buttons[14]) moveX -= 1; // dpad does not move in play; menus use up/down
        if (buttons[15]) moveX += 1;
      }
    }
    this.mouseDX = 0;
    this.mouseDY = 0;
    const v = this.virtual;
    if (v) {
      moveX += v.moveX;
      moveY += v.moveY;
      lookX += v.lookX;
      lookY += v.lookY;
      for (const a of v.held) held[a] = true;
    }
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }
    const pressed = blankRecord();
    const released = blankRecord();
    for (const a of ACTIONS) {
      pressed[a] = held[a] && !this.prevHeld[a];
      released[a] = !held[a] && this.prevHeld[a];
    }
    this.prevHeld = held;
    return { moveX, moveY, lookX, lookY, held, pressed, released, gamepad: this.usingGamepad };
  }
}
