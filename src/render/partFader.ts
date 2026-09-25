import * as THREE from 'three';

interface FadePart {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  center: THREE.Vector3;
  radius: number;
  opacity: number;
}

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Fades whole golem parts that crowd the camera or stand between the camera and the warrior.
 * Each part needs its own material instance (they share one shader program).
 */
export class PartFader {
  private readonly parts: FadePart[] = [];

  constructor(meshes: THREE.Mesh[]) {
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const bs = geo.boundingSphere!;
      this.parts.push({ mesh, mat: mesh.material as THREE.MeshStandardMaterial, center: bs.center.clone(), radius: bs.radius, opacity: 1 });
    }
  }

  /** blocked: bone pivots whose capsule cuts the camera's view of the warrior (their pieces fade). */
  update(cam: THREE.Vector3, focus: THREE.Vector3, dt: number, enabled: boolean, blocked?: Set<THREE.Object3D>, near = 2.2): void {
    _d.subVectors(focus, cam);
    const len = _d.length();
    _d.divideScalar(Math.max(len, 1e-3));
    for (const p of this.parts) {
      let want = 1;
      if (enabled && p.mesh.visible) {
        if (blocked && p.mesh.parent && blocked.has(p.mesh.parent)) want = 0.22;
        _c.copy(p.center).applyMatrix4(p.mesh.matrixWorld);
        p.mesh.matrixWorld.decompose(_s, _q, _s);
        const r = p.radius * Math.max(_s.x, _s.y, _s.z);
        const dCam = _c.distanceTo(cam) - r;
        if (dCam < near) want = Math.min(want, 0.12 + 0.88 * Math.max(0, dCam) / near);
        const along = _s.subVectors(_c, cam).dot(_d);
        if (along > 0 && along < len - 0.8) {
          const lateral = _s.addScaledVector(_d, -along).length() - r * 0.8;
          if (lateral < 0.3) want = Math.min(want, 0.28);
        }
      }
      p.opacity += (want - p.opacity) * Math.min(1, dt * 10);
      const faded = p.opacity < 0.985;
      p.mat.opacity = faded ? p.opacity : 1;
      if (p.mat.transparent !== faded) {
        p.mat.transparent = faded;
        p.mat.depthWrite = !faded;
      }
    }
  }
}
