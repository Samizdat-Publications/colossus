import { mergeDefs, Pose, type PoseDef } from './pose';
import type { Rig } from './rig';

/*
 * Warrior pose library (same conventions as golemPoses.ts). The sword sits in hand_R with the
 * blade along +Z at rest, so the blade pitch is the sum of the arm's x rotations: a total of
 * -60 points the blade 60 degrees up in front of the body.
 */

const IDLE: PoseDef = {
  $pos: [0, -0.04, 0],
  hips: [2, -8, 0],
  spine: [5, 4, 0],
  chest: [4, 14, 0],
  neck: [-4, -6, 0],
  head: [-4, -6, 0],
  shoulder_L: [0, 0, -2],
  shoulder_R: [0, 0, 2],
  upperarm_L: [-12, 0, 14],
  forearm_L: [-40, 0, 0],
  hand_L: [0, 0, 0],
  upperarm_R: [-22, 8, -12],
  forearm_R: [-52, 0, 0],
  hand_R: [22, 18, 0],
  thigh_L: [-18, 0, 5],
  shin_L: [22, 0, 0],
  foot_L: [-4, 0, 0],
  thigh_R: [12, 0, -5],
  shin_R: [16, 0, 0],
  foot_R: [-30, 0, 0],
};

const BLOCK: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.1, 0],
  hips: [4, -4, 0],
  spine: [8, 0, 0],
  chest: [6, 8, 0],
  neck: [-8, -4, 0],
  head: [-6, -4, 0],
  upperarm_R: [-62, 34, -26],
  forearm_R: [-72, 0, 0],
  hand_R: [8, 78, 0],
  upperarm_L: [-58, -30, 24],
  forearm_L: [-84, 0, 0],
  hand_L: [0, 0, 0],
  thigh_L: [-26, 0, 8],
  shin_L: [34, 0, 0],
  foot_L: [-8, 0, 0],
  thigh_R: [16, 0, -8],
  shin_R: [28, 0, 0],
  foot_R: [-40, 0, 0],
});

// Light 1: horizontal slash from the right across to the left.
const L1_WIND: PoseDef = mergeDefs(IDLE, {
  hips: [2, -22, 0],
  spine: [4, -22, 0],
  chest: [2, -34, 0],
  neck: [-2, 30, 0],
  head: [-2, 24, 0],
  upperarm_R: [-80, -44, -20],
  forearm_R: [-24, 0, 0],
  hand_R: [96, -10, 0],
  upperarm_L: [-30, 0, 24],
  forearm_L: [-50, 0, 0],
});
const L1_STRIKE: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.08, 0.05],
  hips: [4, 24, 0],
  spine: [8, 22, 0],
  chest: [6, 34, 0],
  neck: [-6, -30, 0],
  head: [-4, -24, 0],
  upperarm_R: [-84, 56, 0],
  forearm_R: [-6, 0, 0],
  hand_R: [92, 10, 0],
  upperarm_L: [-10, 0, 30],
  forearm_L: [-30, 0, 0],
  thigh_L: [-30, 0, 6],
  shin_L: [30, 0, 0],
  foot_L: [0, 0, 0],
  thigh_R: [18, 0, -6],
  shin_R: [20, 0, 0],
  foot_R: [-38, 0, 0],
});

// Light 2: rising backhand from the left back to the right.
const L2_WIND: PoseDef = mergeDefs(L1_STRIKE, {
  chest: [8, 42, 0],
  upperarm_R: [-70, 66, 10],
  forearm_R: [-30, 0, 0],
  hand_R: [110, 20, 0],
});
const L2_STRIKE: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.06, 0.05],
  hips: [2, -26, 0],
  spine: [2, -20, 0],
  chest: [-2, -36, 0],
  neck: [-2, 30, 0],
  head: [-2, 24, 0],
  upperarm_R: [-104, -52, -24],
  forearm_R: [-6, 0, 0],
  hand_R: [70, -14, 0],
  upperarm_L: [-26, 10, 30],
  forearm_L: [-40, 0, 0],
  thigh_L: [-26, 0, 6],
  shin_L: [26, 0, 0],
  foot_L: [0, 0, 0],
  thigh_R: [16, 0, -6],
  shin_R: [18, 0, 0],
  foot_R: [-34, 0, 0],
});

