import { mirrorDef, mergeDefs, Pose, type PoseDef } from './pose';
import type { Rig } from './rig';

/*
 * Golem pose library. Conventions (see pose.ts): x > 0 swings a hanging limb back / bends the
 * spine forward, z > 0 swings a limb toward the golem's left (+X), y > 0 turns toward the left.
 * Rotations are hierarchical: the arms hang from the chest, so torso pitch must be compensated
 * on the upper arms. `_L` defs are authored for the left arm and mirrored for the right.
 */

const IDLE: PoseDef = {
  $pos: [0, -0.15, 0],
  hips: [8, 0, 0],
  spine: [12, 0, 0],
  chest: [14, 0, 0],
  neck: [-20, 0, 0],
  head: [-12, 0, 0],
  shoulder_L: [0, 0, -4],
  shoulder_R: [0, 0, 4],
  upperarm_L: [-40, 0, 8],
  upperarm_R: [-40, 0, -8],
  forearm_L: [-18, 0, 0],
  forearm_R: [-18, 0, 0],
  hand_L: [10, 0, 0],
  hand_R: [10, 0, 0],
  thigh_L: [-22, 0, 3],
  thigh_R: [-22, 0, -3],
  shin_L: [26, 0, 0],
  shin_R: [26, 0, 0],
  foot_L: [-12, 0, 0],
  foot_R: [-12, 0, 0],
};

// ---- slam (left arm) ----
const SLAM_RAISE_L: PoseDef = mergeDefs(IDLE, {
  $pos: [0.3, 0.2, -0.6],
  hips: [-2, 10, 0],
  spine: [-6, 12, 0],
  chest: [-10, 18, -10],
  neck: [-8, -10, 0],
  head: [-10, -10, 0],
  shoulder_L: [0, 0, 12],
  upperarm_L: [-172, 10, 18],
  forearm_L: [-48, 0, 0],
  hand_L: [-10, 0, 0],
  upperarm_R: [-12, 0, -22],
  forearm_R: [-20, 0, 0],
  thigh_L: [-30, 0, 8],
  shin_L: [34, 0, 0],
  foot_L: [-2, 0, 0],
  thigh_R: [4, 0, -8],
  shin_R: [20, 0, 0],
  foot_R: [-22, 0, 0],
});

const SLAM_HIT_L: PoseDef = mergeDefs(IDLE, {
  $pos: [0.2, -2.1, 1.2],
  hips: [18, 8, 0],
  spine: [24, 10, 0],
  chest: [24, 12, 0],
  neck: [-32, -8, 0],
  head: [-16, -8, 0],
  shoulder_L: [8, 0, 6],
  upperarm_L: [-108, 8, 8],
  forearm_L: [-14, 0, 0],
  hand_L: [30, 0, 0],
  upperarm_R: [-50, 0, -30],
  forearm_R: [-30, 0, 0],
  thigh_L: [-62, 0, 8],
  shin_L: [72, 0, 0],
  foot_L: [-28, 0, 0],
  thigh_R: [-8, 0, -8],
  shin_R: [52, 0, 0],
  foot_R: [-62, 0, 0],
});

const SLAM_STRAIN_L: PoseDef = mergeDefs(SLAM_HIT_L, {
  $pos: [0.2, -1.9, 1.0],
  spine: [20, 14, 0],
  chest: [20, 16, -6],
  neck: [-26, -14, 0],
  head: [-14, -12, 0],
  upperarm_R: [-60, 0, -40],
});

const SLAM_PULL_L: PoseDef = mergeDefs(IDLE, {
  $pos: [0.1, -0.9, 0.2],
  hips: [4, 6, 0],
  spine: [6, 10, 0],
  chest: [2, 14, -6],
  neck: [-12, -8, 0],
  upperarm_L: [-80, 10, 20],
  forearm_L: [-40, 0, 0],
  hand_L: [0, 0, 0],
  thigh_L: [-36, 0, 6],
  shin_L: [46, 0, 0],
  foot_L: [-14, 0, 0],
});

