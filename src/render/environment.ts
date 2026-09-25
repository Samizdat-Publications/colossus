import * as THREE from 'three';

/**
 * A small night-sky environment for image-based lighting: a dark gradient dome with a bright moon, so
 * polished steel, wet flagstones and the water have something to reflect. Built once with PMREM.
 */
export function makeEnvironment(renderer: THREE.WebGLRenderer, moonDir: THREE.Vector3): THREE.Texture {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uMoon: { value: moonDir.clone().normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoon;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float up = d.y;
        vec3 zenith = vec3(0.03, 0.045, 0.08);
        vec3 horizon = vec3(0.1, 0.13, 0.19);
        vec3 ground = vec3(0.018, 0.018, 0.022);
        vec3 c = up > 0.0 ? mix(horizon, zenith, pow(up, 0.6)) : mix(horizon * 0.5, ground, clamp(-up * 3.0, 0.0, 1.0));
        float m = max(dot(d, uMoon), 0.0);
        c += vec3(0.75, 0.82, 1.0) * (pow(m, 900.0) * 30.0 + pow(m, 40.0) * 0.5 + pow(m, 6.0) * 0.08);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}