// Light 3: two-handed overhead chop.
const L3_WIND: PoseDef = mergeDefs(IDLE, {
  $pos: [0, 0.0, -0.05],
  hips: [-2, -4, 0],
  spine: [-6, 0, 0],
  chest: [-10, 6, 0],
  neck: [4, -4, 0],
  head: [2, -2, 0],
  upperarm_R: [-168, 10, -8],
  forearm_R: [-44, 0, 0],
  hand_R: [40, 0, 0],
  upperarm_L: [-160, -18, 12],
  forearm_L: [-56, 0, 0],
  thigh_L: [-22, 0, 6],
  shin_L: [26, 0, 0],
  thigh_R: [18, 0, -6],
  shin_R: [18, 0, 0],
});
const L3_STRIKE: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.2, 0.1],
  hips: [10, -4, 0],
  spine: [16, 0, 0],
  chest: [18, 6, 0],
  neck: [-18, -4, 0],
  head: [-12, -2, 0],
  upperarm_R: [-58, 8, -6],
  forearm_R: [-8, 0, 0],
  hand_R: [52, 4, 0],
  upperarm_L: [-58, -22, 10],
  forearm_L: [-26, 0, 0],
  thigh_L: [-44, 0, 6],
  shin_L: [52, 0, 0],
  foot_L: [-8, 0, 0],
  thigh_R: [24, 0, -6],
  shin_R: [38, 0, 0],
  foot_R: [-56, 0, 0],
});

// Heavy: big overhead wind-up, full-body slam.
const HEAVY_WIND: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.06, -0.12],
  hips: [-6, -10, 0],
  spine: [-10, -4, 0],
  chest: [-16, 4, 0],
  neck: [8, 0, 0],
  head: [6, 0, 0],
  upperarm_R: [-176, 6, -6],
  forearm_R: [-70, 0, 0],
  hand_R: [18, 0, 0],
  upperarm_L: [-168, -14, 10],
  forearm_L: [-76, 0, 0],
  thigh_L: [-26, 0, 8],
  shin_L: [34, 0, 0],
  foot_L: [-8, 0, 0],
  thigh_R: [24, 0, -8],
  shin_R: [30, 0, 0],
  foot_R: [-54, 0, 0],
});
const HEAVY_STRIKE: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.3, 0.18],
  hips: [14, -2, 0],
  spine: [22, 0, 0],
  chest: [22, 4, 0],
  neck: [-24, 0, 0],
  head: [-14, 0, 0],
  upperarm_R: [-44, 8, -4],
  forearm_R: [-2, 0, 0],
  hand_R: [64, 2, 0],
  upperarm_L: [-46, -18, 8],
  forearm_L: [-20, 0, 0],
  thigh_L: [-62, 0, 8],
  shin_L: [74, 0, 0],
  foot_L: [-12, 0, 0],
  thigh_R: [26, 0, -8],
  shin_R: [52, 0, 0],
  foot_R: [-78, 0, 0],
});

const DEFLECT: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.02, -0.08],
  hips: [-4, -10, 0],
  spine: [-8, -12, 0],
  chest: [-12, -24, 0],
  neck: [10, 16, 0],
  upperarm_R: [-70, -50, -40],
  forearm_R: [-60, 0, 0],
  hand_R: [40, -20, 0],
  upperarm_L: [-20, 10, 40],
});

const JUMP: PoseDef = mergeDefs(IDLE, {
  $pos: [0, 0.05, 0],
  spine: [8, 0, 0],
  chest: [6, 10, 0],
  upperarm_R: [-50, 10, -30],
  forearm_R: [-50, 0, 0],
  hand_R: [30, 10, 0],
  upperarm_L: [-40, 0, 40],
  forearm_L: [-40, 0, 0],
  thigh_L: [-70, 0, 6],
  shin_L: [100, 0, 0],
  foot_L: [-20, 0, 0],
  thigh_R: [-30, 0, -6],
  shin_R: [80, 0, 0],
  foot_R: [-20, 0, 0],
});

