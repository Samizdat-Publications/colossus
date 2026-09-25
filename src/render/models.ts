import * as THREE from 'three';
import { Rig } from '../anim/rig';
import { addCameraFade } from './fade';
import { makeGolemStoneMaterial } from './stoneMaterial';
import type { Assets, TexName } from './assets';
import { ARENA } from '../game/world';
import GOLEM_RIG from '../data/golem_rig.json';
import WARRIOR_RIG from '../data/warrior_rig.json';

const DEG = Math.PI / 180;
/** glTF UVs run top-down; three's derivative tangents assume bottom-up, so normal maps flip Y. */
const NORMAL_SCALE = (s = 1) => new THREE.Vector2(s, -s);

type Tex = Assets['tex'];

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function matName(m: THREE.Mesh): string {
  const mat = m.material as THREE.Material | THREE.Material[];
  return Array.isArray(mat) ? mat[0]?.name ?? '' : mat?.name ?? '';
}

function stoneParams(tex: Tex, kind: 'rock' | 'ashlar', color: number, roughness: number, normal = 1): THREE.MeshStandardMaterialParameters {
  return {
    map: tex[`${kind}_albedo` as TexName],
    normalMap: tex[`${kind}_normal` as TexName],
    roughnessMap: tex[`${kind}_rough` as TexName],
    normalScale: NORMAL_SCALE(normal),
    vertexColors: true,
    color,
    roughness,
    metalness: 0,
  };
}

// ------------------------------------------------------------------ golem

export interface GolemModel {
  rig: Rig;
  cores: Map<string, THREE.Mesh>;
  eyes: THREE.Mesh[];
  parts: THREE.Mesh[];
  plates: THREE.Mesh[];
}

/** OSTRAKON from golem.glb: bone-parented stone pieces on a pivot rig, glowing cores and eyes. */
export function buildGolemModel(assets: Assets): GolemModel {
  const rig = Rig.fromObject(assets.models.golem, GOLEM_RIG.bones);
  const tex = assets.tex;
  const cores = new Map<string, THREE.Mesh>();
  const eyes: THREE.Mesh[] = [];
  const parts: THREE.Mesh[] = [];
  const plates: THREE.Mesh[] = [];
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 2.2 });
  for (const m of meshes(rig.root)) {
    const name = m.name;
    m.castShadow = true;
    m.receiveShadow = true;
    if (name.startsWith('core_')) {
      const chest = name === 'core_chest';
      m.material = addCameraFade(
        new THREE.MeshStandardMaterial({
          color: chest ? 0x331100 : 0x0a2a30,
          emissive: chest ? 0xff5a14 : 0x5ff0ff,
          emissiveIntensity: 1.6,
          roughness: 0.25,
          flatShading: true,
        }),
      );
      m.castShadow = false;
      cores.set(name, m);
    } else if (name.startsWith('eye_')) {
      m.material = eyeMat;
      m.castShadow = false;
      eyes.push(m);
    } else {
      const rock = matName(m).includes('rock');
      // one material per piece (the camera fade dims whole pieces); they share one shader program
      m.material = makeGolemStoneMaterial(rock ? stoneParams(tex, 'rock', 0xb4b6bb, 1.0) : stoneParams(tex, 'ashlar', 0xc9c4ba, 1.0));
      parts.push(m);
      if (name.startsWith('chestplate')) plates.push(m);
    }
  }
  return { rig, cores, eyes, parts, plates };
}

// ------------------------------------------------------------------ warrior

export interface WarriorModel {
  rig: Rig;
  sword: THREE.Object3D;
  cape: THREE.Mesh | null;
  flask: THREE.Object3D | null;
}

export function buildWarriorModel(assets: Assets): WarriorModel {
  const rig = Rig.fromObject(assets.models.warrior, WARRIOR_RIG.bones);
  const tex = assets.tex;
  const mats: Record<string, THREE.Material> = {
    warrior_steel: new THREE.MeshStandardMaterial({
      color: 0xd2d7e0,
      metalness: 0.92,
      roughness: 1.0,
      roughnessMap: tex.metal_rough,
      normalMap: tex.metal_normal,
      normalScale: NORMAL_SCALE(0.7),
      envMapIntensity: 1.4,
    }),
    warrior_mail: new THREE.MeshStandardMaterial({ color: 0x6a6f78, metalness: 0.85, roughness: 0.5 }),
    warrior_leather: new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.78 }),
    // ivory cloth: the warrior's accent must never match a danger colour (red), fire (amber) or a core (cyan)
    warrior_cloth: new THREE.MeshStandardMaterial({
      color: 0xd9d0bb,
      roughness: 0.85,
      normalMap: tex.cloth_normal,
      normalScale: NORMAL_SCALE(0.6),
      side: THREE.DoubleSide,
      emissive: 0x1c1a14,
      emissiveIntensity: 0.6,
    }),
    warrior_brass: new THREE.MeshStandardMaterial({ color: 0xd09a45, metalness: 1.0, roughness: 0.32, envMapIntensity: 1.3 }),
    warrior_flask: new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 1.4, roughness: 0.15 }),
  };
  for (const m of meshes(rig.root)) {
    m.material = mats[matName(m)] ?? mats.warrior_steel;
    m.castShadow = true;
  }
  const sword = rig.root.getObjectByName('sword') ?? new THREE.Group();
  const cape = (rig.root.getObjectByName('cape') as THREE.Mesh | undefined) ?? null;
  const flask = rig.root.getObjectByName('flask') ?? null;
  return { rig, sword, cape, flask };
}

