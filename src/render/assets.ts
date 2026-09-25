import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/** Baked textures from blender_scripts/textures.py (all tile seamlessly; UVs are in tile units). */
const TEX_FILES = {
  rock_albedo: 'tex_rock_albedo.jpg',
  rock_normal: 'tex_rock_normal.png',
  rock_rough: 'tex_rock_rough.jpg',
  ashlar_albedo: 'tex_ashlar_albedo.jpg',
  ashlar_normal: 'tex_ashlar_normal.png',
  ashlar_rough: 'tex_ashlar_rough.jpg',
  crack: 'tex_crack.png',
  metal_normal: 'tex_metal_normal.png',
  metal_rough: 'tex_metal_rough.jpg',
  cloth_normal: 'tex_cloth_normal.png',
} as const;
export type TexName = keyof typeof TEX_FILES;
const COLOR_TEX = new Set<TexName>(['rock_albedo', 'ashlar_albedo']);
const MODELS = ['golem', 'warrior', 'arena', 'pillars', 'rubble'] as const;
export type ModelName = (typeof MODELS)[number];

export interface Assets {
  models: Record<ModelName, THREE.Group>;
  tex: Record<TexName, THREE.Texture>;
}

/**
 * Loads every Blender-made model (Draco-compressed GLB) and baked texture from public/assets.
 * Returns null (and the game falls back to its greybox primitives) if anything is missing.
 */
export async function loadAssets(onProgress?: (fraction: number) => void): Promise<Assets | null> {
  const base = `${import.meta.env.BASE_URL}assets/`;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const gltf = new GLTFLoader();
  gltf.setDRACOLoader(draco);
  const texLoader = new THREE.TextureLoader();
  const total = MODELS.length + Object.keys(TEX_FILES).length;
  let done = 0;
  const tick = () => onProgress?.(++done / total);
  try {
    const scenes = await Promise.all(
      MODELS.map((n) =>
        gltf.loadAsync(`${base}${n}.glb`).then((g) => {
          tick();
          return g.scene;
        }),
      ),
    );
    const tex = {} as Record<TexName, THREE.Texture>;
    await Promise.all(
      (Object.keys(TEX_FILES) as TexName[]).map(async (k) => {
        const t = await texLoader.loadAsync(`${base}${TEX_FILES[k]}`);
        t.flipY = false; // glTF UV convention
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        t.colorSpace = COLOR_TEX.has(k) ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex[k] = t;
        tick();
      }),
    );
    draco.dispose();
    const models = {} as Record<ModelName, THREE.Group>;
    MODELS.forEach((n, i) => (models[n] = scenes[i]));
    return { models, tex };
  } catch (e) {
    draco.dispose();
    console.warn('[assets] could not load the Blender assets, using greybox primitives:', e);
    return null;
  }
}