const LAND: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.22, 0],
  spine: [16, 0, 0],
  chest: [12, 10, 0],
  thigh_L: [-50, 0, 8],
  shin_L: [70, 0, 0],
  foot_L: [-20, 0, 0],
  thigh_R: [-20, 0, -8],
  shin_R: [70, 0, 0],
  foot_R: [-50, 0, 0],
});

const ROLL_TUCK: PoseDef = {
  hips: [30, 0, 0],
  spine: [34, 0, 0],
  chest: [30, 0, 0],
  neck: [30, 0, 0],
  head: [20, 0, 0],
  upperarm_R: [-40, 0, -20],
  forearm_R: [-100, 0, 0],
  hand_R: [40, 0, 0],
  upperarm_L: [-40, 0, 20],
  forearm_L: [-110, 0, 0],
  thigh_L: [-120, 0, 8],
  shin_L: [140, 0, 0],
  thigh_R: [-110, 0, -8],
  shin_R: [140, 0, 0],
  foot_L: [20, 0, 0],
  foot_R: [20, 0, 0],
};

const HEAL: PoseDef = mergeDefs(IDLE, {
  spine: [0, 0, 0],
  chest: [-6, 6, 0],
  neck: [-14, 0, 0],
  head: [-22, 0, 0],
  upperarm_L: [-62, -34, 6],
  forearm_L: [-118, 0, 0],
  hand_L: [-20, 0, 0],
  upperarm_R: [-10, 0, -14],
  forearm_R: [-30, 0, 0],
  hand_R: [40, 0, 0],
});

const HIT: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.06, -0.1],
  hips: [-6, 0, 0],
  spine: [-10, 0, 0],
  chest: [-14, -6, 4],
  neck: [-16, 8, 0],
  head: [-12, 6, 0],
  upperarm_L: [-30, 0, 36],
  forearm_L: [-20, 0, 0],
  upperarm_R: [-30, 0, -30],
  forearm_R: [-30, 0, 0],
});

const DOWN: PoseDef = {
  $pos: [0, 0.2, -0.2],
  $rot: [-86, 0, 0],
  spine: [-4, 0, 0],
  chest: [-4, 0, 0],
  neck: [-8, 0, 0],
  head: [-10, 20, 0],
  upperarm_L: [-10, 0, 50],
  forearm_L: [-30, 0, 0],
  upperarm_R: [-20, 0, -40],
  forearm_R: [-40, 0, 0],
  hand_R: [40, 0, 0],
  thigh_L: [-30, 0, 10],
  shin_L: [40, 0, 0],
  thigh_R: [-10, 0, -6],
  shin_R: [20, 0, 0],
};

const GETUP: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.5, 0],
  hips: [30, 0, 0],
  spine: [20, 0, 0],
  chest: [10, 0, 0],
  upperarm_L: [-30, 0, 20],
  forearm_L: [-20, 0, 0],
  thigh_L: [-100, 0, 10],
  shin_L: [120, 0, 0],
  foot_L: [-20, 0, 0],
  thigh_R: [-20, 0, -10],
  shin_R: [110, 0, 0],
  foot_R: [-60, 0, 0],
});

const KNEEL_DEATH: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -0.46, 0],
  hips: [10, 0, 0],
  spine: [20, 0, 0],
  chest: [16, 0, 0],
  neck: [20, 0, 0],
  head: [16, 0, 0],
  upperarm_L: [-10, 0, 10],
  forearm_L: [-10, 0, 0],
  upperarm_R: [-10, 0, -10],
  forearm_R: [-10, 0, 0],
  hand_R: [70, 0, 0],
  thigh_L: [-90, 0, 6],
  shin_L: [150, 0, 0],
  foot_L: [30, 0, 0],
  thigh_R: [-20, 0, -6],
  shin_R: [110, 0, 0],
  foot_R: [0, 0, 0],
});

