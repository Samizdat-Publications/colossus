import * as THREE from 'three';

/**
 * Screen-door fade for big occluders (the golem): fragments very close to the camera, or inside
 * the line of sight between the camera and the player, are dithered away so the player never
 * disappears behind a wall of rock.
 */
export const fadeUniforms = {
  uFadeCam: { value: new THREE.Vector3() },
  uFadeFocus: { value: new THREE.Vector3() },
  uFadeOn: { value: 1 },
};

export function setFade(camera: THREE.Vector3, focus: THREE.Vector3, on = true): void {
  fadeUniforms.uFadeCam.value.copy(camera);
  fadeUniforms.uFadeFocus.value.copy(focus);
  fadeUniforms.uFadeOn.value = on ? 1 : 0;
}

const FADE_VERT_HEAD = /* glsl */ `
varying vec3 vFadeWorld;
`;
const FADE_VERT_BODY = /* glsl */ `
vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const FADE_FRAG_HEAD = /* glsl */ `
varying vec3 vFadeWorld;
uniform vec3 uFadeCam;
uniform vec3 uFadeFocus;
uniform float uFadeOn;
float fadeBayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}
`;
const FADE_FRAG_BODY = /* glsl */ `
if (uFadeOn > 0.5) {
  float dCam = distance(vFadeWorld, uFadeCam);
  float keep = smoothstep(1.2, 3.6, dCam);
  // line of sight from the camera to the player's chest
  vec3 seg = uFadeFocus - uFadeCam;
  float segLen = length(seg);
  vec3 dir = seg / max(segLen, 1e-3);
  float along = dot(vFadeWorld - uFadeCam, dir);
  if (along > 0.0 && along < segLen - 0.6) {
    float lateral = length((vFadeWorld - uFadeCam) - dir * along);
    keep = min(keep, mix(0.18, 1.0, smoothstep(1.0, 2.4, lateral)));
  }
  if (keep < 0.999 && fadeBayer4(gl_FragCoord.xy) > keep) discard;
}
`;

/** A second set for the arena's pillars (the golem uses whole-part fading instead). */
export const propFadeUniforms = {
  uFadeCam: { value: new THREE.Vector3() },
  uFadeFocus: { value: new THREE.Vector3() },
  uFadeOn: { value: 0 },
};

/** Patch a built-in material (Standard/Physical/Basic) with the camera fade. */
export function addCameraFade<T extends THREE.Material>(mat: T, uniforms: typeof fadeUniforms = fadeUniforms): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FADE_VERT_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${FADE_VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FADE_FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FADE_FRAG_BODY}`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${key ? key() : ''}|camfade`;
  return mat;
}