// ---- double slam (both arms, hammer fist) ----
const DOUBLE_RAISE: PoseDef = mergeDefs(IDLE, {
  $pos: [0, 0.4, -0.8],
  hips: [-4, 0, 0],
  spine: [-8, 0, 0],
  chest: [-14, 0, 0],
  neck: [-6, 0, 0],
  head: [-14, 0, 0],
  shoulder_L: [0, 0, 14],
  shoulder_R: [0, 0, -14],
  upperarm_L: [-176, 0, -12],
  upperarm_R: [-176, 0, 12],
  forearm_L: [-42, 0, 0],
  forearm_R: [-42, 0, 0],
  hand_L: [-10, 0, 0],
  hand_R: [-10, 0, 0],
  thigh_L: [-8, 0, 10],
  thigh_R: [-8, 0, -10],
  shin_L: [14, 0, 0],
  shin_R: [14, 0, 0],
  foot_L: [-14, 0, 0],
  foot_R: [-14, 0, 0],
});

const DOUBLE_HIT: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -2.4, 1.4],
  hips: [20, 0, 0],
  spine: [26, 0, 0],
  chest: [26, 0, 0],
  neck: [-34, 0, 0],
  head: [-16, 0, 0],
  shoulder_L: [8, 0, -6],
  shoulder_R: [8, 0, 6],
  upperarm_L: [-112, 0, -10],
  upperarm_R: [-112, 0, 10],
  forearm_L: [-10, 0, 0],
  forearm_R: [-10, 0, 0],
  hand_L: [28, 0, 0],
  hand_R: [28, 0, 0],
  thigh_L: [-56, 0, 10],
  thigh_R: [-56, 0, -10],
  shin_L: [74, 0, 0],
  shin_R: [74, 0, 0],
  foot_L: [-38, 0, 0],
  foot_R: [-38, 0, 0],
});

// ---- sweep (left arm sweeps from the golem's left across to its right) ----
// The torso yaw carries the arm; during the strike an IK target runs along a ground-level arc.
const SWEEP_WIND_L: PoseDef = mergeDefs(IDLE, {
  $pos: [0.6, -1.4, -0.4],
  hips: [12, 18, 0],
  spine: [14, 14, 0],
  chest: [12, 16, -6],
  neck: [-20, -26, 0],
  head: [-10, -16, 0],
  shoulder_L: [0, 0, 10],
  upperarm_L: [-46, 0, 58],
  forearm_L: [-14, 0, 0],
  hand_L: [10, 0, 0],
  upperarm_R: [-50, 0, -16],
  forearm_R: [-30, 0, 0],
  thigh_L: [-40, 0, 12],
  shin_L: [52, 0, 0],
  foot_L: [-24, 0, 0],
  thigh_R: [-14, 0, -8],
  shin_R: [30, 0, 0],
  foot_R: [-28, 0, 0],
});

const SWEEP_END_L: PoseDef = mergeDefs(IDLE, {
  $pos: [-0.6, -1.7, 0.6],
  hips: [16, -22, 0],
  spine: [16, -20, 0],
  chest: [14, -26, 4],
  neck: [-22, 26, 0],
  head: [-12, 16, 0],
  shoulder_L: [0, 0, 6],
  upperarm_L: [-80, 0, 40],
  forearm_L: [-10, 0, 0],
  hand_L: [18, 0, 0],
  upperarm_R: [-36, 0, -30],
  forearm_R: [-20, 0, 0],
  thigh_L: [-16, 0, 8],
  shin_L: [36, 0, 0],
  foot_L: [-34, 0, 0],
  thigh_R: [-42, 0, -12],
  shin_R: [54, 0, 0],
  foot_R: [-26, 0, 0],
});

