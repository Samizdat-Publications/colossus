import type * as THREE from 'three';
import type { Player } from './player';
import type { Golem } from './golem';
import type { World } from './world';
import type { Threats } from './threats';

/** Everything the fight simulation needs, passed to each system's update. */
export interface FightContext {
  time: number;
  player: Player;
  golem: Golem;
  world: World;
  threats: Threats;
  scene: THREE.Scene;
  /** true while the player has control (not intro, not a death or victory cinematic). */
  live: boolean;
}

export interface GolemTarget {
  name: string;
  kind: 'arm' | 'back' | 'chest';
  pos: THREE.Vector3;
  radius: number;
  /** Can the core be hit right now (visible and not sealed)? */
  open: boolean;
}

export interface Capsule {
  name: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

export interface SwordHit {
  kind: 'core' | 'body';
  core?: GolemTarget;
  damage: number;
  breakAmount: number;
  heavy: boolean;
  charged: boolean;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
}

export type SwordResult = 'core' | 'crit' | 'body' | 'deflect' | 'immune';
