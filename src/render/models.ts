import * as THREE from 'three';
import { Rig } from '../anim/rig';
import { addCameraFade, propFadeUniforms } from './fade';
import { makeGolemStoneMaterial } from './stoneMaterial';
import { addHeroLight } from './heroLight';
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
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 4.5 });
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
      if (chest) moltenHeart(m.material as THREE.MeshStandardMaterial);
      if (chest) {
        // the molten heart's glow spills out of the burst chest
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0xff8a30, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
        glow.name = 'core_halo';
        glow.scale.setScalar(3.4);
        m.add(glow);
      }
      if (!chest) {
        m.scale.setScalar(1.65);
        // a soft cyan halo so an open core reads as "the glowing thing" even from across the arena
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: 0x5ff0ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
        halo.name = 'core_halo';
        halo.scale.setScalar(1.9);
        if (name === 'core_back') {
          // the back core is the payoff of the whole loop: its glow shows through the golem and the warrior
          halo.material.depthTest = false;
          halo.renderOrder = 8;
          halo.scale.setScalar(2.4);
        }
        m.add(halo);
      }
      cores.set(name, m);
    } else if (name.startsWith('eye_')) {
      m.material = eyeMat;
      m.castShadow = false;
      m.scale.set(1.5, 1.4, 1.2); // eyes that read from the far end of the arena
      eyes.push(m);
    } else {
      const rock = matName(m).includes('rock');
      // one material per piece (the camera fade dims whole pieces); they share one shader program
      m.material = makeGolemStoneMaterial({ ...(rock ? stoneParams(tex, 'rock', 0xd6d8dd, 1.0) : stoneParams(tex, 'ashlar', 0xc9c4ba, 1.0)), envMapIntensity: 0.3 });
      parts.push(m);
      if (name.startsWith('chestplate')) plates.push(m);
    }
  }
  return { rig, cores, eyes, parts, plates };
}

/** Time for the molten heart's churn (set by the game each frame). */
export const heartUniforms = { uHeartTime: { value: 0 } };

/** The phase 3 heart churns: bright molten veins and darker crusts drifting over it. */
function moltenHeart(mat: THREE.MeshStandardMaterial): void {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, heartUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHeartTime;
float hh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float hn(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1, 0, 0)), u.x), mix(hh(i + vec3(0, 1, 0)), hh(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hh(i + vec3(0, 0, 1)), hh(i + vec3(1, 0, 1)), u.x), mix(hh(i + vec3(0, 1, 1)), hh(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 q = vFadeWorld * 1.6 + vec3(0.0, -uHeartTime * 0.6, uHeartTime * 0.25);
  float n = hn(q) * 0.6 + hn(q * 2.3 + 5.0) * 0.4;
  float vein = smoothstep(0.45, 0.8, n);
  totalEmissiveRadiance *= 0.35 + 1.25 * vein;
  totalEmissiveRadiance += vec3(1.0, 0.85, 0.5) * pow(vein, 4.0) * 1.5 * length(emissive);
}`,
      );
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|molten`;
}

let haloTex: THREE.Texture | null = null;
/** A soft round glow (canvas radial gradient), shared by the core halos. */
function haloTexture(): THREE.Texture {
  if (haloTex) return haloTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(cv);
  return haloTex;
}

// ------------------------------------------------------------------ warrior

export interface WarriorModel {
  rig: Rig;
  sword: THREE.Object3D;
  /** the blade's own material: it glows while a heavy attack charges */
  swordMat: THREE.MeshStandardMaterial;
  cape: THREE.Mesh | null;
  flask: THREE.Object3D | null;
}

export function buildWarriorModel(assets: Assets): WarriorModel {
  const rig = Rig.fromObject(assets.models.warrior, WARRIOR_RIG.bones);
  const tex = assets.tex;
  const mats: Record<string, THREE.Material> = {
    warrior_steel: new THREE.MeshStandardMaterial({
      color: 0x8c95a3,
      metalness: 0.92,
      roughness: 1.35,
      roughnessMap: tex.metal_rough,
      normalMap: tex.metal_normal,
      normalScale: NORMAL_SCALE(0.7),
      envMapIntensity: 1.1,
    }),
    warrior_mail: new THREE.MeshStandardMaterial({ color: 0x6a6f78, metalness: 0.85, roughness: 0.5 }),
    warrior_leather: new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.78 }),
    // weathered bone cloth: the warrior's accent never matches a danger colour (red), fire (amber) or a core
    // (cyan), and it is warm against the cold stone without being the brightest thing on screen
    warrior_cloth: new THREE.MeshStandardMaterial({
      color: 0xa89a7e,
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
  for (const k of Object.keys(mats)) addHeroLight(mats[k]);
  for (const m of meshes(rig.root)) {
    m.material = mats[matName(m)] ?? mats.warrior_steel;
    m.castShadow = true;
  }
  const sword = rig.root.getObjectByName('sword') ?? new THREE.Group();
  const swordMat = (mats.warrior_steel as THREE.MeshStandardMaterial).clone();
  swordMat.onBeforeCompile = mats.warrior_steel.onBeforeCompile;
  swordMat.customProgramCacheKey = mats.warrior_steel.customProgramCacheKey;
  swordMat.emissive.setHex(0xffc27a);
  swordMat.emissiveIntensity = 0;
  sword.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = swordMat;
  });
  const cape = (rig.root.getObjectByName('cape') as THREE.Mesh | undefined) ?? null;
  if (cape) cape.material = pleated(mats.warrior_cloth as THREE.MeshStandardMaterial);
  const flask = rig.root.getObjectByName('flask') ?? null;
  return { rig, sword, swordMat, cape, flask };
}