// ------------------------------------------------------------------ arena and props

export interface ArenaModel {
  braziers: THREE.Vector3[];
  runes: THREE.MeshStandardMaterial | null;
  water: THREE.MeshStandardMaterial | null;
  rockGeo: THREE.BufferGeometry | null;
  meteorGeo: THREE.BufferGeometry | null;
  rockMat: THREE.MeshStandardMaterial | null;
}

/** arena.glb, the colonnade (pillars.glb) and rubble (rubble.glb) placed from arena_layout.json. */
export function buildArenaModel(scene: THREE.Scene, assets: Assets): ArenaModel {
  const tex = assets.tex;
  const runes = new THREE.MeshStandardMaterial({ color: 0x1a0c04, emissive: 0xff9a4a, emissiveIntensity: 0.5, roughness: 0.6 });
  const water = new THREE.MeshStandardMaterial({ color: 0x05070b, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.2 });
  const mats: Record<string, THREE.Material> = {
    floor_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x9ea3ad, 0.7)),
    floor_water: water,
    seal_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x8e9098, 0.8)),
    seal_rune: runes,
    wall_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x8d9098, 0.95)),
    tier_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x6f727a, 1.0)),
    cliff_rock: new THREE.MeshStandardMaterial(stoneParams(tex, 'rock', 0x545760, 1.0)),
    pillar_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x9a9da6, 0.95)),
    brazier_iron: new THREE.MeshStandardMaterial({ color: 0x2c2926, metalness: 0.7, roughness: 0.55 }),
    coals: new THREE.MeshStandardMaterial({ color: 0x1a0804, emissive: 0xff5a14, emissiveIntensity: 1.6, roughness: 0.9 }),
    rubble_rock: new THREE.MeshStandardMaterial(stoneParams(tex, 'rock', 0xa3a5ab, 1.0)),
    rubble_ashlar: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x9ea1a8, 1.0)),
  };
  const dress = (root: THREE.Object3D, cast: boolean) => {
    for (const m of meshes(root)) {
      m.material = mats[matName(m)] ?? mats.wall_stone;
      m.castShadow = cast;
      m.receiveShadow = true;
    }
  };
  // the arena shell
  const arena = assets.models.arena;
  for (const child of [...arena.children]) {
    const cast = child.name === 'arcade' || child.name === 'wall_rubble';
    dress(child, cast);
    scene.add(child);
  }
  // colonnade
  const proto = (root: THREE.Object3D, name: string) => {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`asset ${name} is missing`);
    return o;
  };
  for (const p of ARENA.pillars) {
    const o = proto(assets.models.pillars, p.type).clone();
    o.position.set(p.x, 0, p.z);
    o.rotation.set(0, p.rot * DEG, 0);
    dress(o, true);
    scene.add(o);
  }
  for (const f of ARENA.fallen) {
    const o = proto(assets.models.pillars, 'pillar_fallen').clone();
    o.position.set(f.x, 0, f.z);
    o.rotation.set(0, f.yaw * DEG - Math.PI / 2, 0);
    dress(o, true);
    scene.add(o);
  }
  for (const r of ARENA.rubble) {
    const o = proto(assets.models.rubble, r.type).clone();
    o.position.set(r.x, 0, r.z);
    o.rotation.set(0, r.rot * DEG, 0);
    o.scale.set(r.r, r.r * 0.7, r.r);
    dress(o, true);
    scene.add(o);
  }
  const braziers: THREE.Vector3[] = [];
  for (const b of ARENA.braziers) {
    const o = proto(assets.models.pillars, 'brazier').clone();
    o.position.set(b.x, 0, b.z);
    dress(o, true);
    scene.add(o);
    braziers.push(new THREE.Vector3(b.x, 2.35, b.z));
  }
  const mound = proto(assets.models.rubble, 'golem_mound').clone();
  mound.position.set(ARENA.golemHome[0], 0, ARENA.golemHome[1]);
  dress(mound, true);
  scene.add(mound);
  // projectiles use the rubble boulders (unit radius)
  const rockMesh = proto(assets.models.rubble, 'rock_throw') as THREE.Mesh;
  const meteorMesh = proto(assets.models.rubble, 'meteor') as THREE.Mesh;
  const rockMat = new THREE.MeshStandardMaterial({ ...stoneParams(tex, 'rock', 0x8e8a85, 1.0), emissive: 0x802808, emissiveIntensity: 0.3 });
  return {
    braziers,
    runes,
    water,
    rockGeo: firstGeometry(rockMesh),
    meteorGeo: firstGeometry(meteorMesh),
    rockMat,
  };
}

function firstGeometry(o: THREE.Object3D): THREE.BufferGeometry | null {
  let g: THREE.BufferGeometry | null = null;
  o.traverse((c) => {
    if (!g && (c as THREE.Mesh).isMesh) g = (c as THREE.Mesh).geometry;
  });
  return g;
}

/** Brazier flames (a warm cone until the particle fire of milestone 3). */
export function addBrazierFlames(scene: THREE.Scene, spots: THREE.Vector3[]): void {
  const fireMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff7a2a, emissiveIntensity: 4 });
  for (const p of spots) {
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 8), fireMat);
    fire.position.set(p.x, p.y + 0.2, p.z);
    scene.add(fire);
  }
}
