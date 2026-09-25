import * as THREE from 'three';
import { clamp, ease, RNG } from '../core/math';

interface Piece {
  obj: THREE.Object3D;
  finalPos: THREE.Vector3;
  finalQuat: THREE.Quaternion;
  finalScale: THREE.Vector3;
  startPos: THREE.Vector3;
  startQuat: THREE.Quaternion;
  order: number;
  delay: number;
}

const _m = new THREE.Matrix4();
const _mInv = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _fw = new THREE.Matrix4();

/**
 * Makes a bone-parented model assemble itself from rubble: every piece starts lying on the
 * floor around `center` and flies along an arc into its place on the (posed) skeleton.
 * progress 0 = all rubble, 1 = fully assembled.
 */
export class Assembler {
  private readonly pieces: Piece[] = [];
  private lastProgress = -1;
  onPieceLanded: ((pos: THREE.Vector3, size: number) => void) | null = null;

  private readonly center: THREE.Vector3;

  constructor(objects: THREE.Object3D[], center: THREE.Vector3, seed = 7) {
    this.center = center.clone();
    const rng = new RNG(seed);
    for (const obj of objects) {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3()).length() * 0.5;
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(2, 9);
      this.pieces.push({
        obj,
        finalPos: obj.position.clone(),
        finalQuat: obj.quaternion.clone(),
        finalScale: obj.scale.clone(),
        startPos: new THREE.Vector3(center.x + Math.cos(a) * r, Math.max(0.3, size * 0.35), center.z + Math.sin(a) * r),
        startQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-2, 2), rng.range(0, 6), rng.range(-2, 2))),
        order: 0,
        delay: 0,
      });
    }
    // bottom pieces first
    const heights = this.pieces.map((p) => p.obj.getWorldPosition(new THREE.Vector3()).y);
    const idx = this.pieces.map((_, i) => i).sort((i, j) => heights[i] - heights[j]);
    idx.forEach((i, k) => {
      this.pieces[i].order = k / Math.max(1, idx.length - 1);
      this.pieces[i].delay = rng.range(-0.06, 0.06);
    });
  }

  /** Apply the assembly state. Call after the skeleton has been posed and matrices updated. */
  apply(progress: number, time: number): void {
    const p = clamp(progress, 0, 1);
    if (p >= 1 && this.lastProgress >= 1) return;
    const flight = 0.3;
    for (const pc of this.pieces) {
      if (pc.obj.userData.detached) continue; // burst off (phase 3 chest plates): lying where it fell
      const start = clamp(pc.order * (1 - flight) + pc.delay, 0, 1 - flight);
      const u = clamp((p - start) / flight, 0, 1);
      const parent = pc.obj.parent;
      if (!parent) continue;
      // crumbling (progress falling): a stone reaching the rubble raises dust (every third, it is a lot of stones)
      if (u <= 0 && this.lastProgress > p && this.onPieceLanded && (this.pieces.indexOf(pc) % 3 === 0)) {
        const prevU = clamp((this.lastProgress - start) / flight, 0, 1);
        if (prevU > 0) this.onPieceLanded(pc.startPos.clone(), 1);
      }
      if (u >= 1) {
        if (this.lastProgress >= 0 && this.lastProgress < 1) {
          const prevU = clamp((this.lastProgress - start) / flight, 0, 1);
          if (prevU < 1 && this.onPieceLanded) this.onPieceLanded(pc.obj.getWorldPosition(new THREE.Vector3()), 1);
        }
        pc.obj.position.copy(pc.finalPos);
        pc.obj.quaternion.copy(pc.finalQuat);
        pc.obj.scale.copy(pc.finalScale);
        continue;
      }
      // final world transform
      _m.compose(pc.finalPos, pc.finalQuat, pc.finalScale);
      _fw.multiplyMatrices(parent.matrixWorld, _m);
      _fw.decompose(_pos, _quat, _scl);
      // arc from rubble to place, with a wobble while lying
      const e = ease.inOutCubic(u);
      const wob = u === 0 ? Math.sin(time * 3 + pc.order * 20) * 0.02 * p : 0;
      const wp = new THREE.Vector3().lerpVectors(pc.startPos, _pos, e);
      wp.y += Math.sin(e * Math.PI) * (3 + pc.order * 4) + wob;
      const wq = new THREE.Quaternion().slerpQuaternions(pc.startQuat, _quat, ease.inOutSine(u));
      // back to parent-local
      _mInv.copy(parent.matrixWorld).invert();
      _m.compose(wp, wq, _scl);
      _m.premultiply(_mInv);
      _m.decompose(pc.obj.position, pc.obj.quaternion, pc.obj.scale);
    }
    this.lastProgress = p;
  }

  /** Reset to rubble (for retries). */
  reset(): void {
    this.lastProgress = -1;
    if (this.home) this.setCenter(this.home);
  }

  private home: THREE.Vector3 | null = null;

  /** Move the rubble field (keeps each piece's offset) - used to crumble where the golem fell. */
  setCenter(center: THREE.Vector3): void {
    if (!this.home) this.home = this.center.clone();
    const dx = center.x - this.center.x;
    const dz = center.z - this.center.z;
    for (const pc of this.pieces) {
      pc.startPos.x += dx;
      pc.startPos.z += dz;
    }
    this.center.set(center.x, 0, center.z);
    this.lastProgress = 0.5;
  }
}