// ---- stomp (left leg) ----
const STOMP_RAISE_L: PoseDef = mergeDefs(IDLE, {
  $pos: [-1.1, 0.5, -0.2],
  hips: [2, 0, -10],
  spine: [2, 0, 6],
  chest: [4, 0, 8],
  neck: [-10, 0, -4],
  head: [-8, 0, 0],
  shoulder_L: [0, 0, 8],
  shoulder_R: [0, 0, -8],
  upperarm_L: [-34, 0, 28],
  upperarm_R: [-34, 0, -28],
  forearm_L: [-30, 0, 0],
  forearm_R: [-30, 0, 0],
  thigh_L: [-86, 0, 12],
  shin_L: [74, 0, 0],
  foot_L: [8, 0, 0],
  thigh_R: [-8, 0, 2],
  shin_R: [14, 0, 0],
  foot_R: [-10, 0, 0],
});

const STOMP_HIT_L: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -1.1, 0.4],
  hips: [14, 0, 4],
  spine: [16, 0, -2],
  chest: [16, 0, -2],
  neck: [-24, 0, 0],
  head: [-10, 0, 0],
  upperarm_L: [-30, 0, 30],
  upperarm_R: [-30, 0, -30],
  forearm_L: [-20, 0, 0],
  forearm_R: [-20, 0, 0],
  thigh_L: [-44, 0, 10],
  shin_L: [46, 0, 0],
  foot_L: [-16, 0, 0],
  thigh_R: [-20, 0, -4],
  shin_R: [40, 0, 0],
  foot_R: [-34, 0, 0],
});

// ---- rock throw (right arm) ----
const THROW_GRAB_R: PoseDef = mergeDefs(IDLE, {
  $pos: [-0.3, -2.3, 0.4],
  hips: [22, -10, 0],
  spine: [26, -8, 0],
  chest: [20, -14, 6],
  neck: [-22, 8, 0],
  head: [-8, 6, 0],
  upperarm_R: [-70, -10, -12],
  forearm_R: [-24, 0, 0],
  hand_R: [20, 0, 0],
  upperarm_L: [-60, 0, 20],
  forearm_L: [-30, 0, 0],
  thigh_L: [-58, 0, 8],
  shin_L: [74, 0, 0],
  foot_L: [-38, 0, 0],
  thigh_R: [-50, 0, -12],
  shin_R: [70, 0, 0],
  foot_R: [-42, 0, 0],
});

const THROW_RAISE_R: PoseDef = mergeDefs(IDLE, {
  $pos: [0.4, 0.3, -0.8],
  hips: [-4, -14, 0],
  spine: [-8, -16, 0],
  chest: [-12, -22, 8],
  neck: [-6, 22, 0],
  head: [-10, 16, 0],
  shoulder_R: [0, 0, -14],
  upperarm_R: [-160, -20, -14],
  forearm_R: [-70, 0, 0],
  hand_R: [-20, 0, 0],
  upperarm_L: [-86, 20, 16],
  forearm_L: [-10, 0, 0],
  thigh_L: [-26, 0, 8],
  shin_L: [24, 0, 0],
  foot_L: [-6, 0, 0],
  thigh_R: [8, 0, -10],
  shin_R: [18, 0, 0],
  foot_R: [-26, 0, 0],
});

const THROW_RELEASE_R: PoseDef = mergeDefs(IDLE, {
  $pos: [-0.4, -0.9, 1.2],
  hips: [14, 12, 0],
  spine: [16, 14, 0],
  chest: [18, 20, -4],
  neck: [-22, -18, 0],
  head: [-10, -10, 0],
  shoulder_R: [4, 0, -4],
  upperarm_R: [-104, 16, -8],
  forearm_R: [-8, 0, 0],
  hand_R: [10, 0, 0],
  upperarm_L: [-10, -10, 30],
  forearm_L: [-30, 0, 0],
  thigh_L: [-46, 0, 8],
  shin_L: [50, 0, 0],
  foot_L: [-12, 0, 0],
  thigh_R: [-4, 0, -8],
  shin_R: [40, 0, 0],
  foot_R: [-50, 0, 0],
});

