import * as THREE from 'three';
import { clamp } from '../core/math';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _b2 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _qDelta = new THREE.Quaternion();
const _qWorld = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qFk1 = new THREE.Quaternion();
const _qFk2 = new THREE.Quaternion();

/** Rotate `bone` in world space by `delta` (keeps its world position). */
function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion): void {
  bone.getWorldQuaternion(_qWorld);
  _qWorld.premultiply(delta);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_qParent);
    _qParent.invert();
    bone.quaternion.copy(_qParent.multiply(_qWorld));
  } else bone.quaternion.copy(_qWorld);
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK: rotates `upper` and `lower` so that the end effector (the head of `end`,
 * or `endOffsetLocal` expressed in `end`'s frame) reaches `target`. `pole` is a world-space point
 * the middle joint bends toward. `weight` blends with the incoming FK pose.
 */
export function solveTwoBone(
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  weight = 1,
  endOffsetLocal?: THREE.Vector3,
): void {
  if (weight <= 0) return;
  upper.updateMatrixWorld(true);
  _qFk1.copy(upper.quaternion);
  _qFk2.copy(lower.quaternion);

  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  if (endOffsetLocal) _c.copy(endOffsetLocal).applyMatrix4(end.matrixWorld);
  else end.getWorldPosition(_c);
  _t.copy(target);

  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _dir.subVectors(_t, _a);
  let d = _dir.length();
  if (d < 1e-5) return;
  d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  _dir.normalize();

  // Bend direction: component of (pole - a) perpendicular to the reach direction.
  _pole.subVectors(pole, _a);
  _bend.copy(_pole).addScaledVector(_dir, -_pole.dot(_dir));
  if (_bend.lengthSq() < 1e-8) {
    // Fall back to the current bend.
    _bend.subVectors(_b, _a).addScaledVector(_dir, -_v1.subVectors(_b, _a).dot(_dir));
    if (_bend.lengthSq() < 1e-8) _bend.set(0, 1, 0);
  }
  _bend.normalize();

  // Law of cosines for the angle at the root.
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _b2.copy(_a).addScaledVector(_dir, l1 * cosA).addScaledVector(_bend, l1 * sinA);

  // Rotate upper so (b - a) points at b2.
  _v1.subVectors(_b, _a).normalize();
  _v2.subVectors(_b2, _a).normalize();
  _qDelta.setFromUnitVectors(_v1, _v2);
  rotateWorld(upper, _qDelta);

  // Rotate lower so (c - b) points at the target.
  lower.getWorldPosition(_b);
  if (endOffsetLocal) _c.copy(endOffsetLocal).applyMatrix4(end.matrixWorld);
  else end.getWorldPosition(_c);
  _v1.subVectors(_c, _b).normalize();
  _t.copy(_a).addScaledVector(_dir, d);
  _v2.subVectors(_t, _b).normalize();
  _qDelta.setFromUnitVectors(_v1, _v2);
  rotateWorld(lower, _qDelta);

  if (weight < 1) {
    upper.quaternion.slerpQuaternions(_qFk1, upper.quaternion, weight);
    lower.quaternion.slerpQuaternions(_qFk2, lower.quaternion, weight);
    upper.updateMatrixWorld(true);
  }
}

/** Rotate `bone` (world space) so that the direction from its pivot to `from` points at `to`. */
export function aimBone(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight = 1): void {
  if (weight <= 0) return;
  bone.updateMatrixWorld(true);
  const p = bone.getWorldPosition(_a);
  _v1.subVectors(from, p).normalize();
  _v2.subVectors(to, p).normalize();
  _qDelta.setFromUnitVectors(_v1, _v2);
  if (weight < 1) _qDelta.slerp(new THREE.Quaternion(), 1 - weight);
  rotateWorld(bone, _qDelta);
}
