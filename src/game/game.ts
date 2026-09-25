import * as THREE from 'three';
import { balance } from '../core/balance';
import { bus } from '../core/events';
import { Input, type InputFrame } from '../core/input';
import { clamp, damp, ease, lerp, segSegDist, smoothstep } from '../core/math';
import { Rig } from '../anim/rig';
import GOLEM_RIG from '../data/golem_rig.json';
import WARRIOR_RIG from '../data/warrior_rig.json';
import { Player } from './player';
import { Golem } from './golem';
import { ARENA, World } from './world';
import { Threats } from './threats';
import type { FightContext } from './context';
import { QualityGovernor, Renderer } from '../render/renderer';
import { CameraRig } from '../render/cameraRig';
import { ThreatView } from '../render/threatView';
import { buildGreyboxArena } from '../render/arenaGreybox';
import { buildGreyboxGolem, buildGreyboxWarrior } from '../render/greybox';
import { Assembler } from '../render/assembler';
import { setFade } from '../render/fade';
import { golemLook, makeVeinTexture } from '../render/stoneMaterial';
import { PartFader } from '../render/partFader';
import { createSky, skyUniforms } from '../render/sky';
import type { Assets } from '../render/assets';
import { addBrazierFlames, buildArenaModel, buildGolemModel, buildWarriorModel, type ArenaModel } from '../render/models';
import { setHeroLight } from '../render/heroLight';
import { propFadeUniforms } from '../render/fade';
import { heartUniforms } from '../render/models';
import { makeEnvironment } from '../render/environment';
import { waterUniforms } from '../render/models';
import { Cape } from '../render/cloth';
import { GolemMerge } from '../render/golemMerge';
import { AudioEngine } from '../audio/audio';
import { loadSettings, saveSettings, type Settings } from '../core/settings';
import { Fx } from '../render/fx';
import { Weather } from '../render/weather';
import { FirePool, Flames } from '../render/flames';
import { SwordTrail } from '../render/trail';
import { Hud, Tips } from '../ui/hud';
import { Screens, type EndStats } from '../ui/screens';

export type Flow = 'loading' | 'title' | 'intro' | 'fight' | 'dying' | 'dead' | 'victoryCine' | 'victory';

export interface GameOptions {
  test: boolean;
  god: boolean;
  skipIntro: boolean;
  startPhase: number;
  bot: string;
  sound: boolean;
}

const SIM_STEP = 1 / 60;
/** Arm cores lower than this (metres) are within sword reach. */
const REACH = 3.4;
/** Height of the golem's leap apex in metres (golem.ts: pos.y = 4 * 6 * t * (1 - t)). */
const LEAP_APEX = 6;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _swordCold = new THREE.Color(0x8fb0d8);
const _swordHot = new THREE.Color(0xffc27a);

export class Game {
  readonly scene = new THREE.Scene();
  readonly renderer: Renderer;
  readonly cam: CameraRig;
  readonly input: Input;
  readonly world = new World();
  readonly threats = new Threats();
  readonly threatView = new ThreatView();
  readonly player: Player;
  readonly golem: Golem;
  readonly hud: Hud;
  readonly tips: Tips;
  readonly screens: Screens;
  readonly ctx: FightContext;
  private readonly assembler: Assembler;
  private readonly coreMeshes: Map<string, THREE.Mesh>;
  private readonly golemEyes: THREE.Mesh[];
  private readonly coreLights = new Map<string, THREE.PointLight>();
  private readonly golemParts: THREE.Mesh[];
  private readonly fader: PartFader;
  private golemMerge: GolemMerge | null = null;
  private faderMerged: PartFader | null = null;
  flow: Flow = 'loading';
  flowTime = 0;
  paused = false;
  attempt = 0;
  fightTime = 0;
  timeScale = 1;
  private slowmo = 1;
  private slowmoTimer = 0;
  private hitstop = 0;
  private last = performance.now();
  private introQuick = false;
  private introLen = 0;
  private screenDelay = 0;
  frameMs = 16.7;
  private fpsEl: HTMLDivElement | null = null;
  onFrame: ((dt: number, f: InputFrame) => void) | null = null;
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private crackShown = 0;
  private heatShown = 0;

  readonly audio: AudioEngine;
  quality!: QualityGovernor;
  readonly settings: Settings = loadSettings();
  readonly fx: Fx;
  readonly weather = new Weather();
  private flames: Flames | null = null;
  private trail: SwordTrail | null = null;
  private readonly golemPoints: THREE.Vector3[] = [];
  private readonly meteorPoints: THREE.Vector3[] = [];
  private moonBase = 2.3;
  private hemiBase = 1.15;
  /** The warrior's cloth cape (Blender assets only). */
  private cape: Cape | null = null;
  private readonly wind = new THREE.Vector3();
  /** The Blender-made arena, when the assets loaded (null = greybox primitives). */
  private readonly arenaModel: ArenaModel | null = null;
  /** Chest plates that burst off in phase 3, with where they sit on the golem. */
  private readonly plates: { mesh: THREE.Mesh; parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; vel: THREE.Vector3; spin: THREE.Vector3; flying: boolean; rest?: number }[] = [];

  constructor(
    readonly container: HTMLElement,
    readonly opts: GameOptions,
    readonly assets: Assets | null = null,
  ) {
    this.cam = new CameraRig(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(container, this.scene, this.cam.camera);
    this.input = new Input(this.renderer.canvas);
    // audio unlocks on the first click or key (browser rule), then follows the flow
    this.audio = new AudioEngine(this.cam.camera, opts.sound);
    const unlock = () => {
      const first = !this.audio.ctx;
      this.audio.unlock();
      if (first && this.audio.ctx) this.audio.setMusic(this.flow === 'fight' ? 'fight' : 'title', this.golem?.phase ?? 1);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    // atmosphere: moon behind the golem (rim light, shadow toward the player), cool fill, sky dome
    this.scene.background = new THREE.Color(0x0a0e16);
    this.scene.fog = new THREE.FogExp2(0x1e2838, 0.0105);
    this.scene.add(createSky());
    golemLook.uCrackMap.value = assets ? assets.tex.crack : makeVeinTexture();
    if (assets) {
      golemLook.uRim.value = 0.1; // textured stone needs only a hint of the greybox's silhouette rim
      golemLook.uCrackScale.value = 0.15; // larger vein cells: the phase 2 cracks read from across the arena
    }
    this.hemi = new THREE.HemisphereLight(0x8196bb, 0x2c2723, 0.95);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xc4d2ee, 1.85);
    this.moon.position.set(-16, 40, -44);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = sc.bottom = -46;
    sc.right = sc.top = 46;
    sc.near = 5;
    sc.far = 140;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.04;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);
    this.quality = new QualityGovernor((level) => this.applyQuality(level), new URLSearchParams(location.search).get('quality'));
    this.scene.add(this.heroLight);
    this.scene.add(this.firePool.group);
    for (const l of this.fireLights) this.scene.add(l);
    // image-based light from a moonlit night sky: steel, wet stone and water get something to reflect
    this.scene.environment = makeEnvironment(this.renderer.renderer, this.moon.position.clone().normalize());
    this.scene.environmentIntensity = 0.55;

    if (assets) {
      this.arenaModel = buildArenaModel(this.scene, assets);
      this.flames = new Flames(this.arenaModel.braziers.map((b) => b.clone().setY(2.02)));
      this.scene.add(this.flames.group);
      this.threatView.setRockLook(this.arenaModel.rockGeo, this.arenaModel.meteorGeo, this.arenaModel.rockMat, this.arenaModel.debrisGeo);
    } else {
      buildGreyboxArena(this.scene);
      addBrazierFlames(this.scene, []);
    }
    // effects and the storm
    this.fx = new Fx(this.arenaModel?.debrisGeo ?? null, this.arenaModel?.debrisMat ?? null);
    this.scene.add(this.fx.group);
    this.scene.add(this.weather.group);
    this.weather.onStrike = (strength, distance) => bus.emit('lightning', { strength, distance });
    this.scene.add(this.threatView.group);

    let pRig: Rig;
    if (assets) {
      const wm = buildWarriorModel(assets);
      pRig = wm.rig;
      this.trail = new SwordTrail(wm.sword);
      this.swordMat = wm.swordMat;
      this.scene.add(this.trail.mesh);
      if (wm.cape) {
        const r = pRig;
        const spheres = [
          { bone: 'hips', off: new THREE.Vector3(0, 0.05, -0.03), r: 0.2 },
          { bone: 'spine', off: new THREE.Vector3(0, 0.1, -0.02), r: 0.19 },
          { bone: 'chest', off: new THREE.Vector3(0, 0.08, -0.02), r: 0.21 },
          { bone: 'thigh_L', off: new THREE.Vector3(0, -0.2, 0), r: 0.11 },
          { bone: 'thigh_R', off: new THREE.Vector3(0, -0.2, 0), r: 0.11 },
          { bone: 'shin_L', off: new THREE.Vector3(0, -0.15, 0), r: 0.09 },
          { bone: 'shin_R', off: new THREE.Vector3(0, -0.15, 0), r: 0.09 },
        ].map((s) => ({ ...s, i: r.i(s.bone), c: new THREE.Vector3() }));
        this.cape = new Cape(wm.cape, r.bone('chest'), () => {
          for (const s of spheres) s.c.copy(s.off).applyMatrix4(r.bones[s.i].matrixWorld); // offset from the joint, in the bone's frame
          return spheres;
        });
      }
    } else {
      pRig = Rig.fromJoints(WARRIOR_RIG.bones);
      buildGreyboxWarrior(pRig);
    }
    this.scene.add(pRig.root);
    this.player = new Player(pRig);

    let gRig: Rig;
    if (assets) {
      const gm = buildGolemModel(assets);
      gRig = gm.rig;
      this.coreMeshes = gm.cores;
      this.golemEyes = gm.eyes;
      this.golemParts = gm.parts;
      for (const mesh of gm.plates) {
        this.plates.push({ mesh, parent: mesh.parent!, pos: mesh.position.clone(), quat: mesh.quaternion.clone(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), flying: false });
      }
    } else {
      gRig = Rig.fromJoints(GOLEM_RIG.bones);
      const gb = buildGreyboxGolem(gRig);
      this.coreMeshes = gb.cores;
      this.golemEyes = gb.eyes;
      this.golemParts = gb.parts;
    }
    this.scene.add(gRig.root);
    this.golem = new Golem(gRig);
    // the molten heart lights the arena floor in phase 3; one pooled cyan light follows whichever weak point
    // matters most right now (every point light costs every lit pixel). Lights live in the scene, never under
    // a core mesh: a core hiding would drop its light, and any change in the light count recompiles every
    // shader (a 1-2 s freeze).
    this.coreLights.set('core_chest', new THREE.PointLight(0xff6a20, 0, 46, 1.6));
    this.coreLights.set('cyan', new THREE.PointLight(0x5fe8ff, 0, 9, 2));
    for (const l of this.coreLights.values()) this.scene.add(l);
    const home = new THREE.Vector3(ARENA.golemHome[0], 0, ARENA.golemHome[1]);
    this.golem.reset(home.x, home.z, 0);
    this.assembler = new Assembler([...this.golemParts, ...this.coreMeshes.values()], home);
    this.assembler.onPieceLanded = (pos, size) => bus.emit('assembleChunk', { pos, size });
    this.fader = new PartFader(this.golemParts);
    if (assets) {
      // one mesh per bone and stone kind while the golem fights (the loose pieces fly only in and out)
      this.golemMerge = new GolemMerge(gRig, this.golemParts, new Set(this.plates.map((p) => p.mesh)));
      this.faderMerged = new PartFader(this.golemMerge.meshes);
    }

    this.ctx = {
      time: 0,
      player: this.player,
      golem: this.golem,
      world: this.world,
      threats: this.threats,
      scene: this.scene,
      live: false,
    };

    const ui = document.getElementById('ui') ?? container;
    this.hud = new Hud(ui);
    this.tips = new Tips(this.hud);
    this.screens = new Screens(
      ui,
      {
        begin: () => this.begin(),
        resume: () => this.resume(),
        retry: () => this.retry(),
        title: () => this.toTitle(),
        settingsChanged: () => {
          this.applySettings();
          saveSettings(this.settings);
        },
        click: () => this.audio.uiClick(),
      },
      this.settings,
    );
    this.applySettings();

    this.wireEvents();
    this.input.onPointerLockChange = (locked) => {
      if (!locked && !this.paused && (this.flow === 'fight' || this.flow === 'intro') && !this.opts.test) this.pause();
    };
    this.renderer.canvas.addEventListener('click', () => {
      if (!this.paused && (this.flow === 'fight' || this.flow === 'intro')) this.input.requestPointerLock();
    });
    if (new URLSearchParams(location.search).has('fps')) {
      this.fpsEl = document.createElement('div');
      this.fpsEl.className = 'fps';
      document.body.appendChild(this.fpsEl);
    }
  }

