import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Rig } from '../anim/rig';
import { makeGolemStoneMaterial } from './stoneMaterial';

/**
 * Draw-call saver: the golem's 120 loose pieces merged into one mesh per bone and stone kind (about 30
 * meshes). The loose pieces are still needed while the golem assembles itself or crumbles, so both sets
 * exist and `use(merged)` switches between them. Chest plates stay loose (they burst off in phase 3).
 */
export class GolemMerge {
  readonly meshes: THREE.Mesh[] = [];
  private merged = false;

  constructor(
    rig: Rig,
    private readonly loose: THREE.Mesh[],
    keepLoose: Set<THREE.Mesh>,
  ) {
    for (const m of keepLoose) m.userData.keepLoose = true;
    for (let bi = 0; bi < rig.count; bi++) {
      const pivot = rig.bones[bi];
      const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const params = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      for (const child of pivot.children) {
        const m = child as THREE.Mesh;
        if (!m.isMesh || keepLoose.has(m) || !loose.includes(m)) continue;
        const mat = m.material as THREE.MeshStandardMaterial;
        // group by texture set (rock or dressed stone), not by the per-piece material instance
        const key = [...params.keys()].find((k) => (k as THREE.MeshStandardMaterial).map === mat.map) ?? mat;
        if (!params.has(key)) params.set(key, mat);
        m.updateMatrix();
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrix);
        const list = groups.get(key) ?? [];
        list.push(g);
        groups.set(key, list);
      }
      for (const [key, geos] of groups) {
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        const src = params.get(key)!;
        const mat = makeGolemStoneMaterial({
          map: src.map,
          normalMap: src.normalMap,
          roughnessMap: src.roughnessMap,
          normalScale: src.normalScale.clone(),
          vertexColors: true,
          color: src.color.clone(),
          roughness: src.roughness,
          metalness: 0,
          envMapIntensity: src.envMapIntensity,
        });
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `merged_${rig.names[bi]}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = false;
        pivot.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }

  get active(): boolean {
    return this.merged;
  }

  use(merged: boolean): void {
    if (merged === this.merged) return;
    this.merged = merged;
    for (const m of this.meshes) m.visible = merged;
    for (const m of this.loose) {
      if (this.meshes.length && m.parent && !m.userData.keepLoose) m.visible = !merged;
    }
  }
}
