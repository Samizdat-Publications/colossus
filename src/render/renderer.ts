import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Replaces NaN/Inf pixels before bloom: one bad pixel would otherwise blur into a black screen. */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // Comparisons are false for NaN, so this catches NaN and Inf where the compiler honours them;
      // on D3D, max() returns the non-NaN operand, which covers compilers that fold the test away.
      bool ok = c.r <= 1e30 && c.r >= -1e30 && c.g <= 1e30 && c.g >= -1e30 && c.b <= 1e30 && c.b >= -1e30;
      c = min(max(c, vec4(0.0)), vec4(48.0));
      gl_FragColor = ok ? vec4(c.rgb, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
    }`,
};

/** WebGL renderer + HDR composer (MSAA, bloom, tone mapping). */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  private readonly renderPass: RenderPass;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);

  constructor(
    readonly container: HTMLElement,
    readonly scene: THREE.Scene,
    public camera: THREE.PerspectiveCamera,
  ) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.pixelRatio);
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.9; // night
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';
    this.renderer = r;

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new ShaderPass(SanitizeShader));
    // threshold above 1: only real glow (cores, fire, eyes) blooms, not every specular glint on the armour
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.35, 1.05);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    this.renderPass.camera = this.camera;
    this.composer.render(dt);
  }

  /** Render scale for the quality governor (1.5 at best, 0.7 at worst). */
  setPixelRatio(r: number): void {
    const want = Math.min(window.devicePixelRatio || 1, r);
    if (Math.abs(want - this.pixelRatio) < 0.01) return;
    this.pixelRatio = want;
    this.resize();
  }
}

/**
 * Keeps the frame rate up on slower machines: after a sustained slow stretch it steps the quality down
 * (render scale, then shadow resolution); after a long fast stretch it steps back up. Hysteresis keeps it
 * from flip-flopping. ?quality=low|medium|high pins a level.
 */
export class QualityGovernor {
  level = 3;
  private slow = 0;
  private fast = 0;
  private pinned = false;

  constructor(
    private readonly apply: (level: number) => void,
    pin: string | null,
  ) {
    if (pin === 'low' || pin === 'medium' || pin === 'high') {
      this.level = pin === 'low' ? 0 : pin === 'medium' ? 2 : 3;
      this.pinned = true;
    }
    this.apply(this.level);
  }

  /** frameMs: smoothed frame time; active: only judge while the fight or the title is running. */
  update(dt: number, frameMs: number, active: boolean): void {
    if (this.pinned || !active) return;
    if (frameMs > 19.5) {
      this.slow += dt;
      this.fast = 0;
    } else if (frameMs < 13.5) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = Math.max(0, this.slow - dt);
      this.fast = Math.max(0, this.fast - dt);
    }
    if (this.slow > 2.5 && this.level > 0) {
      this.level--;
      this.slow = 0;
      this.apply(this.level);
    } else if (this.fast > 12 && this.level < 3) {
      this.level++;
      this.fast = 0;
      this.apply(this.level);
    }
  }
}
