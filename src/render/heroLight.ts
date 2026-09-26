import * as THREE from 'three';

/**
 * The warrior's own light, applied only to the warrior's materials: a soft fill from the camera side
 * and a cool rim on the silhouette. The moon sits behind the golem, so without it the warrior shows the
 * camera its unlit side and melts into the wet stone at fighting distance. Both grow with the camera
 * distance (`setHeroLight`), so close-ups keep their moonlit contrast.
 */
export const heroUniforms = {
  uHeroFill: { value: 0.2 },
  uHeroRim: { value: new THREE.Color(0.5, 0.62, 0.85) },
  /** 0..1: the warrior was just hit (the armour flashes red-hot for a moment) */
  uHeroHit: { value: 0 },
};

const RIM = new THREE.Color(0.5, 0.62, 0.85);

/** dist: camera to warrior in metres. */
export function setHeroLight(dist: number, boost = 1): void {
  const far = Math.min(1, Math.max(0, (dist - 6) / 8));
  heroUniforms.uHeroFill.value = (0.12 + 0.38 * far) * boost;
  heroUniforms.uHeroRim.value.copy(RIM).multiplyScalar((0.45 + 0.75 * far) * boost);
}

export function addHeroLight<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, heroUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHeroFill;\nuniform vec3 uHeroRim;\nuniform float uHeroHit;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  float heroNdV = saturate(dot(normal, normalize(vViewPosition)));
  totalEmissiveRadiance += diffuseColor.rgb * uHeroFill * (0.3 + 0.7 * heroNdV);
  totalEmissiveRadiance += uHeroRim * pow(1.0 - heroNdV, 3.0);
  totalEmissiveRadiance += vec3(2.2, 0.5, 0.26) * uHeroHit * (0.18 + 1.7 * pow(1.0 - heroNdV, 2.0));
}`,
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|hero`;
  return mat;
}
