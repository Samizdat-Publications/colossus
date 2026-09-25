import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

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
    r.toneMappingExposure = 1.0;
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.45, 0.82);
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
}
