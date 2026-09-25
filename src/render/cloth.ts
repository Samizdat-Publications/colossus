import * as THREE from 'three';

interface Sphere {
  c: THREE.Vector3;
  r: number;
}

const _w = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _d = new THREE.Vector3();

/**
 * Verlet cloth for the warrior's cape (the Blender grid from warrior.py). The top row is pinned to the
 * chest; the rest swings under gravity, the storm's wind and the warrior's motion, and is pushed out of
 * a few spheres that stand in for the body. Draco reorders vertices, so the grid is rebuilt from the
 * rest positions (rows by height, columns by x).
 */
export class Cape {
  private readonly pos: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly rest: THREE.Vector3[] = []; // in the anchor's space
  private readonly pinned: boolean[] = [];
  private readonly links: [number, number, number][] = [];
  private readonly vertexToParticle: number[] = [];
  private readonly geo: THREE.BufferGeometry;
  private ready = false;

  constructor(
    private readonly mesh: THREE.Mesh,
    private readonly anchor: THREE.Object3D,
    private readonly body: () => Sphere[],
  ) {
    this.geo = mesh.geometry;
    this.build();
  }

  private build(): void {
    this.mesh.updateWorldMatrix(true, false);
    this.anchor.updateWorldMatrix(true, false);
    const attr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const n = attr.count;
    const world: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) world.push(new THREE.Vector3().fromBufferAttribute(attr, i).applyMatrix4(this.mesh.matrixWorld));
    // unique grid points (vertices may be split per face)
    const key = (v: THREE.Vector3) => `${Math.round(v.x * 200)},${Math.round(v.y * 200)},${Math.round(v.z * 200)}`;
    const index = new Map<string, number>();
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const k = key(world[i]);
      let p = index.get(k);
      if (p === undefined) {
        p = points.length;
        index.set(k, p);
        points.push(world[i].clone());
      }
      this.vertexToParticle.push(p);
    }
    // rows by height (top first), columns by x
    const ys = [...new Set(points.map((p) => Math.round(p.y * 50)))].sort((a, b) => b - a);
    const rows: number[][] = ys.map(() => []);
    points.forEach((p, i) => rows[ys.indexOf(Math.round(p.y * 50))].push(i));
    for (const r of rows) r.sort((a, b) => points[a].x - points[b].x);
    _inv.copy(this.anchor.matrixWorld).invert();
    points.forEach((p, i) => {
      this.pos.push(p.clone());
      this.prev.push(p.clone());
      this.rest.push(p.clone().applyMatrix4(_inv));
      this.pinned.push(rows[0].includes(i));
    });
    const link = (a: number, b: number) => this.links.push([a, b, points[a].distanceTo(points[b])]);
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        if (i + 1 < row.length) link(row[i], row[i + 1]);
        if (i + 2 < row.length) link(row[i], row[i + 2]);
        const below = rows[j + 1];
        if (below && below.length === row.length) {
          link(row[i], below[i]);
          if (i + 1 < row.length) link(row[i], below[i + 1]);
          if (i > 0) link(row[i], below[i - 1]);
        }
        const below2 = rows[j + 2];
        if (below2 && below2.length === row.length) link(row[i], below2[i]);
      }
    }
    this.ready = rows.length > 2;
  }

  /** Snap back to the rest shape (retries, teleports). */
  reset(): void {
    this.anchor.updateWorldMatrix(true, false);
    for (let i = 0; i < this.pos.length; i++) {
      _w.copy(this.rest[i]).applyMatrix4(this.anchor.matrixWorld);
      this.pos[i].copy(_w);
      this.prev[i].copy(_w);
    }
  }

  update(dt: number, wind: THREE.Vector3): void {
    if (!this.ready || dt <= 0) return;
    const h = Math.min(dt, 1 / 30);
    const steps = 2;
    const sh = h / steps;
    this.anchor.updateWorldMatrix(true, false);
    const spheres = this.body();
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.pos.length; i++) {
        const p = this.pos[i];
        if (this.pinned[i]) {
          this.prev[i].copy(p);
          p.copy(this.rest[i]).applyMatrix4(this.anchor.matrixWorld);
          continue;
        }
        const q = this.prev[i];
        _d.subVectors(p, q).multiplyScalar(0.985);
        q.copy(p);
        p.add(_d);
        p.y -= 9.8 * sh * sh;
        p.addScaledVector(wind, sh * sh);
      }
      for (let it = 0; it < 3; it++) {
        for (const [a, b, len] of this.links) {
          const pa = this.pos[a];
          const pb = this.pos[b];
          _d.subVectors(pb, pa);
          const d = _d.length() || 1e-6;
          const diff = (d - len) / d;
          const wa = this.pinned[a] ? 0 : this.pinned[b] ? 1 : 0.5;
          const wb = this.pinned[b] ? 0 : this.pinned[a] ? 1 : 0.5;
          pa.addScaledVector(_d, diff * wa);
          pb.addScaledVector(_d, -diff * wb);
        }
        for (let i = 0; i < this.pos.length; i++) {
          if (this.pinned[i]) continue;
          const p = this.pos[i];
          for (const sp of spheres) {
            _d.subVectors(p, sp.c);
            const d = _d.length();
            if (d < sp.r && d > 1e-5) p.addScaledVector(_d, (sp.r - d) / d);
          }
          if (p.y < 0.03) p.y = 0.03;
        }
      }
    }
    // back into the mesh
    this.mesh.updateWorldMatrix(true, false);
    _inv.copy(this.mesh.matrixWorld).invert();
    const attr = this.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let v = 0; v < attr.count; v++) {
      _w.copy(this.pos[this.vertexToParticle[v]]).applyMatrix4(_inv);
      attr.setXYZ(v, _w.x, _w.y, _w.z);
    }
    attr.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