// ---- brace: knuckles planted after a stomp or the meteor rain (a punish window) ----
const BRACE: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -1.9, 0.5],
  hips: [18, 0, 0],
  spine: [22, 0, 0],
  chest: [16, 0, 0],
  neck: [-32, 0, 0],
  head: [-14, 0, 0],
  upperarm_L: [-58, 0, 16],
  upperarm_R: [-58, 0, -16],
  forearm_L: [-26, 0, 0],
  forearm_R: [-26, 0, 0],
  hand_L: [24, 0, 0],
  hand_R: [24, 0, 0],
  thigh_L: [-52, 0, 8],
  thigh_R: [-52, 0, -8],
  shin_L: [66, 0, 0],
  shin_R: [66, 0, 0],
  foot_L: [-32, 0, 0],
  foot_R: [-32, 0, 0],
});

// ---- roar (phase change) ----
const ROAR: PoseDef = mergeDefs(IDLE, {
  $pos: [0, 0.35, -0.6],
  hips: [-2, 0, 0],
  spine: [-10, 0, 0],
  chest: [-22, 0, 0],
  neck: [-8, 0, 0],
  head: [-12, 0, 0],
  shoulder_L: [0, 0, 18],
  shoulder_R: [0, 0, -18],
  upperarm_L: [-70, -10, 70],
  upperarm_R: [-70, 10, -70],
  forearm_L: [-40, 0, 0],
  forearm_R: [-40, 0, 0],
  hand_L: [-20, 0, 0],
  hand_R: [-20, 0, 0],
  thigh_L: [-14, 0, 10],
  thigh_R: [-14, 0, -10],
  shin_L: [14, 0, 0],
  shin_R: [14, 0, 0],
  foot_L: [-2, 0, 0],
  foot_R: [-2, 0, 0],
});

const ROAR_SKY: PoseDef = mergeDefs(ROAR, {
  upperarm_L: [-150, 0, 40],
  upperarm_R: [-150, 0, -40],
  forearm_L: [-20, 0, 0],
  forearm_R: [-20, 0, 0],
  head: [-16, 0, 0],
});

// ---- the old symmetric kneel: the rubble mound of the title screen and intro is built on it ----
const KNEEL_SYM: PoseDef = {
  $pos: [0, -4.2, 0.3],
  hips: [-12, 0, 0],
  spine: [20, 0, 0],
  chest: [12, 0, 0],
  neck: [6, 0, 0],
  head: [16, 0, 0],
  shoulder_L: [0, 0, -8],
  shoulder_R: [0, 0, 8],
  upperarm_L: [-48, 0, 18],
  upperarm_R: [-48, 0, -18],
  forearm_L: [-18, 0, 0],
  forearm_R: [-18, 0, 0],
  hand_L: [50, 0, 0],
  hand_R: [50, 0, 0],
  thigh_L: [-47, 0, 9],
  thigh_R: [-47, 0, -9],
  shin_L: [152, 0, 0],
  shin_R: [152, 0, 0],
  foot_L: [82, 0, 0],
  foot_R: [82, 0, 0],
};

// ---- stagger: a beaten giant down on one knee, the other knee up, one fist braced on the floor, the
// other arm slumped over the raised knee, head hanging (asymmetric so it reads as a figure from any side)
const KNEEL: PoseDef = mergeDefs(KNEEL_SYM, {
  $pos: [0, -4.2, 0.3],
  hips: [-12, 0, 4],
  spine: [24, 6, -4],
  chest: [14, 4, -5],
  neck: [10, 0, 0],
  head: [30, -8, 0],
  upperarm_L: [-52, 0, 22],
  forearm_L: [-16, 0, 0],
  hand_L: [50, 0, 0],
  upperarm_R: [-26, 0, -4],
  forearm_R: [-60, 0, 0],
  hand_R: [40, 0, 0],
  thigh_R: [-85, 0, -12],
  shin_R: [95, 0, 0],
  foot_R: [4, 0, 0],
});

