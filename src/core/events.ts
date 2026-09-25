import type * as THREE from 'three';

/** Everything that audio, effects, camera and UI react to. Gameplay code only emits. */
export interface GameEvents {
  // player
  swing: { heavy: boolean; charged: boolean; pos: THREE.Vector3 };
  roll: { pos: THREE.Vector3 };
  jump: { pos: THREE.Vector3 };
  land: { pos: THREE.Vector3; hard: boolean };
  footstep: { pos: THREE.Vector3; run: boolean };
  playerHit: { damage: number; pos: THREE.Vector3; knockdown: boolean; source: string };
  playerBlock: { damage: number; pos: THREE.Vector3; staminaCost: number };
  justGuard: { pos: THREE.Vector3 };
  guardBreak: { pos: THREE.Vector3 };
  hazardBurn: { pos: THREE.Vector3 };
  /** a thrown rock or a meteor broke apart (pos: where; vel: how it was travelling; size: its radius) */
  rockShatter: { pos: THREE.Vector3; vel: THREE.Vector3; size: number };
  /** the staggered golem's knees hit the floor */
  golemKneel: { pos: THREE.Vector3 };
  /** a heavy attack is charging (pos: the blade's middle; charge 0..1) */
  heavyCharge: { pos: THREE.Vector3; charge: number; full: boolean };
  healStart: { pos: THREE.Vector3 };
  heal: { amount: number; pos: THREE.Vector3 };
  healEmpty: Record<string, never>;
  noStamina: Record<string, never>;
  playerDeath: { pos: THREE.Vector3 };
  lockOn: { on: boolean };
  // combat results
  coreHit: { pos: THREE.Vector3; damage: number; core: string; crit: boolean; heavy: boolean; normal: THREE.Vector3 };
  bodyHit: { pos: THREE.Vector3; damage: number; heavy: boolean; normal: THREE.Vector3 };
  deflect: { pos: THREE.Vector3; normal: THREE.Vector3; heavy: boolean };
  whiff: { heavy: boolean };
  // golem
  golemStep: { pos: THREE.Vector3; strength: number };
  golemWindup: { attack: string; duration: number; pos: THREE.Vector3 };
  golemStrike: { attack: string; pos: THREE.Vector3 };
  slamImpact: { pos: THREE.Vector3; radius: number; big: boolean };
  stompImpact: { pos: THREE.Vector3; radius: number };
  shockwave: { pos: THREE.Vector3; maxRadius: number };
  sweepWhoosh: { pos: THREE.Vector3 };
  rockGrab: { pos: THREE.Vector3 };
  rockThrow: { pos: THREE.Vector3 };
  rockImpact: { pos: THREE.Vector3; radius: number };
  fissure: { pos: THREE.Vector3 };
  meteorWarn: { pos: THREE.Vector3 };
  leapTakeoff: { pos: THREE.Vector3 };
  roar: { pos: THREE.Vector3; phase: number };
  pushWave: { pos: THREE.Vector3; radius: number };
  staggerStart: { pos: THREE.Vector3 };
  staggerEnd: { pos: THREE.Vector3 };
  phaseChange: { phase: number };
  golemDeath: { pos: THREE.Vector3 };
  assembleStart: { quick: boolean };
  assembleChunk: { pos: THREE.Vector3; size: number };
  assembleDone: Record<string, never>;
  // flow
  fightStart: { attempt: number };
  victory: Record<string, never>;
  lightning: { strength: number; distance: number };
  tip: { id: string; text: string };
}

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<unknown>);
    return () => set!.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }
}

export const bus = new EventBus();
