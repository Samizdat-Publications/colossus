import * as THREE from 'three';
import { balance } from '../core/balance';
import { bus } from '../core/events';
import { Input, type InputFrame } from '../core/input';
import { clamp, damp, ease, lerp, smoothstep } from '../core/math';
import { Rig } from '../anim/rig';
import GOLEM_RIG from '../data/golem_rig.json';
import WARRIOR_RIG from '../data/warrior_rig.json';
import { Player } from './player';
import { Golem } from './golem';
import { ARENA, World } from './world';
import { Threats } from './threats';
import type { FightContext } from './context';
import { Renderer } from '../render/renderer';
import { CameraRig } from '../render/cameraRig';
import { ThreatView } from '../render/threatView';
import { buildGreyboxArena } from '../render/arenaGreybox';
import { buildGreyboxGolem, buildGreyboxWarrior } from '../render/greybox';
import { Assembler } from '../render/assembler';
import { setFade } from '../render/fade';
import { golemLook, makeVeinTexture } from '../render/stoneMaterial';
import { PartFader } from '../render/partFader';
import { createSky, skyUniforms } from '../render/sky';
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
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

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
  private readonly coreLights = new Map<string, THREE.PointLight>();
  private readonly golemParts: THREE.Mesh[];
  private readonly fader: PartFader;
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

  constructor(
    readonly container: HTMLElement,
    readonly opts: GameOptions,
  ) {
    this.cam = new CameraRig(window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(container, this.scene, this.cam.camera);
    this.input = new Input(this.renderer.canvas);

    // atmosphere: moon behind the golem (rim light, shadow toward the player), cool fill, sky dome
    this.scene.background = new THREE.Color(0x0a0e16);
    this.scene.fog = new THREE.FogExp2(0x1e2838, 0.0105);
    this.scene.add(createSky());
    golemLook.uCrackMap.value = makeVeinTexture();
    this.hemi = new THREE.HemisphereLight(0x8196bb, 0x2c2723, 1.35);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xc4d2ee, 2.3);
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

    buildGreyboxArena(this.scene);
    this.scene.add(this.threatView.group);

    const pRig = Rig.fromJoints(WARRIOR_RIG.bones);
    buildGreyboxWarrior(pRig);
    this.scene.add(pRig.root);
    this.player = new Player(pRig);

    const gRig = Rig.fromJoints(GOLEM_RIG.bones);
    const gb = buildGreyboxGolem(gRig);
    this.coreMeshes = gb.cores;
    this.golemParts = gb.parts;
    this.scene.add(gRig.root);
    this.golem = new Golem(gRig);
    for (const [name, mesh] of this.coreMeshes) {
      const light = new THREE.PointLight(name === 'core_chest' ? 0xff6a20 : 0x5fe8ff, 0, 14, 2);
      mesh.add(light);
      this.coreLights.set(name, light);
    }
    const home = new THREE.Vector3(ARENA.golemHome[0], 0, ARENA.golemHome[1]);
    this.golem.reset(home.x, home.z, 0);
    this.assembler = new Assembler([...this.golemParts, ...this.coreMeshes.values()], home);
    this.fader = new PartFader(this.golemParts);

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
    this.screens = new Screens(ui, {
      begin: () => this.begin(),
      resume: () => this.resume(),
      retry: () => this.retry(),
      title: () => this.toTitle(),
    });

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
      this.hud.bossVisible = true;
      if (e.phase === 2) this.tips.show('phase2', 'The Ruin cracks open. It is faster now.', 1, 4);
      if (e.phase === 3) this.tips.show('phase3', 'Its core is molten. Watch the sky.', 1, 4);
    });
    bus.on('hazardBurn', () => this.tips.show('burn', 'The cracked floor <b>burns</b>. Step out of it.', 2, 3.5));
  }

  // ------------------------------------------------------------------ flow

  private setFlow(f: Flow): void {
    this.flow = f;
    this.flowTime = 0;
  }

  toTitle(): void {
    this.paused = false;
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
    this.hud.showControls = this.attempt === 1;
    this.controlsTimer = this.attempt === 1 ? 15 : 0;
    bus.emit('fightStart', { attempt: this.attempt });
    if (this.attempt === 1) this.tips.show('start', 'Only the <b class="core">glowing cores</b> can be harmed.', 1, 4);
  }
  private controlsTimer = 0;

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.screens.show('pause');
    this.input.exitPointerLock();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.screens.show('none');
    if (!this.opts.test) this.input.requestPointerLock();
    this.last = performance.now();
  }

  private onPlayerDeath(): void {
    if (this.flow !== 'fight') return;
    this.tips.dismiss('lock');
    this.hitstop = Math.max(this.hitstop, 0.22);
    this.setFlow('dying');
    this.slowmo = 0.35;
    this.slowmoTimer = 1.3;
    this.player.control = false;
    this.ctx.live = false;
    this.screenDelay = balance.fight.deathScreenDelay;
  }

  private onGolemDeath(): void {
    if (this.flow !== 'fight') return;
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
    };
  }

  // ------------------------------------------------------------------ loop

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
    this.hud.update(rawDt, this.player, this.golem, this.cam.camera, window.innerWidth, window.innerHeight);
    this.renderer.render(rawDt);
    if (this.fpsEl) this.fpsEl.textContent = `${this.frameMs.toFixed(1)} ms`;
  }

  private handleUiInput(f: InputFrame): void {
    if (this.screens.current !== 'none' && this.screens.current !== 'loading') {
      const canConfirm = this.flowTime > 0.5 || this.paused;
      this.screens.nav(f.pressed.up, f.pressed.down, canConfirm && f.pressed.confirm);
      if (this.paused && f.pressed.pause && this.flowTime > 0) this.resume();
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
        cam.orbit(rawDt, _v.set(0, 3, ARENA.golemHome[1]), 30, 10, 0.05);
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
          if (t >= 8.2) {
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
          this.victoryShot();
          cam.cineBlend = damp(cam.cineBlend, 1, 2.2, rawDt);
        } else if (this.flow === 'dying') {
          this.deathShot();
          cam.cineBlend = damp(cam.cineBlend, 1, 3.5, rawDt);
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
        if (this.flow === 'dead') this.deathShot();
        cam.update(rawDt, 0, 0, this.player, this.golem, this.world);
        break;
      default:
        break;
    }
    void dt;
  }

  /** After death: rise slowly over the fallen warrior with the Ruin looming behind. */
  private deathShot(): void {
    const c = this.cam.cine;
    const p = this.player.pos;
    const g = this.golem.pos;
    let dx = p.x - g.x;
    let dz = p.z - g.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const t = Math.min(1, this.flowTime / 4);
    const a = 0.75 + 0.2 * t;
    const rx = dx * Math.cos(a) - dz * Math.sin(a);
    const rz = dx * Math.sin(a) + dz * Math.cos(a);
    // stand back from the midpoint so both the body and the whole golem are in frame
    const mx = (p.x + g.x) / 2;
    const mz = (p.z + g.z) / 2;
    const back = Math.max(14, l * 0.9 + 12) + 4 * t;
    let px = mx + rx * back;
    let pz = mz + rz * back;
    const d = Math.hypot(px, pz);
    if (d > 36) {
      px *= 36 / d;
      pz *= 36 / d;
    }
    c.pos.set(px, 4.5 + 2 * t, pz);
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
    c.look.set(mx, 4.5, mz);
    c.fov = 58;
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
    // swing 35 degrees off the player's line so the collapse reads in three quarters
    const a = 0.6;
    const rx = dx * Math.cos(a) - dz * Math.sin(a);
    const rz = dx * Math.sin(a) + dz * Math.cos(a);
    let px = g.x + rx * 30;
    let pz = g.z + rz * 30;
    const d = Math.hypot(px, pz);
    if (d > 36) {
      px *= 36 / d;
      pz *= 36 / d;
    }
    c.pos.set(px, 8.5, pz);
    c.look.set(g.x, 4.5, g.z);
    c.fov = 50;
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
      c.pos.set(p.x + lerp(2.4, 0.8, u), lerp(2.0, 2.6, u), p.z + lerp(3.2, 6, u));
      this.golem.lockPoint(c.look);
      c.look.y = lerp(9, 6, u);
      c.fov = 58;
    }
  }

  private crumbleT = -1;
  private heroLight: THREE.PointLight | null = null;
  private heldRockMesh: THREE.Mesh | null = null;

  private updateHeldRock(): void {
    const side = this.golem.heldRock;
    if (!this.heldRockMesh) {
      this.heldRockMesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.5, 0),
        new THREE.MeshStandardMaterial({ color: 0x5a554e, roughness: 0.92, flatShading: true, emissive: 0xff4a10, emissiveIntensity: 0.3 }),
      );
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
    for (const t of this.threats.telegraphs) {
      if (t.kind === 'sector') continue;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
      if (d > t.radius + 1.2) continue; // only rings the warrior is in (or about to be) are hard constraints
      let dx = cam.x - t.pos.x;
      let dz = cam.z - t.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      must.push(new THREE.Vector3(t.pos.x + dx * t.radius, 0, t.pos.z + dz * t.radius));
    }
  }

  private updateVisuals(dt: number): void {
    this.threatView.update(this.threats, this.ctx.time);
    const g = this.golem;
    this.updateMustSee();
    this.updateHeldRock();
    this.cam.wide = this.flow === 'fight' || this.flow === 'victoryCine' ? g.wantsWide : 0;
    this.cam.rise = this.flow === 'fight' ? g.wantsRise : 0;
    if (g.riseTele) {
      this.threats.telegraph(g.riseTele, balance.golem.stagger.risePushRadius, balance.golem.stagger.rise * 0.75, 'push');
      g.riseTele = null;
    }
    // a soft light that follows the warrior so they never vanish into the dark
    if (!this.heroLight) {
      this.heroLight = new THREE.PointLight(0xc8d8ff, 7, 8, 2);
      this.scene.add(this.heroLight);
    }
    this.heroLight.position.set(this.player.pos.x, this.player.y + 2.8, this.player.pos.z);
    // phase look: veins crack open in phase 2, molten in phase 3; the arena takes the lava light
    const dormant = g.state === 'dormant' || g.state === 'assemble';
    const crackWant = g.state === 'dead' ? 0 : dormant ? 0 : g.phase >= 3 ? 1.0 : g.phase >= 2 ? 0.6 : 0;
    const heatWant = g.state === 'dead' ? 0 : g.phase >= 3 ? 1 : 0;
    this.crackShown += (crackWant - this.crackShown) * Math.min(1, dt * (g.state === 'transition' ? 1.4 : 3));
    this.heatShown += (heatWant - this.heatShown) * Math.min(1, dt * 1.2);
    golemLook.uCrack.value = this.crackShown;
    golemLook.uHeat.value = this.heatShown;
    golemLook.uTime.value = this.ctx.time;
    skyUniforms.uTime.value = this.ctx.time;
    skyUniforms.uLava.value = this.heatShown;
    this.hemi.color.setRGB(0.506 + 0.12 * this.heatShown, 0.588 - 0.06 * this.heatShown, 0.733 - 0.2 * this.heatShown);
    // phase 3: lava light from the cracks warms the floor
    this.hemi.groundColor.setRGB(0.173 + 0.28 * this.heatShown, 0.153 + 0.06 * this.heatShown, 0.137 - 0.05 * this.heatShown);
    // camera-occlusion fade on the golem (off in cinematics and on the title)
    const gameplayCam = this.flow === 'fight' || this.flow === 'dying' || this.flow === 'victoryCine' || (this.flow === 'intro' && this.introQuick);
    setFade(this.cam.camera.position, _v.set(this.player.pos.x, this.player.y + 1.2, this.player.pos.z), false);
    this.fader.update(this.cam.camera.position, _v, dt, gameplayCam);
    // teach the punish window the first few times it opens (never while a warning covers the warrior)
    const underThreat = this.threats.fissures.length > 0 || this.threats.telegraphs.some((t) => {
      if (t.kind === 'sector') return true;
      return Math.hypot(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z) < t.radius + 1;
    });
    if (underThreat && !this.tips.quiet) this.tips.hush();
    this.tips.quiet = underThreat;
    if (this.flow === 'fight' && g.windowOpen && !underThreat) {
      if (g.staggered) {
        let best: (typeof g.targets)[number] | null = null;
        for (const t of g.targets) {
          if (!t.open || t.kind === 'arm') continue;
          if (!best || t.pos.distanceTo(this.player.pos) < best.pos.distanceTo(this.player.pos)) best = t;
        }
        this.hud.markCore = best;
      }
      else {
        const arm = g.focusCore(this.player.pos);
        this.hud.markCore = arm && arm.pos.y < 3.4 ? arm : null;
        if (this.hud.markCore) this.tips.show('window', 'Its fist is stuck: strike the <b class="core">glowing core</b> on its arm!', 3, 3.5);
      }
    } else this.hud.markCore = null;
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
    for (const t of g.targets) {
      const mesh = this.coreMeshes.get(t.name);
      if (!mesh) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const lit = g.state !== 'dormant' && (g.state !== 'assemble' || g.step === 'roar' || g.step === 'roarHold' || g.step === 'settle');
      let base = t.kind === 'back' ? (t.open ? 2.4 : 0) : !lit ? 0 : 1.5 + 0.35 * (g.phase - 1);
      if (t.kind === 'arm' && g.staggered) base *= 0.35; // the back core is the one to go for
      if (g.state === 'dead') base = Math.max(0.0, base * (1 - g.stateTime / 0.25));
      const low = t.open && t.pos.y < 3.4 && g.state !== 'dead';
      const pulse = low ? 1.15 + 0.45 * Math.sin(this.ctx.time * 9) : 1;
      mat.emissiveIntensity = base * pulse + t.flash * 5;
      // sealed cores are dark stone sockets, not dim teal balls; arm cores ignite at the roar
      mat.color.setHex(base > 0.05 ? 0x0a2a30 : 0x1b1d22);
      mesh.visible = t.kind === 'back' ? g.state !== 'dormant' && g.state !== 'assemble' : lit;
      const light = this.coreLights.get(t.name);
      if (light) light.intensity = (base * pulse * 0.6 + t.flash * 3) * 6;
    }
    const chest = this.coreMeshes.get('core_chest');
    if (chest) {
      const on = g.phase >= 3 && g.state !== 'dormant' && g.state !== 'dead' ? 1 : 0;
      const ct = g.targets.find((t) => t.kind === 'chest');
      const mat = chest.material as THREE.MeshStandardMaterial;
      // molten (orange) while sealed away up high; it turns cyan only when it can be struck
      mat.emissive.setHex(ct?.open ? 0x5ff0ff : 0xff5a14);
      mat.emissiveIntensity = on * ((ct?.open ? 2.4 : 0.9) + 0.3 * Math.sin(this.ctx.time * 5)) + (ct?.flash ?? 0) * 5;
      chest.visible = on > 0;
      chest.scale.setScalar(1.5);
      const l = this.coreLights.get('core_chest');
      if (l) {
        l.color.setHex(0xff6a20);
        l.intensity = on * 70;
      }
    }
    void dt;
  }
}