const KNEEL_SLUMP: PoseDef = mergeDefs(KNEEL, {
  $pos: [0, -4.35, 0.35],
  spine: [29, 6, -4],
  chest: [18, 4, -5],
  head: [38, -8, 0],
});

const KNEEL_SYM_SLUMP: PoseDef = mergeDefs(KNEEL_SYM, {
  $pos: [0, -4.35, 0.35],
  spine: [25, 0, 0],
  chest: [16, 0, 0],
  head: [24, 0, 0],
});

const PUSH_UP: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -2.4, 0.4],
  hips: [20, 0, 0],
  spine: [28, 0, 0],
  chest: [20, 0, 0],
  neck: [-10, 0, 0],
  upperarm_L: [-62, 0, 30],
  upperarm_R: [-62, 0, -30],
  forearm_L: [-30, 0, 0],
  forearm_R: [-30, 0, 0],
  thigh_L: [-70, 0, 12],
  thigh_R: [-70, 0, -12],
  shin_L: [96, 0, 0],
  shin_R: [96, 0, 0],
  foot_L: [-44, 0, 0],
  foot_R: [-44, 0, 0],
});

// ---- leap slam (phase 3) ----
const LEAP_CROUCH: PoseDef = mergeDefs(IDLE, {
  $pos: [0, -2.9, -0.4],
  hips: [26, 0, 0],
  spine: [22, 0, 0],
  chest: [10, 0, 0],
  neck: [-30, 0, 0],
  head: [-14, 0, 0],
  upperarm_L: [-10, 0, 24],
  upperarm_R: [-10, 0, -24],
  forearm_L: [-10, 0, 0],
  forearm_R: [-10, 0, 0],
  thigh_L: [-84, 0, 12],
  thigh_R: [-84, 0, -12],
  shin_L: [110, 0, 0],
  shin_R: [110, 0, 0],
  foot_L: [-52, 0, 0],
  foot_R: [-52, 0, 0],
});

const LEAP_AIR: PoseDef = mergeDefs(DOUBLE_RAISE, {
  thigh_L: [-60, 0, 10],
  thigh_R: [-40, 0, -10],
  shin_L: [80, 0, 0],
  shin_R: [60, 0, 0],
  foot_L: [10, 0, 0],
  foot_R: [10, 0, 0],
});

// ---- dormant rubble (used for the intro camera and title screen) ----
const DORMANT: PoseDef = mergeDefs(KNEEL_SYM_SLUMP, {
  $pos: [0, -5.6, 0.6],
  spine: [60, 0, 0],
  chest: [40, 0, 0],
  head: [30, 0, 0],
});

export const GOLEM_POSE_DEFS = {
  idle: IDLE,
  slamRaise_L: SLAM_RAISE_L,
  slamHit_L: SLAM_HIT_L,
  slamStrain_L: SLAM_STRAIN_L,
  slamPull_L: SLAM_PULL_L,
  slamRaise_R: mirrorDef(SLAM_RAISE_L),
  slamHit_R: mirrorDef(SLAM_HIT_L),
  slamStrain_R: mirrorDef(SLAM_STRAIN_L),
  slamPull_R: mirrorDef(SLAM_PULL_L),
  doubleRaise: DOUBLE_RAISE,
  doubleHit: DOUBLE_HIT,
  sweepWind_L: SWEEP_WIND_L,
  sweepEnd_L: SWEEP_END_L,
  sweepWind_R: mirrorDef(SWEEP_WIND_L),
  sweepEnd_R: mirrorDef(SWEEP_END_L),
  stompRaise_L: STOMP_RAISE_L,
  stompHit_L: STOMP_HIT_L,
  stompRaise_R: mirrorDef(STOMP_RAISE_L),
  stompHit_R: mirrorDef(STOMP_HIT_L),
  throwGrab_R: THROW_GRAB_R,
  throwRaise_R: THROW_RAISE_R,
  throwRelease_R: THROW_RELEASE_R,
  throwGrab_L: mirrorDef(THROW_GRAB_R),
  throwRaise_L: mirrorDef(THROW_RAISE_R),
  throwRelease_L: mirrorDef(THROW_RELEASE_R),
  roar: ROAR,
  roarSky: ROAR_SKY,
  kneel: KNEEL,
  kneelSlump: KNEEL_SLUMP,
  pushUp: PUSH_UP,
  leapCrouch: LEAP_CROUCH,
  leapAir: LEAP_AIR,
  dormant: DORMANT,
  brace: BRACE,
} satisfies Record<string, PoseDef>;

