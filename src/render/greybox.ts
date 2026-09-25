import * as THREE from 'three';
import type { Rig } from '../anim/rig';
import { addCameraFade } from './fade';
import { makeGolemStoneMaterial } from './stoneMaterial';
import GOLEM_RIG from '../data/golem_rig.json';
import WARRIOR_RIG from '../data/warrior_rig.json';

const _up = new THREE.Vector3(0, 1, 0);

/** Primitive stand-ins for the golem: a stone block per bone, glowing core spheres, eyes. */
export function buildGreyboxGolem(rig: Rig): { cores: Map<string, THREE.Mesh>; eyes: THREE.Mesh[]; parts: THREE.Mesh[] } {
  const parts: THREE.Mesh[] = [];
  for (let i = 0; i < rig.count; i++) {
    const name = rig.names[i];
    const tail = rig.tailLocal[i];
    const len = tail.length();
    const r = rig.radius[i];
    let geo: THREE.BufferGeometry;
    if (name === 'head') geo = new THREE.DodecahedronGeometry(r * 1.05, 0);
    else if (name.startsWith('hand')) geo = new THREE.BoxGeometry(r * 1.9, len + r * 0.6, r * 1.7);
    else if (name.startsWith('foot')) geo = new THREE.BoxGeometry(r * 1.9, r * 1.2, len + r * 0.6);
    else geo = new THREE.BoxGeometry(r * 1.8, len + r * 0.4, r * 1.6);
    const mesh = new THREE.Mesh(
      geo,
      makeGolemStoneMaterial(i % 2 ? { color: 0x9a9ea6, roughness: 0.82, flatShading: true } : { color: 0x80848c, roughness: 0.88, flatShading: true }),
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(tail).multiplyScalar(0.5);
    if (name.startsWith('foot')) {
      // feet: box along the foot direction but kept flat
      mesh.position.set(tail.x * 0.5, -rig.restWorld[i].y * 0.5 + r * 0.1, tail.z * 0.5);
    } else if (len > 1e-4) {
      mesh.quaternion.setFromUnitVectors(_up, tail.clone().normalize());
    }
    rig.bones[i].add(mesh);
    parts.push(mesh);
  }
  const cores = new Map<string, THREE.Mesh>();
  for (const c of GOLEM_RIG.cores) {
    const isChest = c.kind === 'chest';
    const mat = addCameraFade(
      new THREE.MeshStandardMaterial({
        color: isChest ? 0x331100 : 0x0a2a30,
        emissive: isChest ? 0xff5a14 : 0x5ff0ff,
        emissiveIntensity: 1.6,
        roughness: 0.3,
      }),
    );
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(c.radius * 0.62, 1), mat);
    const bi = rig.i(c.bone);
    m.position.fromArray(c.pos).sub(rig.restWorld[bi]);
    m.name = c.name;
    rig.bones[bi].add(m);
    cores.set(c.name, m);
  }
  const eyes: THREE.Mesh[] = [];
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 2.2 });
  const hi = rig.i(GOLEM_RIG.eyes.bone);
  for (const p of [GOLEM_RIG.eyes.left, GOLEM_RIG.eyes.right]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.2), eyeMat);
    e.position.fromArray(p).sub(rig.restWorld[hi]);
    rig.bones[hi].add(e);
    eyes.push(e);
  }
  return { cores, eyes, parts };
}

/** Primitive stand-ins for the warrior: capsule limbs, box torso, sword on the right hand. */
export function buildGreyboxWarrior(rig: Rig): { sword: THREE.Object3D; parts: THREE.Mesh[] } {
  const armor = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 0.4, metalness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x7a1c1f, roughness: 0.8 });
  const parts: THREE.Mesh[] = [];
  for (let i = 0; i < rig.count; i++) {
    const name = rig.names[i];
    const tail = rig.tailLocal[i];
    const len = tail.length();
    const r = rig.radius[i];
    let geo: THREE.BufferGeometry;
    if (name === 'chest') geo = new THREE.BoxGeometry(0.42, len + 0.08, 0.26);
    else if (name === 'hips') geo = new THREE.BoxGeometry(0.34, len + 0.12, 0.24);
    else if (name === 'spine') geo = new THREE.BoxGeometry(0.3, len + 0.02, 0.22);
    else if (name === 'head') geo = new THREE.BoxGeometry(0.22, 0.26, 0.24);
    else geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 3, 8);
    const mesh = new THREE.Mesh(geo, name === 'hips' || name === 'spine' ? cloth : armor);
    mesh.castShadow = true;
    mesh.position.copy(tail).multiplyScalar(0.5);
    if (len > 1e-4 && name !== 'head') mesh.quaternion.setFromUnitVectors(_up, tail.clone().normalize());
    if (name === 'head') mesh.position.set(0, 0.12, 0.01);
    rig.bones[i].add(mesh);
    parts.push(mesh);
  }
  // sword: grip at the hand, blade along +Z
  const s = WARRIOR_RIG.sword;
  const bi = rig.i(s.bone);
  const sword = new THREE.Group();
  sword.name = 'sword';
  sword.position.fromArray(s.grip).sub(rig.restWorld[bi]);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.25, metalness: 0.9 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, s.length), steel);
  blade.position.z = 0.08 + s.length / 2;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.03), steel);
  guard.position.z = 0.07;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), cloth);
  grip.rotation.x = Math.PI / 2;
  grip.position.z = -0.04;
  sword.add(blade, guard, grip);
  for (const m of [blade, guard, grip]) m.castShadow = true;
  rig.bones[bi].add(sword);
  return { sword, parts };
}