const FACE_DOWN: PoseDef = {
  $pos: [0, 0.18, 0.4],
  $rot: [84, 0, 0],
  neck: [10, 30, 0],
  head: [0, 20, 0],
  upperarm_L: [-150, 0, 30],
  forearm_L: [-20, 0, 0],
  upperarm_R: [-20, 0, -40],
  forearm_R: [-30, 0, 0],
  hand_R: [80, 0, 0],
  thigh_L: [-10, 0, 6],
  shin_L: [20, 0, 0],
  thigh_R: [0, 0, -4],
  shin_R: [10, 0, 0],
};

export const WARRIOR_POSE_DEFS = {
  idle: IDLE,
  block: BLOCK,
  l1Wind: L1_WIND,
  l1Strike: L1_STRIKE,
  l2Wind: L2_WIND,
  l2Strike: L2_STRIKE,
  l3Wind: L3_WIND,
  l3Strike: L3_STRIKE,
  heavyWind: HEAVY_WIND,
  heavyStrike: HEAVY_STRIKE,
  deflect: DEFLECT,
  jump: JUMP,
  land: LAND,
  rollTuck: ROLL_TUCK,
  heal: HEAL,
  hit: HIT,
  down: DOWN,
  getup: GETUP,
  kneelDeath: KNEEL_DEATH,
  faceDown: FACE_DOWN,
} satisfies Record<string, PoseDef>;

export type WarriorPoseName = keyof typeof WARRIOR_POSE_DEFS;
export type WarriorPoses = Record<WarriorPoseName, Pose>;

export function buildWarriorPoses(rig: Rig): WarriorPoses {
  const out = {} as WarriorPoses;
  for (const k of Object.keys(WARRIOR_POSE_DEFS) as WarriorPoseName[]) out[k] = Pose.from(WARRIOR_POSE_DEFS[k], rig);
  return out;
}

/**
 * Run / strafe cycle layered on a base stance. `lx, lz` = movement direction in the character's
 * local frame (x = left, z = forward), `amount` 0..1, phase in [0,1).
 */
export function warriorRun(out: Pose, base: Pose, rig: Rig, phase: number, amount: number, lx: number, lz: number, swordArm = true): void {
  out.copy(base);
  if (amount < 0.001) return;
  const a = amount;
  const s = Math.sin(phase * Math.PI * 2);
  const c = Math.cos(phase * Math.PI * 2);
  const lift = (v: number) => Math.max(0, v);
  const I = (n: string) => rig.i(n);
  const fw = lz; // forward component
  const sd = lx; // sideways component
  const swing = 38 * a;
  out.addEuler(I('thigh_L'), -swing * s * fw, 0, swing * 0.6 * s * sd);
  out.addEuler(I('thigh_R'), swing * s * fw, 0, -swing * 0.6 * s * sd);
  out.addEuler(I('shin_L'), 58 * lift(c) * a, 0, 0);
  out.addEuler(I('shin_R'), 58 * lift(-c) * a, 0, 0);
  out.addEuler(I('foot_L'), (10 * s * fw - 20 * lift(c)) * a, 0, 0);
  out.addEuler(I('foot_R'), (-10 * s * fw - 20 * lift(-c)) * a, 0, 0);
  out.addEuler(I('hips'), 0, 10 * s * a * fw, 0);
  out.addEuler(I('spine'), 10 * a * Math.max(0, fw), -6 * s * a * fw, 0);
  out.addEuler(I('chest'), 4 * a, -8 * s * a * fw, 0);
  out.addEuler(I('upperarm_L'), 30 * s * a * fw, 0, 0);
  out.addEuler(I('forearm_L'), -20 * a, 0, 0);
  if (!swordArm) out.addEuler(I('upperarm_R'), -30 * s * a * fw, 0, 0);
  else out.addEuler(I('upperarm_R'), -10 * s * a * fw, 0, 0);
  out.pos.y += -0.05 * a + 0.06 * Math.abs(c) * a;
}

/** Breathing layer. */
export function warriorBreath(out: Pose, rig: Rig, t: number, strength = 1): void {
  const b = Math.sin(t * 2.1) * strength;
  out.addEuler(rig.i('chest'), -1.6 * b, 0, 0);
  out.addEuler(rig.i('upperarm_L'), 1.2 * b, 0, 0);
  out.pos.y += 0.006 * b;
}