export type GolemPoseName = keyof typeof GOLEM_POSE_DEFS;
export type GolemPoses = Record<GolemPoseName, Pose>;

export function buildGolemPoses(rig: Rig): GolemPoses {
  const out = {} as GolemPoses;
  for (const k of Object.keys(GOLEM_POSE_DEFS) as GolemPoseName[]) out[k] = Pose.from(GOLEM_POSE_DEFS[k], rig);
  return out;
}

/** Walk / turn cycle. phase in [0,1), amount 0..1 (0 = idle). */
export function golemWalk(out: Pose, idle: Pose, rig: Rig, phase: number, amount: number, turn: number): void {
  out.copy(idle);
  if (amount <= 0.001 && Math.abs(turn) < 0.001) return;
  const a = Math.max(amount, Math.min(1, Math.abs(turn)) * 0.7);
  const s = Math.sin(phase * Math.PI * 2);
  const c = Math.cos(phase * Math.PI * 2);
  const lift = (v: number) => Math.max(0, v);
  const I = (n: string) => rig.i(n);
  // legs: forward swing on x, knee lifts while the leg travels forward
  out.addEuler(I('thigh_L'), -24 * s * a, 0, 0);
  out.addEuler(I('thigh_R'), 24 * s * a, 0, 0);
  out.addEuler(I('shin_L'), 36 * lift(c) * a, 0, 0);
  out.addEuler(I('shin_R'), 36 * lift(-c) * a, 0, 0);
  out.addEuler(I('foot_L'), (12 * s - 16 * lift(c)) * a, 0, 0);
  out.addEuler(I('foot_R'), (-12 * s - 16 * lift(-c)) * a, 0, 0);
  // weight shift and heavy bob
  out.addEuler(I('hips'), 0, 7 * s * a, 4 * c * a);
  out.addEuler(I('chest'), 3 * Math.abs(s) * a, -10 * s * a, -3 * c * a);
  out.addEuler(I('neck'), 0, 6 * s * a, 0);
  out.pos.y -= 0.5 * Math.abs(c) * a;
  out.pos.x += 0.35 * c * a;
  // arms swing opposite to the legs
  out.addEuler(I('upperarm_L'), 16 * s * a, 0, 0);
  out.addEuler(I('upperarm_R'), -16 * s * a, 0, 0);
  out.addEuler(I('forearm_L'), -8 * lift(-s) * a, 0, 0);
  out.addEuler(I('forearm_R'), -8 * lift(s) * a, 0, 0);
}

/** Slow breathing layered on idle. */
export function golemBreath(out: Pose, rig: Rig, t: number, strength = 1): void {
  const b = Math.sin(t * 1.3) * strength;
  out.addEuler(rig.i('chest'), -1.5 * b, 0, 0);
  out.addEuler(rig.i('neck'), 1.2 * b, 0, 0);
  out.addEuler(rig.i('upperarm_L'), 1.2 * b, 0, -1 * b);
  out.addEuler(rig.i('upperarm_R'), 1.2 * b, 0, 1 * b);
  out.pos.y += 0.08 * b;
}
