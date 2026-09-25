import * as THREE from 'three';
import { fadeUniforms } from './fade';

/**
 * Shared uniforms for the golem's look. Phase changes animate these:
 *   uCrack  0 = sealed stone, 1 = glowing veins, 1.5+ = molten
 *   uHeat   0..1 reddens and brightens the veins, adds a faint inner glow (phase 3)
 *   uRim    cool moonlit rim so the silhouette reads against the night
 */
export const golemLook = {
  uCrack: { value: 0 },
  uCrackColor: { value: new THREE.Color(0xff6a1c) },
  uHeat: { value: 0 },
  uRimColor: { value: new THREE.Color(0x9ab8ff) },
  uRim: { value: 0.55 },
  uTime: { value: 0 },
  uCrackMap: { value: null as THREE.Texture | null },
  uCrackScale: { value: 0.2 },
};

/** Tileable vein network (Voronoi cell edges on a torus) used until the Blender-baked mask exists. */
export function makeVeinTexture(size = 256, cells = 10, seed = 5): THREE.DataTexture {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const pts: [number, number][] = [];
  for (let i = 0; i < cells; i++) pts.push([rnd(), rnd()]);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let f1 = 9;
      let f2 = 9;
      for (const [px, py] of pts) {
        let dx = Math.abs(u - px);
        let dy = Math.abs(v - py);
        if (dx > 0.5) dx = 1 - dx;
        if (dy > 0.5) dy = 1 - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
      const edge = f2 - f1;
      const w = Math.max(0, 1 - edge / 0.022);
      const glow = Math.max(0, 1 - edge / 0.07) * 0.3;
      const val = Math.min(1, w * w + glow);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(val * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const VERT_HEAD = /* glsl */ `
varying vec3 vStonePos;
varying vec3 vStoneNrm;
varying vec3 vFadeWorld;
`;
const VERT_BODY = /* glsl */ `
vStonePos = position;
vStoneNrm = normal;
vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const FRAG_HEAD = /* glsl */ `
varying vec3 vStonePos;
varying vec3 vStoneNrm;
varying vec3 vFadeWorld;
uniform float uCrack;
uniform vec3 uCrackColor;
uniform float uHeat;
uniform vec3 uRimColor;
uniform float uRim;
uniform float uTime;
uniform sampler2D uCrackMap;
uniform float uCrackScale;
uniform vec3 uStoneSeed;
uniform vec3 uFadeCam;
uniform vec3 uFadeFocus;
uniform float uFadeOn;
float stoneBayer(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}
float stoneHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float stoneNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = stoneHash(i), n100 = stoneHash(i + vec3(1, 0, 0)), n010 = stoneHash(i + vec3(0, 1, 0)), n110 = stoneHash(i + vec3(1, 1, 0));
  float n001 = stoneHash(i + vec3(0, 0, 1)), n101 = stoneHash(i + vec3(1, 0, 1)), n011 = stoneHash(i + vec3(0, 1, 1)), n111 = stoneHash(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float veins(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-4);
  vec3 q = p * uCrackScale + uStoneSeed;
  float a = texture2D(uCrackMap, q.yz).r;
  float b = texture2D(uCrackMap, q.xz + 0.37).r;
  float c = texture2D(uCrackMap, q.xy + 0.71).r;
  return a * w.x + b * w.y + c * w.z;
}
`;
const FRAG_FADE = /* glsl */ `
if (uFadeOn > 0.5) {
  float dCam = distance(vFadeWorld, uFadeCam);
  float keep = smoothstep(0.8, 2.8, dCam);
  vec3 seg = uFadeFocus - uFadeCam;
  float segLen = length(seg);
  vec3 dir = seg / max(segLen, 1e-3);
  float along = dot(vFadeWorld - uFadeCam, dir);
  if (along > 0.0 && along < segLen - 0.6) {
    float lateral = length((vFadeWorld - uFadeCam) - dir * along);
    keep = min(keep, mix(0.2, 1.0, smoothstep(0.9, 2.2, lateral)));
  }
  if (keep < 0.999 && stoneBayer(gl_FragCoord.xy) > keep) discard;
}
`;
const FRAG_EMISSIVE = /* glsl */ `
{
  // glowing veins (phase 2/3) - brighter where the vein texture is strongest, slow pulse
  float v = veins(vStonePos, normalize(vStoneNrm));
  float pulse = 0.78 + 0.22 * sin(uTime * 2.3 + vStonePos.y * 0.9 + vStonePos.x * 0.6);
  // patchy coverage: phase 2 splits some stones, phase 3 most of them
  float stonePatch = stoneNoise((vStonePos + uStoneSeed * 3.0) * 0.22 + 3.1);
  float cover = smoothstep(0.78 - 0.34 * uCrack, 0.9 - 0.3 * uCrack, stonePatch);
  float vein = smoothstep(0.4, 0.95, v) * cover * clamp(uCrack, 0.0, 2.0) * pulse;
  vec3 veinCol = mix(uCrackColor, vec3(1.0, 0.72, 0.35), uHeat * 0.5);
  totalEmissiveRadiance += veinCol * vein * (1.25 + uHeat * 0.35);
  // moonlit rim
  vec3 nView = normalize(normal);
  float facing = clamp(dot(nView, normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += uRimColor * pow(1.0 - facing, 3.0) * uRim;
}
`;

/** MeshStandardMaterial with golem veins, rim light and the camera fade. */
export function makeGolemStoneMaterial(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial(params);
  const seed = { value: new THREE.Vector3(Math.random() * 7, Math.random() * 7, Math.random() * 7) };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, golemLook, fadeUniforms);
    shader.uniforms.uStoneSeed = seed;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_FADE}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  mat.customProgramCacheKey = () => 'golem-stone';
  return mat;
}