  // ------------------------------------------------------------------ events

  private wireEvents(): void {
    const near = (p: THREE.Vector3, r: number) => 1 - smoothstep(r * 0.3, r, p.distanceTo(this.player.pos));
    bus.on('slamImpact', (e) => this.cam.shake((e.big ? 0.75 : 0.55) * (0.35 + 0.65 * near(e.pos, 45))));
    bus.on('stompImpact', (e) => this.cam.shake(0.5 * (0.3 + 0.7 * near(e.pos, 40))));
    bus.on('golemStep', (e) => this.cam.shake(0.13 * e.strength * near(e.pos, 30)));
    bus.on('rockImpact', (e) => this.cam.shake(0.3 * near(e.pos, 25)));
    bus.on('roar', () => this.cam.shake(0.45));
    bus.on('pushWave', () => this.cam.shake(0.35));
    bus.on('coreHit', (e) => {
      this.golem.flinch(e.core, e.heavy || e.crit);
      this.hitstop = Math.max(this.hitstop, e.crit ? 0.1 : e.heavy ? 0.085 : 0.06);
      this.cam.shake(e.heavy ? 0.22 : 0.14);
    });
    bus.on('bodyHit', () => (this.hitstop = Math.max(this.hitstop, 0.05)));
    bus.on('coreHit', () => {
      this.tips.show('break', 'Core hits fill <b class="core">BREAK</b>. Fill it and the Ruin falls to its knees.', 2, 4.5);
    });
    bus.on('deflect', () => {
      this.hitstop = Math.max(this.hitstop, 0.05);
      this.cam.shake(0.1);
      this.tips.show('deflect', 'Stone <b>deflects</b> your blade. Strike the <b class="core">glowing cores</b> on its arms.', 3, 5);
    });
    bus.on('playerHit', (e) => {
      this.cam.shake(e.knockdown ? 0.5 : 0.32);
      this.cam.kick(0.6);
    });
    bus.on('playerBlock', () => this.cam.shake(0.18));
    bus.on('guardBreak', () => this.cam.shake(0.3));
    bus.on('playerDeath', () => this.onPlayerDeath());
    bus.on('golemDeath', () => this.onGolemDeath());
    bus.on('staggerStart', () => {
      this.cam.shake(0.5);
      if (this.golem.phase >= 3) this.tips.show('stagger3', 'It is <b>down</b>! Strike its <b class="core">exposed heart</b> or the <b class="core">core on its back</b>.', 2, 5);
      else this.tips.show('stagger', 'It is <b>down</b>! Get behind it and strike the <b class="core">core on its back</b>.', 3, 5);
    });
    bus.on('phaseChange', (e) => {
      if (this.flow === 'fight') this.startPhaseCine();
      this.pendingStrike = 1.15;
      if (e.phase >= 3) this.burstPlates();
      this.weather.strike(1);
      this.hud.bossVisible = true;
      if (e.phase === 2) this.tips.show('phase2', 'The Ruin cracks open. It is faster now.', 1, 4);
      if (e.phase === 3) this.tips.show('phase3', 'Its heart burns in its chest: bring it to its <b>knees</b> before you strike it. Watch the sky.', 1, 5);
    });
    bus.on('hazardBurn', () => this.tips.show('burn', 'The cracked floor <b>burns</b>. Step out of it.', 2, 3.5));
    bus.on('shockwave', () => this.tips.showNow('wave', 'Shockwave: <b>roll</b> (Space) or <b>jump</b> (F) through the ring.', 2, 3));
    bus.on('playerHit', (e) => this.hud.flash(e.knockdown ? 1 : 0.6));
    bus.on('playerDeath', () => this.hud.flash(1.4));
  }

  // ------------------------------------------------------------------ flow

  private setFlow(f: Flow): void {
    this.flow = f;
    this.flowTime = 0;
  }

  toTitle(): void {
    this.paused = false;
    void this.audio.ctx?.resume();
    this.audio.setMusic('title');
    this.input.exitPointerLock();
    this.resetFight();
    this.setFlow('title');
    this.hud.setVisible(false);
    this.screens.show('title');
    this.ctx.live = false;
  }

  begin(): void {
    this.attempt++;
    this.startIntro(this.attempt > 1 || this.opts.skipIntro);
  }

  retry(): void {
    this.attempt++;
    this.startIntro(true);
  }

  private resetFight(): void {
    const B = balance;
    this.threats.clear();
    this.player.reset(ARENA.spawn[0], ARENA.spawn[1], Math.PI);
    this.player.god = this.opts.god;
    this.player.control = false;
    const home = ARENA.golemHome;
    this.golem.reset(home[0], home[1], 0);
    this.restorePlates();
    this.cape?.reset();
    this.fx.clear();
    this.assembler.reset();
    this.assembler.apply(0, 0);
    this.fightTime = 0;
    this.slowmo = 1;
    this.slowmoTimer = 0;
    this.hitstop = 0;
    this.hud.bossVisible = false;
    this.cam.snapBehind(this.player, Math.PI);
    void B;
  }

  private startIntro(quick: boolean): void {
    this.paused = false;
    this.resetFight();
    bus.emit('assembleStart', { quick });
    if (this.audio.music) this.audio.setMusic('title');
    this.tips.newAttempt();
    this.introQuick = quick;
    const F = balance.fight;
    this.introLen = quick ? F.retryIntroDuration : F.introDuration;
    this.golem.beginAssemble(quick ? 1.2 : 5.4, quick);
    this.setFlow('intro');
    this.screens.show('none');
    this.hud.setVisible(false);
    this.hud.showControls = false;
    this.ctx.live = false;
    if (!this.opts.test) this.input.requestPointerLock();
    if (this.opts.startPhase > 1) {
      this.skipIntro();
      this.golem.hp = this.golem.maxHp * (this.opts.startPhase === 2 ? 0.655 : 0.325);
      this.golem.pendingPhase = this.opts.startPhase;
      this.golem.phase = this.opts.startPhase - 1;
    }
    if (this.opts.skipIntro) this.skipIntro();
  }