/** Rough, dull bevels on floor stones: any face tilted away from straight up gets a matte finish. */
function matteBevels(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFloorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFloorWorld;
float pHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float pNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
vec3 floorUpV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
float floorLevel = smoothstep(0.9, 0.985, dot(normalize(vNormal), floorUpV));
// standing water: shallow puddles on the flat tops, mirror-smooth and darker
float puddle = floorLevel * smoothstep(0.58, 0.68, pNoise(vFloorWorld.xz * 0.16) * 0.7 + pNoise(vFloorWorld.xz * 0.5 + 7.0) * 0.3);
roughnessFactor = mix(0.97, roughnessFactor, floorLevel);
roughnessFactor = mix(roughnessFactor, 0.13, puddle);
diffuseColor.rgb *= 1.0 - 0.45 * puddle;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize(mix(normal, floorUpV, puddle * 0.85));`,
      );
  };
  m.customProgramCacheKey = () => 'floor-matte-bevels';
  return m;
}

/** A copy of the cloth material with vertical pleats: the normal swings left and right across the width. */
function pleated(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const m = base.clone();
  const prev = base.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
{
  float pleat = sin(vNormalMapUv.x * 6.2831853 * 4.5);
  normal = normalize(normal + tbn[0] * pleat * 0.3);
}
#endif`,
    ).replace(
      '#include <color_fragment>',
      `#include <color_fragment>
#ifdef USE_NORMALMAP_TANGENTSPACE
{
  // the cape's v runs from 1 at the shoulders to -2 at the hem, u from 0 to 2 across: a dark hem band and
  // side borders, dirt toward the bottom, and a faded circular emblem between the shoulders
  float v = vNormalMapUv.y;
  float u = vNormalMapUv.x;
  diffuseColor.rgb *= mix(1.0, 0.72, smoothstep(0.3, -1.9, v));
  diffuseColor.rgb *= 1.0 - 0.45 * smoothstep(-1.66, -1.76, v);
  float side = min(u, 2.0 - u);
  diffuseColor.rgb *= 1.0 - 0.4 * (1.0 - smoothstep(0.05, 0.11, side));
  vec2 e = vec2((u - 1.0) * 1.2, (v - 0.05) * 0.9);
  float ring = abs(length(e) - 0.32);
  float emblem = (1.0 - smoothstep(0.035, 0.06, ring)) + (1.0 - smoothstep(0.03, 0.05, abs(e.x))) * step(length(e), 0.3);
  diffuseColor.rgb *= 1.0 - 0.3 * clamp(emblem, 0.0, 1.0);
}
#endif`,
    );
  };
  m.customProgramCacheKey = () => `${base.customProgramCacheKey()}|pleats`;
  return m;
}

// ------------------------------------------------------------------ arena and props

export interface ArenaModel {
  braziers: THREE.Vector3[];
  runes: THREE.MeshStandardMaterial | null;
  water: THREE.MeshStandardMaterial | null;
  rockGeo: THREE.BufferGeometry | null;
  meteorGeo: THREE.BufferGeometry | null;
  rockMat: THREE.Material | null;
  debrisGeo: THREE.BufferGeometry | null;
  debrisMat: THREE.MeshStandardMaterial | null;
  cliffs: THREE.MeshStandardMaterial;
}

