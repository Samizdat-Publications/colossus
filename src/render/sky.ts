import * as THREE from 'three';

/** Night-storm sky dome: horizon glow, a veiled moon, slow clouds, lightning flashes, lava tint. */
export const skyUniforms = {
  uTime: { value: 0 },
  uMoonDir: { value: new THREE.Vector3(-0.25, 0.55, -0.8).normalize() },
  uZenith: { value: new THREE.Color(0x070a12) },
  uHorizon: { value: new THREE.Color(0x2c3a50) },
  uFlash: { value: 0 },
  uLava: { value: 0 },
};

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uFlash;
uniform float uLava;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h * 1.6, 0.0, 1.0), 0.6));
  // clouds projected on a dome
  vec2 cp = d.xz / max(0.12, d.y + 0.25) * 1.3 + vec2(uTime * 0.012, uTime * 0.004);
  float c = fbm(cp);
  float cloud = smoothstep(0.42, 0.78, c);
  float moon = max(dot(d, uMoonDir), 0.0);
  vec3 moonGlow = vec3(0.55, 0.65, 0.85) * (pow(moon, 60.0) * 1.2 + pow(moon, 6.0) * 0.18);
  // clouds are lit from behind by the moon, darker elsewhere
  vec3 cloudCol = mix(vec3(0.085, 0.1, 0.135), vec3(0.28, 0.34, 0.46), pow(moon, 3.0) * 0.8 + 0.12);
  col = mix(col + moonGlow, cloudCol, cloud * 0.7 * smoothstep(-0.05, 0.25, d.y));
  // lightning lights the cloud deck
  col += vec3(0.55, 0.62, 0.8) * uFlash * (0.35 + cloud * 0.9) * smoothstep(-0.1, 0.3, d.y);
  // phase 3: a darker sky with a molten glow low on the horizon (the ridges stand black against it)
  col *= 1.0 - 0.4 * uLava;
  col += vec3(0.5, 0.12, 0.025) * uLava * (1.0 - smoothstep(-0.03, 0.28, d.y)) * (0.45 + cloud);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(500, 48, 24),
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