  skipIntro(): void {
    if (this.flow !== 'intro') return;
    this.assembler.apply(1, 0);
    this.golem.anim.seq?.jumpTo('settle');
    this.flowTime = this.introLen;
  }

  private startFight(): void {
    this.setFlow('fight');
    this.player.control = true;
    this.ctx.live = true;
    this.hud.bossVisible = true;
    this.hud.setVisible(true);
    this.hud.showControls = this.attempt === 1 && this.settings.showControls;
    this.controlsTimer = this.hud.showControls ? 10 : 0;
    bus.emit('fightStart', { attempt: this.attempt });
    if (this.attempt === 1) this.tips.show('start', 'Only the <b class="core">glowing cores</b> can be harmed.', 1, 4);
  }
  private controlsTimer = 0;

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.screens.show('pause');
    this.input.exitPointerLock();
    void this.audio.ctx?.suspend();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.audio.ctx?.resume();
    this.screens.show('none');
    if (!this.opts.test) this.input.requestPointerLock();
    this.last = performance.now();
  }

  private onPlayerDeath(): void {
    if (this.flow !== 'fight') return;
    this.tips.dismiss('lock');
    this.hitstop = Math.max(this.hitstop, 0.12);
    this.deathSide = 0;
    this.deathT = 0;
    this.deathBlocked = 0;
    this.setFlow('dying');
    this.slowmo = 0.55;
    this.slowmoTimer = 1.0;
    this.player.control = false;
    this.ctx.live = false;
    this.screenDelay = balance.fight.deathScreenDelay;
  }

  private onGolemDeath(): void {
    if (this.flow !== 'fight') return;
    bus.emit('victory', {});
    this.weather.strike(1);
    this.setFlow('victoryCine');
    this.slowmo = 0.3;
    this.slowmoTimer = 1.6;
    this.ctx.live = false;
    this.player.locked = false;
    this.threats.clear();
    this.hud.bossVisible = false;
    this.screenDelay = balance.fight.victoryScreenDelay;
  }

  deathHint(): string {
    switch (this.player.lastHitSource) {
      case 'slam':
        return 'Slams land on the red ring. Roll aside as the fist falls, then strike its arm core while the fist is stuck.';
      case 'doubleSlam':
        return 'After the two-fisted slam a fissure races toward you: roll sideways, not backward.';
      case 'sweep':
        return 'Sweeps cover a wide arc. Roll through the arm, or stay close to its legs where the arm passes overhead.';
      case 'stomp':
      case 'leap':
        return 'Shockwave rings can be jumped (F) or rolled through (Space). Time it as the ring reaches you.';
      case 'rock':
      case 'meteor':
        return 'Watch for red landing rings. Roll out of them, or put a pillar between you and the Ruin.';
      case 'hazard':
        return 'Glowing cracks burn. Keep off them until they cool.';
      case 'fissure':
        return 'The fissure races toward where you stand. Roll to the side.';
      case 'push':
        return 'When it rises from its knees it throws you back. Back off as it starts to rise.';
      default:
        return 'Only the glowing cores take damage. Strike an arm core while its fist is stuck in the ground.';
    }
  }

  /** What killed the warrior, in words. */
  deathCause(): string {
    const names: Record<string, string> = {
      slam: 'a ground slam',
      doubleSlam: 'the two-fisted slam',
      sweep: 'a sweeping arm',
      stomp: 'a stomp',
      leap: 'the leaping slam',
      rock: 'a thrown rock',
      meteor: 'falling rubble',
      hazard: 'the burning floor',
      fissure: 'the racing fissure',
      push: 'the shockwave of its rise',
    };
    return names[this.player.lastHitSource] ?? 'the Ruin';
  }

  private endStats(): EndStats {
    return {
      cause: this.deathCause(),
      attempt: this.attempt,
      time: this.fightTime,
      bossLeft: this.golem.healthFrac,
      phase: this.golem.phase,
      hint: this.deathHint(),
      hits: this.player.stats.hits,
      flasks: this.player.stats.flasksUsed,
      damageTaken: this.player.stats.damageTaken,
      coreHits: this.player.stats.coreHits,
      staggers: this.golem.stats.staggers,
    };
  }

  /** Quality levels: 3 = full, 2 = render scale 1, 1 = 0.85 and half-size shadows, 0 = 0.7. */
  private applyQuality(level: number): void {
    const scale = [0.7, 0.85, 1.0, 1.5][level];
    this.renderer.setPixelRatio(scale);
    const shadow = level >= 2 ? 2048 : 1024;
    if (this.moon.shadow.mapSize.x !== shadow) {
      this.moon.shadow.mapSize.set(shadow, shadow);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    }
  }

  /** Push the menu settings into input, camera, audio and HUD. */
  applySettings(): void {
    const s = this.settings;
    this.input.settings.sensitivity = 0.0024 * s.sensitivity;
    this.input.settings.invertY = s.invertY;
    this.cam.shakeScale = s.shake;
    this.audio.settings = { master: s.master, music: s.music, sfx: s.sfx };
    this.audio.applySettings();
  }

  // ------------------------------------------------------------------ loop

  /**
   * Compile every shader up front (on the loading screen) with everything made visible for one pass, so
   * the first stagger, phase change or effect never stalls on a shader compile. Lights are left alone:
   * the light count must stay what it is in play.
   */
  warmUp(): void {
    const shown: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible && !(o as THREE.Light).isLight) {
        o.visible = true;
        shown.push(o);
      }
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    this.renderer.renderer.compile(this.scene, this.cam.camera);
    // one real frame (shadow pass and post passes included) uploads every buffer and texture too
    this.renderer.render(0);
    for (const o of shown) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
  }

  start(): void {
    this.toTitle();
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  frame(now: number): void {
    const rawDt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frameMs = lerp(this.frameMs, rawDt * 1000, 0.05);
    const f = this.input.frame(rawDt);
    this.handleUiInput(f);
    this.onFrame?.(rawDt, f);

    if (!this.paused) {
      let dt = rawDt * this.timeScale;
      if (this.slowmoTimer > 0) {
        this.slowmoTimer -= rawDt;
        if (this.slowmoTimer <= 0) this.slowmo = 1;
      }
      dt *= this.slowmo;
      if (this.hitstop > 0) {
        this.hitstop -= rawDt;
        dt *= 0.08;
      }
      if (this.flow === 'fight' || this.flow === 'intro' || this.flow === 'dying' || this.flow === 'victoryCine') {
        this.player.handleInput(f, this.cam.moveYaw);
      }
      const n = Math.max(1, Math.ceil(dt / SIM_STEP - 1e-6));
      const h = dt / n;
      for (let i = 0; i < n; i++) this.step(h);
      this.updateFlow(rawDt, dt, f);
      this.updateVisuals(dt);
    }
    this.hud.dying = this.flow === 'dying';
    this.hud.bossDim = this.flow === 'fight' && this.ringUnderBossPanel();
    this.hud.update(rawDt, this.player, this.golem, this.cam.camera, window.innerWidth, window.innerHeight);
    this.renderer.render(rawDt);
    this.quality.update(rawDt, this.frameMs, !this.paused && (this.flow === 'fight' || this.flow === 'title'));
    if (this.fpsEl) this.fpsEl.textContent = `${this.frameMs.toFixed(1)} ms · q${this.quality.level}`;
  }

  private handleUiInput(f: InputFrame): void {
    if (this.screens.current !== 'none' && this.screens.current !== 'loading') {
      const canConfirm = this.flowTime > 0.5 || this.paused;
      const sub = this.screens.current === 'howto' || this.screens.current === 'settings';
      this.screens.nav(f.pressed.up, f.pressed.down, canConfirm && f.pressed.confirm, f.pressed.left, f.pressed.right, f.pressed.pause && sub);
      if (this.paused && f.pressed.pause && !sub && this.flowTime > 0) this.resume();
      return;
    }
    if (f.pressed.pause && (this.flow === 'fight' || this.flow === 'intro' || this.flow === 'dying')) this.pause();
    if (f.pressed.hints) this.hud.showControls = !this.hud.showControls;
    if (this.flow === 'intro' && !this.introQuick && this.flowTime > 1 && (f.pressed.confirm || f.pressed.roll || f.pressed.light)) this.skipIntro();
  }

  private step(h: number): void {
    this.ctx.time += h;
    this.golem.fillColliders(this.world.dynamic);
    if (this.flow !== 'title') this.player.update(h, this.ctx);
    this.golem.update(h, this.ctx);
    this.threats.update(h, this.ctx);
    if (this.flow === 'fight') this.fightTime += h;
  }

  private updateFlow(rawDt: number, dt: number, f: InputFrame): void {
    this.flowTime += rawDt;
    const cam = this.cam;
    switch (this.flow) {
      case 'title': {
        cam.cineBlend = 0;
        this.assembler.apply(0, this.ctx.time);
        // inside the colonnade (pillar ring at 31 m): a wider orbit grazed the pillar tops
        cam.orbit(rawDt, _v.set(0, 3, ARENA.golemHome[1]), 24, 9, 0.05);
        break;
      }
      case 'intro': {
        const t = this.flowTime;
        const L = this.introLen;
        if (this.introQuick) {
          cam.cineBlend = 0;
          this.player.locked = false;
          cam.update(rawDt, 0, 0, this.player, this.golem, this.world);
          this.assembler.apply(clamp(t / 1.2, 0, 1), this.ctx.time);
          if (t >= L * 0.6) {
            this.hud.bossVisible = true;
            this.hud.setVisible(true);
          }
        } else {
          this.assembler.apply(clamp((t - 0.4) / 5.0, 0, 1), this.ctx.time);
          this.introShot(t);
          cam.cineBlend = 1 - smoothstep(L - 1.4, L, t);
          cam.update(rawDt, 0, 0, this.player, this.golem, this.world);
          if (t >= L - 0.25) {
            this.hud.bossVisible = true;
            this.hud.setVisible(true);
          }
        }
        if (t >= L) this.startFight();
        break;
      }
      case 'fight':
      case 'dying':
      case 'victoryCine': {
        if (this.flow === 'fight') {
          if (this.controlsTimer > 0) {
            this.controlsTimer -= rawDt;
            if (this.controlsTimer <= 0) this.hud.showControls = false;
          }
          if (!this.player.locked && this.player.alive && this.flowTime > 4.5 && this.flowTime < 30) {
            this.tips.show('lock', 'Press <b>Q</b> (or middle click) to lock on to the Ruin.', 2, 5);
          }
          if (this.player.locked) this.tips.dismiss('lock');
        }
        if (this.flow === 'victoryCine') {
          this.phaseCineT = -1;
          this.victoryShot();
          cam.cineBlend = damp(cam.cineBlend, 1, 2.2, rawDt);
        } else if (this.flow === 'dying') {
          this.phaseCineT = -1;
          this.deathShot(rawDt);
          cam.cineBlend = damp(cam.cineBlend, 1, 3.5, rawDt);
        } else if (this.phaseCineT >= 0) {
          // phase change: hard cut in, hold through the roar, blend back to the warrior
          this.phaseCineT += rawDt;
          const hold = balance.golem.transition.duration - 0.7;
          this.phaseShot(this.phaseCineT);
          cam.cineBlend = this.phaseCineT < hold ? 1 : damp(cam.cineBlend, 0, 3.2, rawDt);
          this.hud.cine = this.phaseCineT < hold;
          if (this.phaseCineT > hold + 1.6) {
            this.phaseCineT = -1;
            this.hud.cine = false;
          }
        } else cam.cineBlend = damp(cam.cineBlend, 0, 3, rawDt);
        cam.update(rawDt, f.lookX, f.lookY, this.player, this.golem, this.world);
        if (this.flow !== 'fight') {
          this.screenDelay -= rawDt;
          if (this.screenDelay <= 0) {
            if (this.flow === 'dying') {
              this.setFlow('dead');
              this.screens.show('dead', this.endStats());
            } else {
              this.setFlow('victory');
              this.screens.show('victory', this.endStats());
            }
            this.hud.setVisible(false);
            this.input.exitPointerLock();
          }
        }
        break;
      }
      case 'dead':
      case 'victory':
        if (this.flow === 'dead') this.deathShot(rawDt);
        cam.update(rawDt, 0, 0, this.player, this.golem, this.world);
        break;
      default:
        break;
    }
    void dt;
  }

  private readonly blockedPivots = new Set<THREE.Object3D>();

  /** Does any warning ring reach into the boss panel's strip at the bottom of the screen? */
  private ringUnderBossPanel(): boolean {
    const cam = this.cam.camera;
    for (const t of this.threats.telegraphs) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        _v3.set(t.pos.x + Math.sin(a) * t.radius, 0.05, t.pos.z + Math.cos(a) * t.radius).project(cam);
        if (_v3.z < 1 && _v3.y < -0.78 && Math.abs(_v3.x) < 0.6) return true;
      }
    }
    return false;
  }
  private readonly firePool = new FirePool(24);
  private readonly fireSpots: { x: number; z: number; size: number }[] = [];
  private swordMat: THREE.MeshStandardMaterial | null = null;
  private chargeFlashed = false;

  /** Golem bones whose capsule cuts the camera's line of sight to the warrior's chest or feet. */
  private findBlockers(cam: THREE.Vector3): Set<THREE.Object3D> {
    const out = this.blockedPivots;
    out.clear();
    // in the death shots the whole fist and forearm clear out of the way (the killing slam lands by the body)
    const wide = this.flow === 'dying' || this.flow === 'dead';
    const p = this.player;
    const caps = this.golem.capsules;
    const bones = this.golem.rig.bones;
    for (const h of [1.25, 0.3]) {
      _v3.set(p.pos.x, p.y + h, p.pos.z);
      for (let i = 0; i < caps.length; i++) {
        const c = caps[i];
        if (segSegDist(cam, _v3, c.a, c.b) < c.r * (wide ? 1.15 : 0.85) + (wide ? 0.6 : 0.3)) out.add(bones[i]);
      }
    }
    return out;
  }

  private deathSide = 0;
  private deathT = 0;
  private readonly deathDir = new THREE.Vector3(0, 0, 1);
  private readonly deathPosNow = new THREE.Vector3();
  private readonly deathLookNow = new THREE.Vector3();
  private deathBlocked = 0;
  private pendingStrike = -1;
  private phase3Time = 0;
  private phaseCineT = -1;
  private readonly phaseCamDir = new THREE.Vector3();

  private phaseCamDist = 20;

  /**
   * Pick the camera for the phase-change roar: in front of the golem's face (three-quarter), as far out as
   * the pillar ring allows (up to 21 m), with a clear line to the golem.
   */
  private startPhaseCine(): void {
    const g = this.golem.pos;
    const base = this.golem.yaw;
    let best = base + 0.5;
    let bestD = 0;
    for (const off of [0.5, -0.5, 0.85, -0.85, 0.2, -0.2, 1.2, -1.2]) {
      const a = base + off;
      let d = 0;
      for (let i = 1; i <= 21; i++) {
        const x = g.x + Math.sin(a) * i;
        const z = g.z + Math.cos(a) * i;
        if (Math.hypot(x, z) > 28 || (i > 6 && this.world.blocked(x, 2.5, z, 0.8))) break;
        d = i;
      }
      if (d > bestD + 1.5) {
        best = a;
        bestD = d;
      }
      if (d >= 20) break;
    }
    this.phaseCamDir.set(Math.sin(best), 0, Math.cos(best));
    this.phaseCamDist = Math.max(12, bestD);
    this.phaseCineT = 0;
  }

  /** The phase-change roar: a low three-quarter view of the whole golem, pushing in slowly. */
  private phaseShot(t: number): void {
    const c = this.cam.cine;
    const g = this.golem.pos;
    const u = Math.min(1, t / 3);
    const r = this.phaseCamDist - 1.5 * u;
    const camY = 4.5 + 1.2 * u;
    c.pos.set(g.x + this.phaseCamDir.x * r, camY, g.z + this.phaseCamDir.z * r);
    // frame from the feet to above the raised fists (about 21 m) whatever the distance
    const top = Math.atan2(21.5 - camY, r);
    const bottom = Math.atan2(-camY + 0.2, r - 3);
    const pitch = (top + bottom) / 2;
    c.look.set(g.x, camY + Math.tan(pitch) * r, g.z);
    c.fov = Math.min(80, ((top - bottom) * 1.12 * 180) / Math.PI);
  }

  /** After death: a low view over the fallen warrior, the Ruin looming behind, rising slowly. */
  private deathShot(dt: number): void {
    // one continuous clock and one viewpoint for the whole death (dying, then the FALLEN screen)
    this.deathT += dt;
    const c = this.cam.cine;
    const p = this.player.pos;
    const g = this.golem.pos;
    const t = Math.min(1, this.deathT / 5);
    // a limb that swings into the view after the choice (the golem's attack runs on) forces a new choice
    if (this.deathSide !== 0) {
      _v3.set(p.x + this.deathDir.x * 5, 4.2, p.z + this.deathDir.z * 5);
      _v2.set(p.x, 0.4, p.z);
      let blocked = false;
      for (const cap of this.golem.capsules) if (segSegDist(_v3, _v2, cap.a, cap.b) < cap.r * 1.3 + 0.4) blocked = true;
      this.deathBlocked = blocked ? this.deathBlocked + dt : 0;
      if (this.deathBlocked > 0.25) {
        this.deathSide = 0;
        this.deathBlocked = 0;
      }
    }
    if (this.deathSide === 0) {
      // of 16 directions around the body, take the one whose view of the body is clearest of golem limbs,
      // preferring views with the golem behind the body
      let tox = g.x - p.x;
      let toz = g.z - p.z;
      const tl = Math.hypot(tox, toz) || 1;
      tox /= tl;
      toz /= tl;
      let best = -Infinity;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const ux = Math.sin(a);
        const uz = Math.cos(a);
        const cx = p.x + ux * 5;
        const cz = p.z + uz * 5;
        if (Math.hypot(cx, cz) > 28) continue;
        _v3.set(cx, 4.2, cz);
        _v2.set(p.x, 0.4, p.z);
        let clear = 99;
        for (const cap of this.golem.capsules) clear = Math.min(clear, segSegDist(_v3, _v2, cap.a, cap.b) - cap.r * 1.3);
        const behind = -(ux * tox + uz * toz);
        const score = Math.min(clear, 3) * 2 + behind * 1.5 - (clear < 0.4 ? 20 : 0);
        if (score > best) {
          best = score;
          this.deathDir.set(ux, 0, uz);
        }
      }
      // seen from there, which side of the body does the golem show on? (camera right = (dz, -dx))
      this.deathSide = Math.sign((g.x - p.x) * this.deathDir.z - (g.z - p.z) * this.deathDir.x) || 1;
    }
    const back = 4.2 + 1.6 * t;
    let px = p.x + this.deathDir.x * back;
    let pz = p.z + this.deathDir.z * back;
    const d = Math.hypot(px, pz);
    // stay inside the pillar ring (31 m)
    if (d > 28) {
      px *= 28 / d;
      pz *= 28 / d;
    }
    // high over the body: the warrior's fall reads from above, limbs rarely cross the view
    c.pos.set(px, 3.4 + 1.8 * t, pz);
    // never inside the golem
    for (const cap of this.golem.capsules) {
      const ax = cap.b.x - cap.a.x;
      const ay = cap.b.y - cap.a.y;
      const az = cap.b.z - cap.a.z;
      const len2 = ax * ax + ay * ay + az * az || 1;
      let u = ((c.pos.x - cap.a.x) * ax + (c.pos.y - cap.a.y) * ay + (c.pos.z - cap.a.z) * az) / len2;
      u = Math.max(0, Math.min(1, u));
      const qx = c.pos.x - (cap.a.x + ax * u);
      const qy = c.pos.y - (cap.a.y + ay * u);
      const qz = c.pos.z - (cap.a.z + az * u);
      const dd = Math.hypot(qx, qy, qz) || 1;
      const min = cap.r + 1.2;
      if (dd < min) c.pos.set(c.pos.x + (qx / dd) * (min - dd), Math.max(1, c.pos.y + (qy / dd) * (min - dd)), c.pos.z + (qz / dd) * (min - dd));
    }
    // aim so the body lies in an outer third of the frame (the FALLEN text, stats and buttons fill the
    // middle): the view turns toward the side the golem shows on, so the golem stays in frame too
    c.fov = 60;
    const bx = p.x - c.pos.x;
    const by = 0.4 - c.pos.y;
    const bz = p.z - c.pos.z;
    const bh = Math.hypot(bx, bz) || 1;
    const fx = bx / bh;
    const fz = bz / bh;
    const sx = -fz;
    const sz = fx;
    const tv = Math.tan((c.fov * Math.PI) / 360);
    const pitch = Math.atan2(by, bh) + Math.atan(0.3 * tv);
    // a steep camera squeezes a yaw offset on screen: widen the turn by 1 / cos(pitch)
    const turn = Math.atan((0.6 * tv * this.cam.camera.aspect) / Math.max(0.5, Math.cos(pitch))) * this.deathSide;
    const lx = fx * Math.cos(turn) + sx * Math.sin(turn);
    const lz = fz * Math.cos(turn) + sz * Math.sin(turn);
    c.look.set(c.pos.x + lx * 10 * Math.cos(pitch), c.pos.y + 10 * Math.sin(pitch), c.pos.z + lz * 10 * Math.cos(pitch));
    // glide to a new viewpoint instead of cutting (the first frame of a death snaps)
    if (this.deathT <= dt + 1e-6) {
      this.deathPosNow.copy(c.pos);
      this.deathLookNow.copy(c.look);
    } else {
      const k = 1 - Math.exp(-4.5 * dt);
      this.deathPosNow.lerp(c.pos, k);
      this.deathLookNow.lerp(c.look, k);
    }
    c.pos.copy(this.deathPosNow);
    c.look.copy(this.deathLookNow);
  }

  /** Pull back to watch the Ruin collapse (from the player's side, three-quarter view). */
  private victoryShot(): void {
    const c = this.cam.cine;
    const g = this.golem.pos;
    const p = this.player.pos;
    let dx = p.x - g.x;
    let dz = p.z - g.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // over the warrior's shoulder: the warrior in the foreground, the collapse beyond
    // the closer the warrior stands to the falling giant, the further back the camera steps
    const back = clamp(22 - l, 10, 16);
    let px = p.x + dx * back - dz * 4;
    let pz = p.z + dz * back + dx * 4;
    const d = Math.hypot(px, pz);
    // stay inside the pillar ring (31 m)
    if (d > 28) {
      px *= 28 / d;
      pz *= 28 / d;
    }
    // high and wide: the collapsing arms stay below the lens
    c.pos.set(px, 8.5, pz);
    c.look.set(lerp(p.x, g.x, 0.72), 2.8, lerp(p.z, g.z, 0.72));
    c.fov = 56;
  }

  /** Scripted camera for the first intro: circle the gathering rubble, look up as it rises, settle behind the player. */
  private introShot(t: number): void {
    const c = this.cam.cine;
    const home = _v2.set(ARENA.golemHome[0], 0, ARENA.golemHome[1]);
    if (t < 5.6) {
      const u = t / 5.6;
      const a = lerp(0.9, 2.3, ease.inOutSine(u));
      const r = lerp(24, 17, u);
      c.pos.set(home.x + Math.sin(a) * r, lerp(9, 3.2, u), home.z + Math.cos(a) * r);
      c.look.set(home.x, lerp(1.0, 3.0, u), home.z);
      c.fov = 46;
    } else if (t < 8.6) {
      const u = (t - 5.6) / 3.0;
      c.pos.set(lerp(7, 4, u), lerp(1.3, 1.6, u), lerp(12, 15, u));
      this.golem.lockPoint(c.look);
      c.look.y = lerp(4, 10, ease.inOutSine(u));
      c.fov = lerp(52, 58, u);
    } else {
      const u = clamp((t - 8.6) / 2, 0, 1);
      const p = this.player.pos;
      c.pos.set(p.x + lerp(1.8, 1.1, u), lerp(2.6, 3.4, u), p.z + lerp(5.2, 7.4, u));
      this.golem.lockPoint(c.look);
      c.look.y = lerp(8.2, 5.4, u);
      c.fov = 58;
    }
  }

  private crumbleT = -1;
  private prevGolemY = 0;
  private readonly airborneParts = new Set(['hips', 'spine', 'chest', 'neck', 'head', 'shoulder_L', 'shoulder_R']);
  private readonly leapParts = new Set([...this.airborneParts, 'hand_L', 'hand_R']);
  private readonly heroLight = new THREE.PointLight(0xc8d8ff, 3.5, 7, 2);
  /** Two pooled fire lights for the burning ground nearest the warrior (always in the scene: constant light count). */
  private readonly fireLights = [new THREE.PointLight(0xff8a2a, 0, 9, 2), new THREE.PointLight(0xff8a2a, 0, 9, 2)];
  private roarFlare = 0;
  private heldRockMesh: THREE.Mesh | null = null;

  private updateStorm(dt: number): void {
    const cam = this.cam.camera;
    const h = this.renderer.renderer.domElement.height;
    this.fx.setViewport(h, cam.fov);
    this.weather.setViewport(h, cam.fov);
    const g = this.golem;
    // lightning more often in phase 3
    this.weather.update(dt, this.ctx.time, cam, this.player.pos, g.phase >= 3 ? 1.7 : 1);
    const f = this.weather.flash;
    skyUniforms.uFlash.value = f;
    this.moon.intensity = this.moonBase + f * 5;
    this.hemi.intensity = this.hemiBase + f * 1.4;
    this.flames?.update(this.ctx.time);
    // embers from the golem's cracks: sample its body
    if (this.golemPoints.length !== g.capsules.length) {
      this.golemPoints.length = 0;
      for (let i = 0; i < g.capsules.length; i++) this.golemPoints.push(new THREE.Vector3());
    }
    g.capsules.forEach((c, i) => this.golemPoints[i].lerpVectors(c.a, c.b, Math.random()));
    let mi = 0;
    for (const r of this.threats.rocks) {
      if (!r.meteor || r.t < 0) continue;
      if (!this.meteorPoints[mi]) this.meteorPoints[mi] = new THREE.Vector3();
      this.meteorPoints[mi++].copy(r.pos);
    }
    this.meteorPoints.length = mi;
    const active = g.state !== 'dormant' && g.state !== 'dead';
    this.fx.dust.setClearLine(this.cam.camera.position, _v3.set(this.player.pos.x, this.player.y + 1.0, this.player.pos.z));
    this.fx.update(dt, this.ctx.time, {
      hazards: this.threats.hazards,
      braziers: this.arenaModel?.braziers ?? [],
      golemPoints: active ? this.golemPoints : [],
      phase: g.phase,
      meteors: this.meteorPoints,
      waves: this.threats.waves,
    });
    if (this.trail) {
      const a = this.player.atk;
      const striking = !!a && this.player.anim.seq?.stepName === 'strike';
      this.trail.update(dt, striking, !!a?.heavy);
      // a held heavy attack heats the blade; a full charge flashes once and burns bright into the strike
      if (this.swordMat) {
        const charging = !!a?.heavy && !a.chargeDone;
        const heat = charging ? 0.3 + 2.2 * a.charge : a?.heavy && a.charged && striking ? 2.8 : 0;
        const want = Math.max(0.22, heat);
        const k = this.swordMat.emissiveIntensity;
        this.swordMat.emissiveIntensity = k + (want - k) * Math.min(1, dt * (want > k ? 14 : 5));
        // cold steel glint at rest, heating to orange as a heavy attack charges
        this.swordMat.emissive.lerpColors(_swordCold, _swordHot, Math.min(1, heat / 1.2));
        if (a?.charged && !this.chargeFlashed) {
          this.chargeFlashed = true;
          this.player.rig.worldPos(this.player.rig.i('hand_R'), _v3);
          this.fx.flash(_v3, new THREE.Color(1, 0.8, 0.5), 1.1, 0.14);
          this.fx.sparks(_v3, null, 16, new THREE.Color(1, 0.75, 0.4), 4, 0.4, 0.07);
        }
        if (!a?.heavy) this.chargeFlashed = false;
      }
    }
  }

  private updateAudio(): void {
    const p = this.player.pos;
    // fire: the nearest brazier or burning patch
    let fire = 0;
    for (const b of this.arenaModel?.braziers ?? []) fire = Math.max(fire, 1 - Math.min(1, Math.hypot(b.x - p.x, b.z - p.z) / 9));
    for (const h of this.threats.hazards) {
      if (h.t < h.arm) continue;
      fire = Math.max(fire, 1 - Math.min(1, (Math.hypot(h.pos.x - p.x, h.pos.z - p.z) - h.radius) / 7));
    }
    const g = this.golem;
    const heat = this.flow !== 'fight' ? 0 : g.staggered ? 0.15 : 1;
    this.audio.update(p, 1, fire, heat, g.phase);
  }

  /** Phase 3: the chest plates burst off and tumble to the floor, baring the molten heart. */
  private burstPlates(): void {
    const chest = this.golem.rig.bone('chest');
    const c = chest.getWorldPosition(new THREE.Vector3());
    for (const p of this.plates) {
      if (p.flying) continue;
      this.scene.attach(p.mesh);
      p.mesh.userData.detached = true;
      const w = p.mesh.getWorldPosition(new THREE.Vector3());
      const out = w.sub(c).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.sin(this.golem.yaw), 0, Math.cos(this.golem.yaw));
      out.normalize();
      p.vel.copy(out).multiplyScalar(7 + Math.random() * 3).setY(5 + Math.random() * 2);
      p.spin.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4);
      p.flying = true;
      p.rest = 0;
    }
    if (this.plates.length) bus.emit('rockImpact', { pos: c.clone(), radius: 3 });
  }

  private updatePlates(dt: number): void {
    for (const p of this.plates) {
      if (!p.flying) continue;
      const m = p.mesh;
      if (p.vel.lengthSq() < 1e-6) {
        // at rest: after a moment the shard sinks into the flooded floor (no hot rubble cluttering phase 3)
        p.rest = (p.rest ?? 0) + dt;
        if (p.rest > 1.5) m.position.y -= dt * 0.7;
        if (m.position.y < -1.2) m.visible = false;
        continue;
      }
      p.vel.y -= 22 * dt;
      m.position.addScaledVector(p.vel, dt);
      m.rotation.x += p.spin.x * dt;
      m.rotation.y += p.spin.y * dt;
      m.rotation.z += p.spin.z * dt;
      if (m.position.y < 0.45) {
        m.position.y = 0.45;
        if (Math.abs(p.vel.y) > 3) {
          p.vel.y *= -0.25;
          p.vel.x *= 0.5;
          p.vel.z *= 0.5;
          p.spin.multiplyScalar(0.4);
          bus.emit('rockImpact', { pos: m.position.clone(), radius: 1.5 });
        } else {
          p.vel.set(0, 0, 0);
          p.spin.set(0, 0, 0);
        }
      }
    }
  }

  private restorePlates(): void {
    for (const p of this.plates) {
      if (!p.flying) continue;
      p.parent.add(p.mesh);
      p.mesh.position.copy(p.pos);
      p.mesh.quaternion.copy(p.quat);
      p.mesh.userData.detached = false;
      p.mesh.visible = true;
      p.flying = false;
      p.rest = 0;
    }
  }

  private strikeSpot: THREE.Group | null = null;
  private coreBeam: THREE.Mesh | null = null;

  private updateCoreBeam(core: { pos: THREE.Vector3 } | null): void {
    if (!this.coreBeam) {
      const geo = new THREE.CylinderGeometry(0.25, 0.8, 7, 24, 1, true);
      geo.translate(0, 3.5, 0);
      const mat = new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying float vH;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            vH = position.y / 7.0;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          uniform float uTime;
          varying float vH;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            float edge = pow(1.0 - abs(dot(vN, vV)), 1.5);
            float soft = 1.0 - abs(dot(vN, vV));
            float fade = (1.0 - vH) * smoothstep(0.0, 0.08, vH);
            float band = 0.75 + 0.25 * sin(vH * 30.0 - uTime * 6.0);
            float a = uAlpha * fade * band * (0.25 + 0.75 * soft) * (1.0 - edge * 0.6);
            gl_FragColor = vec4(vec3(0.45, 0.95, 1.0) * 1.6, a);
          }`,
        uniforms: { uAlpha: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.coreBeam = new THREE.Mesh(geo, mat);
      this.coreBeam.frustumCulled = false;
      this.coreBeam.renderOrder = 5;
      this.scene.add(this.coreBeam);
    }
    const beam = this.coreBeam;
    const mat = beam.material as THREE.ShaderMaterial;
    const want = core ? 0.55 : 0;
    mat.uniforms.uAlpha.value += (want - mat.uniforms.uAlpha.value) * 0.12;
    mat.uniforms.uTime.value = this.ctx.time;
    beam.visible = mat.uniforms.uAlpha.value > 0.01;
    if (core) beam.position.copy(core.pos).setY(core.pos.y - 0.4);
  }

  /** While the golem is down: a cyan ring on the floor under the core to go for ("stand here"). */
  private updateStrikeSpot(core: { pos: THREE.Vector3 } | null, dt: number): void {
    if (!this.strikeSpot) {
      const g = new THREE.Group();
      const ringGeo = new THREE.RingGeometry(1.25, 1.45, 48);
      ringGeo.rotateX(-Math.PI / 2);
      const discGeo = new THREE.CircleGeometry(1.25, 48);
      discGeo.rotateX(-Math.PI / 2);
      const mk = (geo: THREE.BufferGeometry, op: number) =>
        new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x5ff0ff, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending }));
      g.add(mk(ringGeo, 0.8), mk(discGeo, 0.12));
      g.renderOrder = 3;
      g.visible = false;
      this.scene.add(g);
      this.strikeSpot = g;
    }
    const spot = this.strikeSpot;
    spot.visible = !!core;
    if (!core) return;
    // under the core, nudged out from the golem's centre so it lands on open floor
    _v2.set(core.pos.x - this.golem.pos.x, 0, core.pos.z - this.golem.pos.z);
    const len = _v2.length() || 1;
    _v2.multiplyScalar(1 / len);
    spot.position.set(core.pos.x + _v2.x * 0.9, 0.06, core.pos.z + _v2.z * 0.9);
    const s = 1 + 0.08 * Math.sin(this.ctx.time * 6);
    spot.scale.setScalar(s);
    void dt;
  }

  private updateHeldRock(): void {
    const side = this.golem.heldRock;
    if (!this.heldRockMesh) {
      const am = this.arenaModel;
      this.heldRockMesh =
        am?.rockGeo && am.rockMat
          ? new THREE.Mesh(am.rockGeo, am.rockMat)
          : new THREE.Mesh(
              new THREE.IcosahedronGeometry(1.5, 0),
              new THREE.MeshStandardMaterial({ color: 0x5a554e, roughness: 0.92, flatShading: true, emissive: 0xff4a10, emissiveIntensity: 0.3 }),
            );
      if (am?.rockGeo) this.heldRockMesh.scale.setScalar(1.5);
      this.heldRockMesh.castShadow = true;
      this.scene.add(this.heldRockMesh);
    }
    const m = this.heldRockMesh;
    m.visible = !!side && this.golem.state === 'combat';
    if (m.visible) {
      this.golem.rig.tailWorld(this.golem.rig.i(`hand_${side}`), m.position);
      m.rotation.y += 0.02;
    }
  }

  /** Near edges of warning rings around the warrior: the camera must keep them in frame. */
  private updateMustSee(): void {
    const nice = this.cam.niceToSee;
    nice.length = 0;
    for (const r of this.threats.rocks) if (!r.meteor && r.t >= 0) nice.push(r.pos);
    const must = this.cam.mustSee;
    must.length = 0;
    const cam = this.cam.camera.position;
    const p = this.player.pos;
    // rings the warrior is in, plus the nearest ring just behind them (a reflex roll lands there)
    const near = this.threats.telegraphs
      .filter((t) => t.kind !== 'sector')
      .map((t) => ({ t, d: Math.hypot(t.pos.x - p.x, t.pos.z - p.z) - t.radius }))
      .filter((e) => e.d < 3)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { t } of near) {
      let dx = cam.x - t.pos.x;
      let dz = cam.z - t.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      must.push(new THREE.Vector3(t.pos.x + dx * t.radius, 0, t.pos.z + dz * t.radius));
    }
  }

  private updateVisuals(dt: number): void {
    this.threatView.rimBoost = 1 + 0.9 * this.heatShown;
    this.threatView.update(this.threats, this.ctx.time);
    this.updatePlates(dt);
    waterUniforms.uWaterTime.value = this.ctx.time;
    this.updateAudio();
    this.updateStorm(dt);
    if (this.cape) {
      // gusty storm wind from the north-west, plus the air the warrior runs through
      const t = this.ctx.time;
      const gust = 0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1.3);
      const v = this.player.vel;
      const vl = Math.hypot(v.x, v.z);
      const vk = vl > 4 ? 4 / vl : 1;
      this.wind.set(0.8 * gust - v.x * vk, 0.0, 1.15 * gust - v.z * vk);
      this.cape.drape = this.flow === 'dying' || this.flow === 'dead' || this.player.state === 'down';
      this.cape.update(dt, this.wind);
    }
    // the seal wakes with the golem: its runes burn while it assembles, then settle to an ember
    if (this.arenaModel?.runes) {
      const gs = this.golem.state;
      const want = gs === 'assemble' ? 1.0 : gs === 'dormant' ? 0.12 : gs === 'dead' ? 0.03 : 0.05;
      const r = this.arenaModel.runes;
      r.emissiveIntensity += (want - r.emissiveIntensity) * Math.min(1, dt * 2);
    }
    const g = this.golem;
    this.updateMustSee();
    this.updateHeldRock();
    this.cam.wide = this.flow === 'fight' || this.flow === 'victoryCine' ? g.wantsWide : 0;
    this.cam.rise = this.flow === 'fight' ? g.wantsRise : 0;
    // airborne golem, or arms thrown at the sky for the meteor rain: frame its torso and head, the raised
    // arms may leave the frame (keeping them in pushed the camera so far back the warrior was a speck)
    this.cam.topParts = g.attack?.name === 'leap' ? this.leapParts : g.pos.y > 0.4 ? this.airborneParts : null;
    // the leap: frame the apex before it happens (the solve lagged a jump that takes 0.3 s to peak)
    const leaping = this.flow === 'fight' && g.attack?.name === 'leap' && (g.step === 'windup' || g.step === 'air');
    const rising = g.pos.y >= this.prevGolemY - 1e-4;
    this.cam.topBoost = !leaping ? 0 : g.step === 'windup' ? LEAP_APEX : rising ? Math.max(0, LEAP_APEX - g.pos.y) : 0;
    const shoving = this.flow === 'fight' && g.attack?.name === 'meteor' && (g.step === 'windup' || g.step === 'rain');
    this.cam.snappy = leaping ? 1 : shoving ? 0.6 : 0;
    // the telegraph is the golem's body: extra room while a big blow is wound up or a rock is in the air
    const bigWindup = this.flow === 'fight' && !!g.attack && g.step === 'windup' && ['slam', 'doubleSlam', 'throw', 'volley'].includes(g.attack.name);
    const meteorCall = this.flow === 'fight' && g.attack?.name === 'meteor';
    this.cam.maxPull = leaping ? 9 : meteorCall ? 5 : bigWindup || this.threats.rocks.length > 0 ? 4.5 : 3;
    // the leap and the meteor call keep clear sky above the golem (they were pinned against the top edge)
    this.cam.topMargin = leaping ? 0.2 : meteorCall ? 0.13 : 0.1;
    this.prevGolemY = g.pos.y;
    if (g.pushTele) {
      this.threats.telegraph(g.pushTele.pos, g.pushTele.radius, g.pushTele.dur, 'push');
      g.pushTele = null;
    }
    if (g.riseTele) {
      this.threats.telegraph(g.riseTele, balance.golem.stagger.risePushRadius, balance.golem.stagger.rise * 0.75, 'push');
      g.riseTele = null;
    }
    // a soft light that follows the warrior so they never vanish into the dark
    this.heroLight.position.set(this.player.pos.x, this.player.y + 2.8, this.player.pos.z);
    // burning ground: flames licking up from each patch (a few per patch, placed by its seed)
    if (this.pendingStrike > 0) {
      this.pendingStrike -= dt;
      if (this.pendingStrike <= 0) this.weather.strike(1);
    }
    this.fireSpots.length = 0;
    for (const hz of this.threats.hazards) {
      const armed = hz.t >= hz.arm;
      const warm = armed ? 1 : Math.max(0, 1 - (hz.arm - hz.t) / 1.0) * 0.35;
      const left = Math.min(1, Math.max(0, (hz.dur - hz.t - 0.3) / 0.7));
      const k = warm * left;
      if (k <= 0.02) continue;
      const n = Math.min(4, 1 + Math.round(hz.radius * 0.9));
      for (let j = 0; j < n && this.fireSpots.length < 24; j++) {
        const a = hz.seed * 3.7 + j * 2.399;
        const r = hz.radius * 0.62 * Math.sqrt(((hz.seed * 7.3 + j * 0.618) % 1 + 1) % 1);
        const vary = ((hz.seed * 1.618 + j * 0.713) % 1 + 1) % 1;
        this.fireSpots.push({ x: hz.pos.x + Math.cos(a) * r, z: hz.pos.z + Math.sin(a) * r, size: (0.7 + 0.8 * vary) * k * (j === 0 ? 1.3 : 1) });
      }
    }
    this.firePool.update(this.ctx.time, this.fireSpots);
    // burning ground casts real firelight on the stone, the golem and the warrior
    const burning = this.threats.hazards
      .filter((hz) => hz.t >= hz.arm - 1 && hz.dur - hz.t > 0.2)
      .sort((a, b) => a.pos.distanceToSquared(this.player.pos) - b.pos.distanceToSquared(this.player.pos));
    this.fireLights.forEach((l, i) => {
      const hz = burning[i];
      if (!hz) {
        l.intensity = 0;
        return;
      }
      const lit = hz.t >= hz.arm ? 1 : 0.35 * (1 - (hz.arm - hz.t));
      const fade = Math.min(1, (hz.dur - hz.t) / 0.6);
      const flick = 0.82 + 0.18 * Math.sin(this.ctx.time * 17 + i * 2.1) * Math.sin(this.ctx.time * 7.3 + i);
      l.position.set(hz.pos.x, 1.6, hz.pos.z);
      l.intensity = 12 * hz.radius * lit * fade * flick;
      l.distance = 5 + hz.radius * 3;
    });
    const camPos = this.cam.camera.position;
    setHeroLight(Math.hypot(camPos.x - this.player.pos.x, camPos.z - this.player.pos.z), this.flow === 'dying' || this.flow === 'dead' ? 1.3 : 1);
    // phase look: veins crack open in phase 2, molten in phase 3; the arena takes the lava light
    const dormant = g.state === 'dormant' || g.state === 'assemble';
    // the roar flares the veins; in death the glow bleeds out while the body falls apart
    const roarFlare = g.state === 'transition' ? Math.sin(Math.min(1, g.stateTime / 2.8) * Math.PI) : 0;
    const level = g.phase >= 3 ? 0.95 : g.phase >= 2 ? 1.0 : 0;
    const dying = g.state === 'dead' ? Math.max(0, 1 - Math.max(0, g.stateTime - 1.2) / 2.4) : 1;
    const crackWant = dormant ? 0 : (level + 0.9 * roarFlare) * dying;
    const heatWant = g.phase >= 3 ? dying : 0;
    this.crackShown += (crackWant - this.crackShown) * Math.min(1, dt * (g.state === 'transition' ? 3.5 : 3));
    this.heatShown += (heatWant - this.heatShown) * Math.min(1, dt * 1.2);
    this.roarFlare = roarFlare;
    golemLook.uCrack.value = this.crackShown;
    golemLook.uHeat.value = this.heatShown;
    golemLook.uTime.value = this.ctx.time;
    skyUniforms.uTime.value = this.ctx.time;
    heartUniforms.uHeartTime.value = this.ctx.time;
    skyUniforms.uLava.value = this.heatShown;
    const h = this.heatShown;
    this.hemi.color.setRGB(0.5 - 0.02 * h, 0.54 - 0.14 * h, 0.64 - 0.3 * h);
    // phase 3: lava light from below (the molten water) warms everything from the ground up
    this.hemi.groundColor.setRGB(0.173 + 0.1 * h, 0.153 + 0.01 * h, 0.137 - 0.04 * h);
    (this.scene.fog as THREE.FogExp2).color.setRGB(0.118 - 0.085 * h, 0.157 - 0.14 * h, 0.22 - 0.205 * h);
    // the far ridges go dark in phase 3 so they read as silhouettes against the molten horizon
    this.arenaModel?.cliffs.color.setRGB(0.33 - 0.17 * h, 0.34 - 0.2 * h, 0.376 - 0.23 * h, THREE.SRGBColorSpace);
    // camera-occlusion fade on the golem (off in cinematics and on the title)
    const gameplayCam = this.flow === 'fight' || this.flow === 'dying' || this.flow === 'victoryCine' || (this.flow === 'intro' && this.introQuick);
    setFade(this.cam.camera.position, _v.set(this.player.pos.x, this.player.y + 1.2, this.player.pos.z), false);
    propFadeUniforms.uFadeCam.value.copy(this.cam.camera.position);
    propFadeUniforms.uFadeFocus.value.copy(_v);
    propFadeUniforms.uFadeOn.value = this.flow === 'fight' ? 1 : 0;
    const gs = this.golem.state;
    const merged = !!this.golemMerge && (this.flow === 'fight' || this.flow === 'dying' || this.flow === 'dead') && gs !== 'dormant' && gs !== 'assemble' && gs !== 'dead';
    this.golemMerge?.use(merged);
    const fadeOn = (gameplayCam && this.cam.cineBlend < 0.5) || this.flow === 'dying' || this.flow === 'dead';
    // while the golem kneels the camera looks down past its limbs: fade anything within 5 m of the lens
    const deathCam = this.flow === 'dying' || this.flow === 'dead';
    const near = deathCam ? 6 : this.golem.staggered ? 5 : 2.2;
    (merged && this.faderMerged ? this.faderMerged : this.fader).update(this.cam.camera.position, _v, dt, fadeOn, fadeOn ? this.findBlockers(this.cam.camera.position) : undefined, near);
    // teach the punish window the first few times it opens (never while a warning covers the warrior)
    const underThreat = this.threats.fissures.length > 0 || this.threats.telegraphs.some((t) => {
      if (t.kind === 'sector') return true;
      return Math.hypot(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z) < t.radius + 1;
    });
    if (underThreat && !this.tips.quiet) this.tips.hush();
    this.tips.quiet = underThreat;
    // STRIKE = hit here now: a reachable core in an open window, with no warning or shockwave on the way
    const pp = this.player.pos;
    const waveComing = this.threats.waves.some((w) => {
      const d = Math.hypot(w.center.x - pp.x, w.center.z - pp.z);
      return w.r < d + 1.5 && d < w.maxR;
    });
    const danger = underThreat || waveComing;
    const fighting = this.flow === 'fight' && (g.state === 'combat' || g.state === 'stagger');
    if (fighting && g.staggered) {
      let best: (typeof g.targets)[number] | null = null;
      for (const t of g.targets) {
        if (!t.open || t.kind === 'arm') continue;
        if (!best || t.pos.distanceTo(this.player.pos) < best.pos.distanceTo(this.player.pos)) best = t;
      }
      this.hud.markCore = best;
    } else if (fighting) {
      const arm = g.focusCore(this.player.pos);
      this.hud.markCore = arm && arm.kind === 'arm' && arm.pos.y < REACH && g.windowOpen && !danger ? arm : null;
      if (this.hud.markCore) {
        this.tips.show('window', 'Its fist is stuck: strike the <b class="core">glowing core</b> on its arm!', 3, 3.5);
      }
    } else this.hud.markCore = null;
    this.updateStrikeSpot(null, dt); // the floor ring under the back core is gone: the STRIKE tag and the shaft say enough
    this.updateCoreBeam(g.staggered && this.flow === 'fight' ? this.hud.markCore : null);
    // death: the Ruin falls back into rubble
    if (g.state === 'dead') {
      if (this.crumbleT < 0 && g.stateTime > 0.8) {
        this.crumbleT = 0;
        this.assembler.setCenter(g.pos);
      }
      if (this.crumbleT >= 0) {
        this.crumbleT += dt;
        this.assembler.apply(1 - Math.min(1, this.crumbleT / 2.4), this.ctx.time);
      }
    } else this.crumbleT = -1;
    let cyanBest: THREE.Mesh | null = null;
    let cyanWant = 0;
    let cyanPrio = -1;
    for (const t of g.targets) {
      const mesh = this.coreMeshes.get(t.name);
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const lit = g.state !== 'dormant' && (g.state !== 'assemble' || g.step === 'roar' || g.step === 'roarHold' || g.step === 'settle');
      let base = t.kind === 'back' ? (t.open ? 2.4 : 0) : !lit ? 0 : 1.1 + 0.25 * (g.phase - 1);
      if (t.kind === 'arm' && g.staggered) base *= 0.35; // the back core is the one to go for
      const marked = this.hud.markCore === t;
      if (t.kind === 'arm' && !g.staggered) base *= marked ? 1.45 : t.pos.y < REACH ? 1.0 : 0.8; // STRIKE: bright pulse; otherwise steady
      if (g.state === 'dead') base = Math.max(0.0, base * (1 - g.stateTime / 0.25));
      const low = marked || (t.kind !== 'arm' && t.open && g.state !== 'dead');
      const pulse = low ? 1.15 + 0.45 * Math.sin(this.ctx.time * 9) : 1;
      mat.emissiveIntensity = base * pulse + t.flash * 3;
      const halo = mesh.getObjectByName('core_halo') as THREE.Sprite | undefined;
      if (halo) (halo.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.35 * base * pulse + t.flash);
      // sealed cores are plain stone knobs, not dim teal balls; arm cores ignite at the roar
      mat.color.setHex(base > 0.05 ? 0x0a2a30 : 0x80848c);
      mesh.visible = t.kind === 'back' ? t.open || t.flash > 0.05 : lit && !g.staggered;
      if (g.state === 'dead' && g.stateTime > 0.3) mesh.visible = false; // spent cores crumble with the body
      if (t.kind !== 'chest' && mesh.visible) {
        const want = (base * pulse * 0.6 + t.flash * 1.5) * 3.2;
        const prio = (marked ? 4 : 0) + (t.kind === 'back' && t.open ? 3 : 0) + t.flash * 2 + 1 / (1 + t.pos.distanceTo(this.player.pos));
        if (want > 0 && prio > cyanPrio) {
          cyanPrio = prio;
          cyanWant = want;
          cyanBest = mesh;
        }
      }
    }
    const cyan = this.coreLights.get('cyan');
    if (cyan) {
      cyan.intensity = cyanWant * 0.7;
      if (cyanBest) {
        cyanBest.getWorldPosition(cyan.position);
        cyan.position.y += 1.2;
      }
    }
    const eyeMat = this.golemEyes[0]?.material as THREE.MeshStandardMaterial | undefined;
    const eyeOn = (this.assets ? 2.1 : 2.0) * (g.phase >= 3 ? 1.7 : 1);
    if (eyeMat) eyeMat.emissiveIntensity = g.state === 'dead' ? Math.max(0, eyeOn * (1 - Math.max(0, g.stateTime - 1.0) / 0.8)) : g.state === 'dormant' ? 0 : g.staggered ? eyeOn * (0.22 + 0.12 * Math.sin(this.ctx.time * 11) * Math.sin(this.ctx.time * 3.7)) : eyeOn * (1 + 1.4 * this.roarFlare);
    const chest = this.coreMeshes.get('core_chest');
    // phase 3: while the heart burns out of reach, remind the player how to get at it (in the tip strip)
    const heartT = g.targets.find((t) => t.kind === 'chest');
    if (g.phase >= 3 && this.flow === 'fight') {
      this.phase3Time += dt;
      if (heartT && !heartT.open && this.player.locked && this.phase3Time > 6 && this.phase3Time < 60) {
        this.tips.show('heart', 'Its molten <b>heart</b> is out of reach: bring it to its <b>knees</b> first.', 2, 4.5);
      }
    } else if (g.phase < 3) this.phase3Time = 0;
    if (chest) {
      // in death the molten heart flares once and dies with the body
      const deadGlow = g.state === 'dead' ? Math.max(0, 1 - Math.max(0, g.stateTime - 1.0) / 1.2) : 1;
      const on = g.phase >= 3 && g.state !== 'dormant' ? deadGlow : 0;
      const ct = g.targets.find((t) => t.kind === 'chest');
      const mat = chest.material as THREE.MeshStandardMaterial;
      // the burst chest shows a big molten core, white-hot at its heart; it turns cyan only when it can be struck
      mat.emissive.setHex(ct?.open ? 0x5ff0ff : 0xff7a24);
      mat.emissiveIntensity = on * ((ct?.open ? 2.4 : 2.6) + 0.35 * Math.sin(this.ctx.time * 4.2)) + (ct?.flash ?? 0) * 5;
      chest.visible = on > 0;
      chest.scale.setScalar(ct?.open ? 1.5 : 1.3 + 0.05 * Math.sin(this.ctx.time * 4.2));
      const heartHalo = chest.getObjectByName('core_halo') as THREE.Sprite | undefined;
      if (heartHalo) {
        const hm = heartHalo.material as THREE.SpriteMaterial;
        hm.color.setHex(ct?.open ? 0x5ff0ff : 0xff6a1c);
        hm.opacity = on * (ct?.open ? 0.55 : 0.62 + 0.12 * Math.sin(this.ctx.time * 4.2));
      }
      const l = this.coreLights.get('core_chest');
      if (l) {
        // the heart lights its own chest and the stone around it; the floor gets the molten pool below
        chest.getWorldPosition(l.position);
        l.position.x += Math.sin(g.yaw) * 2.5;
        l.position.z += Math.cos(g.yaw) * 2.5;
        l.color.setHex(0xff6a20);
        l.intensity = on * (ct?.open ? 160 : 110) * (0.9 + 0.1 * Math.sin(this.ctx.time * 4.2));
      }
      // molten light pooling on the floor around its feet (a soft glow, no hot spot)
      const pool = this.threatView.lavaPool;
      pool.visible = on > 0.01;
      if (pool.visible) {
        pool.position.x = g.pos.x + Math.sin(g.yaw) * 2;
        pool.position.z = g.pos.z + Math.cos(g.yaw) * 2;
        const pm = pool.material as THREE.ShaderMaterial;
        pm.uniforms.uAlpha.value = 0.4 * on * this.heatShown;
        pm.uniforms.uTime.value = this.ctx.time;
      }
    }
    void dt;
  }
}