/** arena.glb, the colonnade (pillars.glb) and rubble (rubble.glb) placed from arena_layout.json. */
export function buildArenaModel(scene: THREE.Scene, assets: Assets): ArenaModel {
  const tex = assets.tex;
  const runes = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x9fb4d8, emissiveIntensity: 0.3, roughness: 0.6 });
  const water = makeWater();
  const mats: Record<string, THREE.Material> = {
    floor_stone: matteBevels(new THREE.MeshStandardMaterial({ ...stoneParams(tex, 'ashlar', 0x959aa4, 0.6), envMapIntensity: 0.85 })),
    floor_water: water,
    seal_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x8e9098, 0.8)),
    seal_rune: runes,
    wall_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x8d9098, 0.95)),
    tier_stone: new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x6f727a, 1.0)),
    cliff_rock: new THREE.MeshStandardMaterial(stoneParams(tex, 'rock', 0x545760, 1.0)),
    // a column between the lens and the fight dithers away (the meteor rain had one filling a side of the frame)
    pillar_stone: addCameraFade(new THREE.MeshStandardMaterial(stoneParams(tex, 'ashlar', 0x9a9da6, 0.95)), propFadeUniforms),
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
  // the drowned outer ring: shallow standing water from just inside the colonnade to the walls
  const floodGeo = new THREE.RingGeometry(27.5, 44, 128, 1);
  floodGeo.rotateX(-Math.PI / 2);
  const flood = new THREE.Mesh(floodGeo, makeWater([27.5, 31.5]));
  flood.name = 'flood';
  flood.position.y = 0.05;
  flood.renderOrder = 1;
  flood.receiveShadow = true;
  scene.add(flood);

  const mound = proto(assets.models.rubble, 'golem_mound').clone();
  mound.position.set(ARENA.golemHome[0], 0, ARENA.golemHome[1]);
  dress(mound, true);
  scene.add(mound);
  // projectiles use the rubble boulders (unit radius)
  const rockMesh = proto(assets.models.rubble, 'rock_throw') as THREE.Mesh;
  const meteorMesh = proto(assets.models.rubble, 'meteor') as THREE.Mesh;
  // pieces of the golem: its moonlit rim (so a boulder against the sky still reads as a rock) and its veins
  const rockMat = makeGolemStoneMaterial({ ...stoneParams(tex, 'rock', 0xa39f98, 1.0) });
  return {
    braziers,
    runes,
    water,
    rockGeo: firstGeometry(rockMesh),
    meteorGeo: firstGeometry(meteorMesh),
    rockMat,
    debrisGeo: firstGeometry(proto(assets.models.rubble, 'debris_0')),
    debrisMat: new THREE.MeshStandardMaterial(stoneParams(tex, 'rock', 0x9a9ca2, 1.0)),
    cliffs: mats.cliff_rock as THREE.MeshStandardMaterial,
  };
}

/** Uniforms the game animates: time (ripples) and rain (how hard it falls). */
export const waterUniforms = { uWaterTime: { value: 0 }, uRain: { value: 1 } };

/**
 * Dark water with a real sheen and raindrop ripples (normals perturbed in the shader). With `shore`, the
 * water fades in between two radii (the flooded outer ring of the arena).
 */
function makeWater(shore?: [number, number]): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a2431, roughness: 0.2, metalness: 0.0, envMapIntensity: 1.5, transparent: !!shore, depthWrite: !shore });
  m.onBeforeCompile = (shader) => {
    if (shore) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `diffuseColor.a = smoothstep(${shore[0].toFixed(1)}, ${shore[1].toFixed(1)}, length(vWaterWorld.xz)) * 0.9;
#include <opaque_fragment>`,
      );
    }
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWaterWorld;
uniform float uWaterTime;
uniform float uRain;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// expanding rings from raindrops on a jittered grid
vec2 ripples(vec2 p, float t) {
  vec2 g = floor(p);
  vec2 acc = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = g + vec2(float(i), float(j));
    float h = wHash(c);
    vec2 o = c + vec2(wHash(c + 1.7), wHash(c + 3.1));
    float life = fract(t * 0.9 + h);
    vec2 d = p - o;
    float r = length(d);
    float ring = sin((r - life * 0.9) * 42.0) * smoothstep(0.0, 0.08, 0.9 * life + 0.06 - r) * (1.0 - life) * (1.0 - life);
    acc += ring * d / max(r, 1e-3);
  }
  return acc;
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 rp = ripples(vWaterWorld.xz * 2.2, uWaterTime) * 0.18 * uRain + ripples(vWaterWorld.xz * 3.7 + 11.0, uWaterTime * 1.3) * 0.12 * uRain;
  vec3 nW = normalize(vec3(-rp.x, 1.0, -rp.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`,
      );
  };
  m.customProgramCacheKey = () => (shore ? 'arena-flood' : 'arena-water');
  return m;
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
