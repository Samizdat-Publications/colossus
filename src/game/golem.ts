import * as THREE from 'three';
import { balance, perPhase } from '../core/balance';
import { bus } from '../core/events';
import { angleDiff, clamp, DEG, ease, rng, rotateToward, yawToDir, lerp, segSegDist2 } from '../core/math';
import { Animator, Pose, type Step } from '../anim/pose';
import type { Rig } from '../anim/rig';
import { solveTwoBone } from '../anim/ik';
import { buildGolemPoses, golemBreath, golemWalk, type GolemPoses } from '../anim/golemPoses';
import GOLEM_RIG from '../data/golem_rig.json';
import type { Capsule, FightContext, GolemTarget, SwordHit, SwordResult } from './context';
import { PLAYER_RADIUS } from './player';

export type GolemState = 'dormant' | 'assemble' | 'combat' | 'stagger' | 'transition' | 'dead';
export type AttackName =
  | 'slam'
  | 'sweep'
  | 'stomp'
  | 'throw'
  | 'doubleSlam'
  | 'volley'
  | 'sweepCombo'
  | 'leap'
  | 'doubleStomp'
  | 'meteor';
type Side = 'L' | 'R';

interface CoreInfo extends GolemTarget {
  bone: number;
  rest: THREE.Vector3;
  flash: number;
  glow: number;
}

interface IKGoal {
  target: THREE.Vector3;
  weight: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const STRIDE = 9.0; // metres per full walk cycle

export class Golem {
  readonly anim: Animator;
  readonly poses: GolemPoses;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  hp = 2000;
  phase = 1;
  pendingPhase = 0;
  breakMeter = 0;
  private sinceCoreHit = 99;
  state: GolemState = 'dormant';
  stateTime = 0;
  attack: { name: AttackName; side: Side | '' } | null = null;
  private cooldown = 2;
  private history: AttackName[] = [];
  private meteorCooldown = 12;
  private walkTimer = 0;
  private gait = 0;
  private walkAmount = 0;
  private turnAmount = 0;
  private time = 0;
  /** Seconds the golem has been standing still since its last attack (for bot/tests). */
  readonly targets: CoreInfo[] = [];
  readonly capsules: Capsule[] = [];
  private readonly ik: Record<Side, IKGoal | null> = { L: null, R: null };
  private readonly fistRest: Record<string, THREE.Vector3> = {};
  heldRock: Side | '' = '';
  /** 0..1 intro assembly progress, driven by the fight director. */
  assemble = 0;
  lastDamageTime = -10;
  invulnerable = false;
  readonly stats = { staggers: 0 };
  onTransitionVisual: ((phase: number) => void) | null = null;

  constructor(readonly rig: Rig) {
    this.anim = new Animator(rig);
    this.poses = buildGolemPoses(rig);
    for (const c of GOLEM_RIG.cores) {
      const bone = rig.i(c.bone);
      this.targets.push({
        name: c.name,
        kind: c.kind as 'arm' | 'back' | 'chest',
        pos: new THREE.Vector3(),
        radius: c.radius,
        open: c.kind === 'arm',
        bone,
        rest: new THREE.Vector3().fromArray(c.pos),
        flash: 0,
        glow: 1,
      });
    }
    for (let i = 0; i < rig.count; i++) {
      this.capsules.push({ name: rig.names[i], a: new THREE.Vector3(), b: new THREE.Vector3(), r: rig.radius[i] });
    }
    this.measureFists();
  }

  get G() {
    return balance.golem;
  }
  get A() {
    return balance.golem.attacks;
  }
  get maxHp(): number {
    return this.G.maxHealth;
  }
  get healthFrac(): number {
    return clamp(this.hp / this.maxHp, 0, 1);
  }
  get breakFrac(): number {
    return clamp(this.breakMeter / this.G.breakMeter, 0, 1);
  }
  get lockable(): boolean {
    return this.state !== 'dead' && this.state !== 'dormant';
  }
  get alive(): boolean {
    return this.state !== 'dead';
  }
  get staggered(): boolean {
    return this.state === 'stagger';
  }
  /** Timing multiplier for attacks in the current phase (lower = faster). */
  private get k(): number {
    return perPhase(this.G.timingScale, this.phase);
  }

  core(name: string): CoreInfo | undefined {
    return this.targets.find((t) => t.name === name);
  }

  /** Natural fist positions (golem-local) in the strike poses, used to aim slams. */
  private measureFists(): void {
    const measure = (pose: Pose, side: Side): THREE.Vector3 => {
      pose.applyTo(this.rig);
      this.rig.root.position.set(0, 0, 0);
      this.rig.root.rotation.set(0, 0, 0);
      this.rig.update();
      return this.rig.tailWorld(this.rig.i(`hand_${side}`), new THREE.Vector3());
    };
    this.fistRest.slam_L = measure(this.poses.slamHit_L, 'L');
    this.fistRest.slam_R = measure(this.poses.slamHit_R, 'R');
    this.fistRest.double_L = measure(this.poses.doubleHit, 'L');
    this.fistRest.double_R = measure(this.poses.doubleHit, 'R');
    this.fistRest.brace_L = measure(this.poses.brace, 'L');
    this.fistRest.brace_R = measure(this.poses.brace, 'R');
    this.poses.idle.applyTo(this.rig);
  }

  reset(x: number, z: number, yaw: number): void {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.hp = this.maxHp;
    this.phase = 1;
    this.pendingPhase = 0;
    this.breakMeter = 0;
    this.sinceCoreHit = 99;
    this.state = 'dormant';
    this.stateTime = 0;
    this.attack = null;
    this.cooldown = 2.2;
    this.history = [];
    this.meteorCooldown = 12;
    this.walkTimer = 0;
    this.ik.L = this.ik.R = null;
    this.heldRock = '';
    this.invulnerable = false;
    this.stats.staggers = 0;
    this.anim.seq = null;
    this.anim.out.copy(this.poses.dormant);
    this.anim.base.copy(this.poses.dormant);
    this.anim.out.applyTo(this.rig);
    for (const t of this.targets) {
      t.flash = 0;
      t.glow = 0;
    }
    this.syncRig();
    this.updateDerived();
  }

  private setState(s: GolemState): void {
    this.state = s;
    this.stateTime = 0;
  }

  // ------------------------------------------------------------------ intro

  /** Play the rise-and-roar after the rubble has flown together. */
  beginAssemble(holdTime: number, quick: boolean): void {
    this.setState('assemble');
    this.anim.out.copy(this.poses.dormant);
    const P = this.poses;
    const steps: Step[] = [
      { name: 'gather', dur: holdTime, pose: P.dormant },
      { name: 'rise', dur: quick ? 0.8 : 1.5, pose: P.pushUp, ease: 'inOutSine' },
      { name: 'stand', dur: quick ? 0.5 : 0.9, pose: P.idle, ease: 'outQuad' },
      {
        name: 'roar',
        dur: quick ? 0.5 : 0.7,
        pose: P.roar,
        ease: 'outBack',
        enter: () => bus.emit('roar', { pos: this.pos, phase: 0 }),
      },
      { name: 'roarHold', dur: quick ? 0.4 : 1.3, pose: P.roar },
      { name: 'settle', dur: 0.7, pose: P.idle, ease: 'inOutSine' },
    ];
    this.anim.play(steps);
  }

  // ------------------------------------------------------------------ damage

  receiveSwordHit(h: SwordHit): SwordResult {
    if (this.state === 'dead' || this.state === 'dormant' || this.state === 'assemble' || this.state === 'transition' || this.invulnerable) {
      return 'deflect';
    }
    const G = this.G;
    if (h.kind === 'core' && h.core) {
      const core = h.core as CoreInfo;
      let mult = G.coreDamageMultiplier;
      let crit = false;
      if (core.kind === 'arm') mult *= G.armCoreDamageMultiplier;
      if (core.kind === 'back' || core.kind === 'chest') {
        if (!this.staggered) return 'deflect';
        mult *= G.stagger.backCoreMultiplier;
        crit = true;
      }
      const dmg = h.damage * mult;
      core.flash = 1;
      this.applyDamage(dmg);
      this.sinceCoreHit = 0;
      if (!this.staggered && (this.state as GolemState) !== 'dead') {
        this.breakMeter += h.breakAmount;
        if (this.breakMeter >= G.breakMeter) this.startStagger();
      }
      bus.emit('coreHit', { pos: h.pos, damage: dmg, core: core.name, crit, heavy: h.heavy, normal: h.normal });
      return crit ? 'crit' : 'core';
    }
    if (this.staggered) {
      const dmg = h.damage * G.stagger.bodyDamageMultiplier;
      this.applyDamage(dmg);
      bus.emit('bodyHit', { pos: h.pos, damage: dmg, heavy: h.heavy, normal: h.normal });
      return 'body';
    }
    return 'deflect';
  }

  private applyDamage(d: number): void {
    const max = this.maxHp;
    const th = this.G.phaseThresholds;
    this.lastDamageTime = this.time;
    // A phase can never be skipped: HP is clamped just above the next threshold until the transition.
    let floor = 0;
    if (this.phase === 1) floor = th[1] * max + 1;
    else if (this.phase === 2) floor = 1;
    this.hp = Math.max(floor, this.hp - d);
    const next = this.phase === 1 ? th[0] : this.phase === 2 ? th[1] : -1;
    if (next > 0 && this.hp <= next * max && this.pendingPhase <= this.phase) this.pendingPhase = this.phase + 1;
    if (this.phase === 3 && this.hp <= 0) this.die();
  }

  // ------------------------------------------------------------------ states

  private cancelAttack(): void {
    this.attack = null;
    this.leapTarget = null;
    this.pos.y = 0;
    this.ik.L = this.ik.R = null;
    if (this.heldRock) this.heldRock = '';
  }

  private startStagger(): void {
    this.cancelAttack();
    this.breakMeter = 0;
    this.stats.staggers++;
    this.setState('stagger');
    const S = this.G.stagger;
    const P = this.poses;
    bus.emit('staggerStart', { pos: this.pos });
    this.anim.play([
      { name: 'collapse', dur: S.collapse * 0.55, pose: P.pushUp, ease: 'inQuad' },
      { name: 'drop', dur: S.collapse * 0.45, pose: P.kneel, ease: 'outCubic', exit: () => bus.emit('slamImpact', { pos: this.pos.clone(), radius: 5, big: false }) },
      {
        name: 'down',
        dur: S.duration,
        pose: (out, t) => {
          out.blend(P.kneel, P.kneelSlump, Math.min(1, t * 3));
          golemBreath(out, this.rig, this.time * 1.6, 1.5);
        },
      },
      {
        name: 'rise',
        dur: S.rise * 0.75,
        pose: P.pushUp,
        ease: 'inOutSine',
        enter: () => {
          bus.emit('golemWindup', { attack: 'rise', duration: S.rise * 0.75, pos: this.pos });
          this.riseTele = this.pos.clone();
        },
      },
      {
        name: 'push',
        dur: S.rise * 0.25,
        pose: P.idle,
        ease: 'outQuad',
        enter: () => this.pushWave(S.risePushRadius, S.risePushForce, S.risePushDamage),
      },
    ]);
  }

  private startTransition(ctx: FightContext): void {
    this.cancelAttack();
    const T = this.G.transition;
    this.phase = this.pendingPhase;
    this.pendingPhase = 0;
    this.breakMeter = 0;
    this.setState('transition');
    const P = this.poses;
    bus.emit('phaseChange', { phase: this.phase });
    this.onTransitionVisual?.(this.phase);
    this.anim.play([
      { name: 'rear', dur: T.pushAt, pose: P.roar, ease: 'outCubic', enter: () => bus.emit('roar', { pos: this.pos, phase: this.phase }) },
      {
        name: 'roar',
        dur: T.duration - T.pushAt - 0.8,
        pose: (out, t) => {
          out.copy(P.roar);
          const s = Math.sin(this.time * 38) * 1.2 * (1 - t);
          out.addEuler(this.rig.i('chest'), s, 0, s * 0.5);
        },
        enter: () => this.pushWave(T.pushRadius, T.pushForce, 0),
      },
      { name: 'settle', dur: 0.8, pose: P.idle, ease: 'inOutSine' },
    ]);
    void ctx;
  }

  private die(): void {
    this.cancelAttack();
    this.hp = 0;
    this.setState('dead');
    const P = this.poses;
    bus.emit('golemDeath', { pos: this.pos.clone() });
    this.anim.play([
      { name: 'stagger', dur: 0.4, pose: P.pushUp, ease: 'outCubic' },
      { name: 'collapse', dur: 0.8, pose: P.kneel, ease: 'inQuad' },
      { name: 'slump', dur: 1.6, pose: P.dormant, ease: 'inOutSine' },
      { name: 'still', dur: 1000, pose: P.dormant },
    ]);
  }

  /** Fraction of the stagger opening left (1 -> 0) while down, -1 otherwise. */
  get staggerLeft(): number {
    if (this.state !== 'stagger') return -1;
    const S = this.G.stagger;
    const total = S.collapse + S.duration;
    return Math.max(0, 1 - this.stateTime / total);
  }

  /** How much higher the camera should sit right now (look down on a kneeling golem). */
  get wantsRise(): number {
    if (this.state === 'stagger') return 2.2;
    // a low camera looks up at the airborne golem (the classic colossus angle)
    if (this.attack?.name === 'leap' && (this.step === 'air' || (this.step === 'windup' && this.pos.y > 0.2))) return -1.8;
    return 0;
  }

  /** How much wider the camera should frame right now (leap, stagger). */
  get wantsWide(): number {
    if (this.attack?.name === 'leap' && (this.step === 'windup' || this.step === 'air' || this.step === 'land')) return 4;
    if (this.state === 'stagger') return 4.5;
    if (this.state === 'dead') return 3;
    // the phase-change roar is a show: step back and take in the whole pose
    if (this.state === 'transition') return 3.5;
    // the meteor rain: golem, sky and the rings around the warrior all at once
    if (this.attack?.name === 'meteor') return 3.5;
    return 0;
  }

  /** Set when a rise push starts so the director can draw its warning ring. */
  riseTele: THREE.Vector3 | null = null;
  /** Set when any other shove is coming (meteor roar) so the director can draw its warning ring. */
  pushTele: { pos: THREE.Vector3; radius: number; dur: number } | null = null;

  private pushWave(radius: number, force: number, damage: number): void {
    bus.emit('pushWave', { pos: this.pos.clone(), radius });
    this.pendingPush = { radius, force, damage };
  }
  private pendingPush: { radius: number; force: number; damage: number } | null = null;

  // ------------------------------------------------------------------ update

  update(dt: number, ctx: FightContext): void {
    this.time += dt;
    this.stateTime += dt;
    this.sinceCoreHit += dt;
    for (const t of this.targets) t.flash = Math.max(0, t.flash - dt * 3);
    const G = this.G;
    if (this.meteorCooldown > 0) this.meteorCooldown -= dt;

    if (this.sinceCoreHit > G.breakDecayDelay && this.breakMeter > 0 && !this.staggered) {
      this.breakMeter = Math.max(0, this.breakMeter - G.breakDecayPerSecond * dt);
    }

    let walk = 0;
    let turn = 0;
    switch (this.state) {
      case 'dormant':
        break;
      case 'assemble':
        if (!this.anim.busy) {
          this.setState('combat');
          this.cooldown = 1.2;
        }
        break;
      case 'combat': {
        if (this.pendingPhase > this.phase && ctx.live) {
          this.startTransition(ctx);
          break;
        }
        if (this.attack) {
          if (!this.anim.busy) {
            this.history.push(this.attack.name);
            if (this.history.length > 4) this.history.shift();
            this.attack = null;
            this.ik.L = this.ik.R = null;
            const gap = perPhase(G.idleGap, this.phase);
            this.cooldown = rng.range(gap[0], gap[1]);
          }
          break;
        }
        if (!ctx.live || !ctx.player.alive) {
          // idle menace while the player is down or in a cinematic
          turn = this.faceToward(ctx.player.pos, dt, 0.5);
          break;
        }
        const r = this.locomote(dt, ctx);
        walk = r.walk;
        turn = r.turn;
        this.cooldown -= dt;
        if (this.cooldown <= 0) this.decide(ctx);
        break;
      }
      case 'stagger':
        if (!this.anim.busy) {
          this.setState('combat');
          this.cooldown = 0.9;
        }
        break;
      case 'transition':
        if (!this.anim.busy) {
          this.setState('combat');
          this.cooldown = 1.8; // a breather after the roar: never an attack straight out of it
        }
        break;
      case 'dead':
        break;
    }

    // walking animation state
    this.walkAmount += (walk - this.walkAmount) * Math.min(1, dt * 4);
    this.turnAmount += (turn - this.turnAmount) * Math.min(1, dt * 5);
    const prevGait = this.gait;
    const gaitSpeed = Math.max(this.walkAmount * perPhase(G.walkSpeed, this.phase), Math.abs(this.turnAmount) * 2.4);
    this.gait = (this.gait + (gaitSpeed * dt) / STRIDE) % 1;
    if (gaitSpeed > 0.3 && ((prevGait < 0.5 && this.gait >= 0.5) || this.gait < prevGait)) {
      const side = this.gait < 0.5 ? 'L' : 'R';
      this.rig.worldPos(this.rig.i(`foot_${side}`), _v);
      _v.y = 0;
      bus.emit('golemStep', { pos: _v.clone(), strength: 0.6 + 0.4 * Math.min(1, gaitSpeed / 2.5) });
    }

    this.anim.update(dt, (out) => {
      if (this.state === 'dormant') {
        out.copy(this.poses.dormant);
        return;
      }
      golemWalk(out, this.poses.idle, this.rig, this.gait, this.walkAmount, this.turnAmount);
      golemBreath(out, this.rig, this.time, 1);
    });
    this.applyFlinch(dt, ctx);
    this.syncRig();
    this.applyIK();
    this.updateDerived();

    if (this.pendingPush) {
      const pp = this.pendingPush;
      this.pendingPush = null;
      const d = Math.hypot(ctx.player.pos.x - this.pos.x, ctx.player.pos.z - this.pos.z);
      if (d < pp.radius && ctx.player.alive) {
        ctx.player.takeHit({
          damage: pp.damage,
          from: this.pos,
          knockback: pp.force * (1 - (0.5 * d) / pp.radius),
          knockdown: pp.damage > 0 ? false : false,
          unblockable: true,
          source: 'push',
        });
      }
    }
  }

  // ---- hit feedback: the struck arm jerks back, the whole body shudders; the head tracks the warrior
  private flinchT = 0;
  private flinchSide: Side | '' = '';
  private flinchAmt = 0;
  private headYaw = 0;

  /** Called when a core takes a blow: kicks the arm (or the whole body for the back and chest cores). */
  flinch(core: string, heavy: boolean): void {
    this.flinchT = 0;
    this.flinchAmt = heavy ? 1 : 0.6;
    this.flinchSide = core === 'core_arm_L' ? 'L' : core === 'core_arm_R' ? 'R' : '';
  }

  private applyFlinch(dt: number, ctx: FightContext): void {
    const rig = this.rig;
    this.flinchT += dt;
    const k = this.flinchAmt * Math.exp(-this.flinchT * 9) * Math.sin(Math.min(Math.PI, this.flinchT * 30));
    if (Math.abs(k) > 1e-3) {
      if (this.flinchSide) {
        rig.bones[rig.i(`forearm_${this.flinchSide}`)].rotateX(-0.12 * k);
        rig.bones[rig.i(`hand_${this.flinchSide}`)].rotateX(-0.18 * k);
      } else {
        rig.bones[rig.i('spine')].rotateX(-0.05 * k);
        rig.bones[rig.i('chest')].rotateZ(0.04 * k);
      }
    }
    // the head turns toward the warrior (within its neck's reach) when it is not busy roaring
    const live = this.state === 'combat' || this.state === 'transition';
    let want = 0;
    if (live && ctx.live) {
      const to = Math.atan2(ctx.player.pos.x - this.pos.x, ctx.player.pos.z - this.pos.z);
      want = clamp(angleDiff(this.yaw, to), -0.6, 0.6);
    }
    this.headYaw += (want - this.headYaw) * Math.min(1, dt * 3);
    if (Math.abs(this.headYaw) > 1e-3) {
      rig.bones[rig.i('neck')].rotateY(this.headYaw * 0.4);
      rig.bones[rig.i('head')].rotateY(this.headYaw * 0.6);
    }
  }

  private syncRig(): void {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.set(0, this.yaw, 0);
    this.rig.update();
  }

  private readonly groundGoal: IKGoal = { target: new THREE.Vector3(), weight: 1 };

  private applyIK(): void {
    for (const side of ['L', 'R'] as Side[]) {
      let g = this.ik[side];
      if (!g || g.weight <= 0) {
        // no scripted goal: keep the fist from sinking through the floor
        const hi = this.rig.i(`hand_${side}`);
        this.rig.tailWorld(hi, _v);
        if (_v.y >= 0.12 || this.state === 'dormant') continue;
        this.groundGoal.target.set(_v.x, 0.12, _v.z);
        g = this.groundGoal;
      }
      const up = this.rig.bone(`upperarm_${side}`);
      const fore = this.rig.bone(`forearm_${side}`);
      const hand = this.rig.bone(`hand_${side}`);
      const hi = this.rig.i(`hand_${side}`);
      // elbows bend outward and back
      up.getWorldPosition(_v);
      yawToDir(this.yaw, _v2);
      const outX = side === 'L' ? 1 : -1;
      _v3.set(Math.cos(this.yaw) * outX, 0, -Math.sin(this.yaw) * outX);
      _v.addScaledVector(_v3, 6).addScaledVector(_v2, -4);
      _v.y += 5;
      solveTwoBone(up, fore, hand, g.target, _v, clamp(g.weight, 0, 1), this.rig.tailLocal[hi]);
    }
  }

  /** Update core positions, capsules and floor colliders from the posed rig. */
  private updateDerived(): void {
    const rig = this.rig;
    for (const t of this.targets) {
      rig.attachedPoint(t.bone, t.rest, t.pos);
      if (t.kind === 'back') t.open = this.state === 'stagger' && this.stateTime > this.G.stagger.collapse * 0.6;
      else if (t.kind === 'chest') t.open = this.phase >= 3 && this.state === 'stagger' && this.stateTime > this.G.stagger.collapse * 0.6;
      else t.open = this.state !== 'dormant' && this.state !== 'assemble' && this.state !== 'dead';
    }
    for (let i = 0; i < rig.count; i++) {
      const c = this.capsules[i];
      rig.worldPos(i, c.a);
      rig.tailWorld(i, c.b);
    }
  }

  /** Floor circles that block the player (feet, planted fists, kneeling body). */
  fillColliders(out: { x: number; z: number; r: number; h: number }[]): void {
    out.length = 0;
    if (this.state === 'dormant') return;
    for (const c of this.capsules) {
      const low = Math.min(c.a.y, c.b.y);
      if (c.name.startsWith('foot')) {
        out.push({ x: (c.a.x + c.b.x) / 2, z: (c.a.z + c.b.z) / 2, r: 1.25, h: 2 });
      } else if (c.name.startsWith('hand') && low < 2.2) {
        out.push({ x: c.b.x, z: c.b.z, r: 1.2, h: 2 });
      } else if (c.name.startsWith('shin') && low < 2.4) {
        out.push({ x: (c.a.x + c.b.x) / 2, z: (c.a.z + c.b.z) / 2, r: 1.25, h: 2 });
        out.push({ x: c.a.x, z: c.a.z, r: 1.2, h: 2 });
      } else if (c.name === 'hips' && c.a.y < 4.5) {
        out.push({ x: c.a.x, z: c.a.z, r: 2.1, h: 3 });
      }
    }
  }

  /** Where the lock-on camera looks: the torso, but never up in the sky during a leap. */
  lockPoint(out: THREE.Vector3): THREE.Vector3 {
    if (this.leapTarget) {
      // frame the airborne golem and its landing ring together
      const chest = this.capsules[this.rig.i('chest')].a;
      return out.set(this.leapTarget.x, 2, this.leapTarget.z).lerp(chest, 0.4);
    }
    const hips = this.capsules[this.rig.i('hips')].a;
    const chest = this.capsules[this.rig.i('chest')].a;
    out.lerpVectors(hips, chest, 0.55);
    out.y = clamp(out.y - this.pos.y, 2.5, 9);
    return out;
  }
  /** Landing point while leaping (the camera watches it). */
  leapTarget: THREE.Vector3 | null = null;

  /** The core the lock-on reticle marks: the back core when it is open, else the nearest open core. */
  focusCore(from: THREE.Vector3): CoreInfo | null {
    let best: CoreInfo | null = null;
    let bestScore = Infinity;
    for (const t of this.targets) {
      if (!t.open) continue;
      const d = Math.hypot(t.pos.x - from.x, t.pos.z - from.z);
      const score = d + Math.max(0, t.pos.y - 3) * 1.5 - (t.kind === 'back' ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  /** Is a punish window open right now (fists planted or golem down)? */
  get windowOpen(): boolean {
    const s = this.step;
    if (this.staggered) return s === 'down';
    return !!this.attack && (s === 'stuck' || s === 'rest');
  }

  // ------------------------------------------------------------------ locomotion & AI

  private faceToward(p: THREE.Vector3, dt: number, rateMul = 1): number {
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    const diff = angleDiff(this.yaw, want);
    const rate = perPhase(this.G.turnRate, this.phase) * DEG * rateMul;
    if (Math.abs(diff) < 4 * DEG) return 0;
    this.yaw = rotateToward(this.yaw, want, rate * dt);
    return clamp(diff / (40 * DEG), -1, 1);
  }

  private locomote(dt: number, ctx: FightContext): { walk: number; turn: number } {
    const G = this.G;
    const p = ctx.player.pos;
    const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    const turn = this.faceToward(p, dt);
    let walk = 0;
    const far = G.preferredRange[1] + 1.5;
    if (this.walkTimer > 0) this.walkTimer -= dt;
    if ((d > far || this.walkTimer > 0) && Math.abs(turn) < 0.8 && d > G.preferredRange[0] + 1) {
      walk = 1;
      const speed = perPhase(G.walkSpeed, this.phase);
      yawToDir(this.yaw, _v);
      this.pos.addScaledVector(_v, speed * dt);
      this.clampToArena();
    }
    return { walk, turn };
  }

  private clampToArena(): void {
    const lim = this.G.arenaLimit;
    const d = Math.hypot(this.pos.x, this.pos.z);
    if (d > lim) {
      this.pos.x *= lim / d;
      this.pos.z *= lim / d;
    }
  }

  private decide(ctx: FightContext): void {
    const p = ctx.player.pos;
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const ang = angleDiff(this.yaw, Math.atan2(dx, dz));
    const side: Side = ang >= 0 ? 'L' : 'R';
    const A = this.A;
    const ph = this.phase;
    const front = Math.abs(ang) < 55 * DEG;
    const wide = Math.abs(ang) < 110 * DEG;
    const has = (a: { phases?: number[] }) => !a.phases || a.phases.includes(ph);
    const opts: { name: AttackName; w: number; side: Side | '' }[] = [];
    if (d >= A.slam.range[0] && d <= A.slam.range[1] && front) opts.push({ name: 'slam', w: 3, side });
    if (d <= A.sweep.range[1] && d > 4.5 && wide) opts.push({ name: 'sweep', w: 2.4, side });
    if (d <= A.stomp.range[1] && (d < 7 || !front)) opts.push({ name: 'stomp', w: d < 6 ? 4 : 2, side });
    if (d >= A.throw.minRange) opts.push({ name: 'throw', w: d > 18 ? 4 : 2, side: ang >= 0 ? 'L' : 'R' });
    if (has(A.doubleSlam) && d >= A.doubleSlam.range[0] && d <= A.doubleSlam.range[1] && front) opts.push({ name: 'doubleSlam', w: 2.6, side: '' });
    if (has(A.volley) && d >= A.volley.minRange) opts.push({ name: 'volley', w: 3, side });
    if (has(A.sweepCombo) && d <= A.sweepCombo.range[1] && d > 4.5 && wide) opts.push({ name: 'sweepCombo', w: 2.2, side });
    if (has(A.leap) && d >= A.leap.range[0] && d <= A.leap.range[1]) opts.push({ name: 'leap', w: d > 14 ? 4 : 1.8, side: '' });
    if (has(A.doubleStomp) && d <= A.doubleStomp.range[1] && (d < 8 || !front)) opts.push({ name: 'doubleStomp', w: 2.6, side });
    if (has(A.meteor) && this.meteorCooldown <= 0 && d > 6) opts.push({ name: 'meteor', w: 3.5, side: '' });

    // far away with nothing chosen yet: sometimes just walk in
    if (d > 16 && rng.chance(0.3)) {
      this.walkTimer = 1.8;
      this.cooldown = 1.8;
      return;
    }
    if (!opts.length) {
      this.cooldown = 0.25;
      return;
    }
    const last = this.history[this.history.length - 1];
    const last2 = this.history[this.history.length - 2];
    for (const o of opts) {
      if (o.name === last) o.w *= o.name === last2 ? 0.1 : 0.35;
    }
    let total = 0;
    for (const o of opts) total += o.w;
    let r = rng.next() * total;
    let pick = opts[0];
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    this.startAttack(pick.name, (pick.side || side) as Side, ctx);
  }

  /** Force an attack (tests). */
  startAttack(name: AttackName, side: Side, ctx: FightContext): void {
    this.attack = { name, side };
    let steps: Step[];
    switch (name) {
      case 'slam':
        steps = this.slamSteps(side, ctx);
        break;
      case 'sweep':
        steps = this.sweepSteps(side, ctx, false);
        break;
      case 'stomp':
        steps = this.stompSteps(side, ctx, false);
        break;
      case 'throw':
        steps = this.throwSteps(side, ctx, false);
        break;
      case 'doubleSlam':
        steps = this.doubleSlamSteps(ctx);
        break;
      case 'volley':
        steps = this.throwSteps(side, ctx, true);
        break;
      case 'sweepCombo':
        steps = [...this.sweepSteps(side, ctx, true), ...this.sweepSteps(side === 'L' ? 'R' : 'L', ctx, false, true)];
        break;
      case 'leap':
        steps = this.leapSteps(ctx);
        break;
      case 'doubleStomp':
        steps = [...this.stompSteps(side, ctx, true), ...this.stompSteps(side === 'L' ? 'R' : 'L', ctx, false, true)];
        break;
      case 'meteor':
        steps = this.meteorSteps(ctx);
        this.meteorCooldown = this.A.meteor.cooldown;
        break;
    }
    this.anim.play(steps);
  }

  /** Is the player's capsule touching a segment capsule? */
  private hitsPlayer(ctx: FightContext, a: THREE.Vector3, b: THREE.Vector3, r: number): boolean {
    const pl = ctx.player;
    _pa.set(pl.pos.x, pl.y + 0.3, pl.pos.z);
    _pb.set(pl.pos.x, pl.y + 1.5, pl.pos.z);
    const rr = r + PLAYER_RADIUS;
    return segSegDist2(a, b, _pa, _pb) < rr * rr;
  }

  private radialHit(ctx: FightContext, center: THREE.Vector3, radius: number, maxHeight = 2.5): boolean {
    const pl = ctx.player;
    const d = Math.hypot(pl.pos.x - center.x, pl.pos.z - center.z);
    return d < radius + PLAYER_RADIUS && pl.y < maxHeight;
  }

  // ------------------------------------------------------------------ attacks

  private slamSteps(side: Side, ctx: FightContext): Step[] {
    const S = this.A.slam;
    const k = this.k;
    const P = this.poses;
    const target = new THREE.Vector3().copy(ctx.player.pos);
    const fist = this.fistRest[`slam_${side}`];
    const fistAng = Math.atan2(fist.x, fist.z);
    const fistDist = Math.hypot(fist.x, fist.z);
    let tele: { set: (p: THREE.Vector3) => void; kill: () => void } | null = null;
    const track = S.trackFraction;
    return [
      {
        name: 'windup',
        dur: S.windup * k,
        pose: P[`slamRaise_${side}`],
        ease: 'outCubic',
        enter: () => bus.emit('golemWindup', { attack: 'slam', duration: S.windup * k, pos: this.pos }),
        update: (t, dt) => {
          if (t < track) {
            target.copy(ctx.player.pos);
            // clamp to reach
            const dx = target.x - this.pos.x;
            const dz = target.z - this.pos.z;
            const d = Math.hypot(dx, dz);
            if (d > S.reach) {
              target.x = this.pos.x + (dx / d) * S.reach;
              target.z = this.pos.z + (dz / d) * S.reach;
            }
          }
          target.y = 0;
          // turn so the fist lines up with the target, and step toward the right distance
          const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z) - fistAng;
          this.yaw = rotateToward(this.yaw, want, 90 * DEG * dt);
          const d = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
          const adjust = clamp(d - fistDist, -3, 3);
          yawToDir(Math.atan2(target.x - this.pos.x, target.z - this.pos.z), _v);
          this.pos.addScaledVector(_v, clamp(adjust, -2.5 * dt, 2.5 * dt));
          this.clampToArena();
          if (t > 0.35 && !tele) tele = ctx.threats.telegraph(target, S.radius, (S.windup * (1 - 0.35) + S.strike) * k, 'slam');
          tele?.set(target);
        },
      },
      {
        name: 'strike',
        dur: S.strike * k,
        pose: P[`slamHit_${side}`],
        ease: 'inQuad',
        enter: () => {
          this.ik[side] = { target: target.clone().setY(-0.25), weight: 0 };
          bus.emit('golemStrike', { attack: 'slam', pos: target });
        },
        update: (t) => {
          const g = this.ik[side];
          if (g) g.weight = ease.inQuad(t);
        },
        exit: () => {
          tele?.kill();
          bus.emit('slamImpact', { pos: target.clone(), radius: S.radius, big: false });
          if (this.radialHit(ctx, target, S.radius)) {
            ctx.player.takeHit({ damage: S.damage, from: target, knockdown: S.knockdown, knockback: 9, source: 'slam' });
          }
          // the cracks only start burning once the fist is pulled out
          ctx.threats.hazard(target, S.hazardRadius, perPhase(S.hazardDuration, this.phase), S.hazardDps, this.phase >= 3 ? 'lava' : 'crack', (S.stuck + S.pull) * k);
        },
      },
      {
        name: 'stuck',
        dur: S.stuck * k,
        pose: (out, t) => {
          out.blend(P[`slamHit_${side}`], P[`slamStrain_${side}`], ease.inOutSine(Math.min(1, t * 2)));
          const s = Math.sin(this.time * 30) * 0.8 * t;
          out.addEuler(this.rig.i('chest'), s, 0, s);
        },
        update: () => {
          const g = this.ik[side];
          if (g) g.weight = 1;
        },
      },
      {
        name: 'pull',
        dur: S.pull * k,
        pose: P[`slamPull_${side}`],
        ease: 'inOutCubic',
        enter: () => bus.emit('rockGrab', { pos: target.clone() }),
        update: (t) => {
          const g = this.ik[side];
          if (g) g.weight = 1 - ease.outQuad(t);
        },
        exit: () => (this.ik[side] = null),
      },
      { name: 'recover', dur: S.recover * k, pose: P.idle, ease: 'inOutSine' },
    ];
  }

  private doubleSlamSteps(ctx: FightContext): Step[] {
    const S = this.A.doubleSlam;
    const k = this.k;
    const P = this.poses;
    const target = new THREE.Vector3().copy(ctx.player.pos);
    const fl = this.fistRest.double_L;
    const fr = this.fistRest.double_R;
    const mid = new THREE.Vector3().addVectors(fl, fr).multiplyScalar(0.5);
    const midDist = Math.hypot(mid.x, mid.z);
    const tL = new THREE.Vector3();
    const tR = new THREE.Vector3();
    let tele: { set: (p: THREE.Vector3) => void; kill: () => void } | null = null;
    return [
      {
        name: 'windup',
        dur: S.windup * k,
        pose: P.doubleRaise,
        ease: 'outCubic',
        enter: () => bus.emit('golemWindup', { attack: 'doubleSlam', duration: S.windup * k, pos: this.pos }),
        update: (t, dt) => {
          if (t < 0.7) target.copy(ctx.player.pos);
          target.y = 0;
          const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
          this.yaw = rotateToward(this.yaw, want, 90 * DEG * dt);
          const d = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
          yawToDir(want, _v);
          this.pos.addScaledVector(_v, clamp(d - midDist, -2.5 * dt, 2.5 * dt));
          this.clampToArena();
          if (t > 0.35 && !tele) tele = ctx.threats.telegraph(target, S.radius, (S.windup * 0.65 + S.strike) * k, 'slam');
          // aim point: in front of the golem at the natural fist distance
          yawToDir(this.yaw, _v);
          const aim = _v2.copy(this.pos).addScaledVector(_v, midDist);
          tele?.set(aim);
        },
      },
      {
        name: 'strike',
        dur: S.strike * k,
        pose: P.doubleHit,
        ease: 'inQuad',
        enter: () => {
          const c = Math.cos(this.yaw);
          const s = Math.sin(this.yaw);
          const toWorld = (v: THREE.Vector3, out: THREE.Vector3) =>
            out.set(this.pos.x + v.x * c + v.z * s, -0.25, this.pos.z - v.x * s + v.z * c);
          toWorld(fl, tL);
          toWorld(fr, tR);
          this.ik.L = { target: tL, weight: 0 };
          this.ik.R = { target: tR, weight: 0 };
          bus.emit('golemStrike', { attack: 'doubleSlam', pos: target });
        },
        update: (t) => {
          if (this.ik.L) this.ik.L.weight = ease.inQuad(t);
          if (this.ik.R) this.ik.R.weight = ease.inQuad(t);
        },
        exit: () => {
          tele?.kill();
          const center = new THREE.Vector3().addVectors(tL, tR).multiplyScalar(0.5).setY(0);
          bus.emit('slamImpact', { pos: center.clone(), radius: S.radius, big: true });
          if (this.radialHit(ctx, center, S.radius)) {
            ctx.player.takeHit({ damage: S.damage, from: center, knockdown: S.knockdown, knockback: 10, source: 'doubleSlam' });
          }
          const hz = perPhase(S.fissureHazardDuration, this.phase);
          const armAt = (S.stuck + S.pull) * k;
          ctx.threats.hazard(tL.clone().setY(0), 2.4, Math.max(hz, 6), 12, this.phase >= 3 ? 'lava' : 'crack', armAt);
          ctx.threats.hazard(tR.clone().setY(0), 2.4, Math.max(hz, 6), 12, this.phase >= 3 ? 'lava' : 'crack', armAt);
          // fissure races toward the player
          const dir = new THREE.Vector3(ctx.player.pos.x - center.x, 0, ctx.player.pos.z - center.z);
          if (dir.lengthSq() < 1) yawToDir(this.yaw, dir);
          dir.normalize();
          ctx.threats.fissure(center, dir, S.fissureLength, S.fissureSpeed, S.fissureDamage, S.fissureRadius, hz, this.phase >= 3 ? 'lava' : 'crack', S.radius + 0.4, S.fissureDelay);
        },
      },
      {
        name: 'stuck',
        dur: S.stuck * k,
        pose: (out, t) => {
          out.copy(P.doubleHit);
          const s = Math.sin(this.time * 26) * 0.8 * t;
          out.addEuler(this.rig.i('chest'), s, 0, 0);
        },
        update: () => {
          if (this.ik.L) this.ik.L.weight = 1;
          if (this.ik.R) this.ik.R.weight = 1;
        },
      },
      {
        name: 'pull',
        dur: S.pull * k,
        pose: P.pushUp,
        ease: 'inOutCubic',
        update: (t) => {
          if (this.ik.L) this.ik.L.weight = 1 - ease.outQuad(t);
          if (this.ik.R) this.ik.R.weight = 1 - ease.outQuad(t);
        },
        exit: () => (this.ik.L = this.ik.R = null),
      },
      { name: 'recover', dur: S.recover * k, pose: P.idle, ease: 'inOutSine' },
    ];
  }

  /** Knuckles planted on the floor for `dur` seconds: both arm cores come down (punish window). */
  private braceSteps(dur: number, name = 'stuck'): Step[] {
    const P = this.poses;
    const k = this.k;
    const tl = new THREE.Vector3();
    const tr = new THREE.Vector3();
    const place = () => {
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      const fl = this.fistRest.brace_L;
      const fr = this.fistRest.brace_R;
      tl.set(this.pos.x + fl.x * c + fl.z * s, -0.15, this.pos.z - fl.x * s + fl.z * c);
      tr.set(this.pos.x + fr.x * c + fr.z * s, -0.15, this.pos.z - fr.x * s + fr.z * c);
    };
    return [
      {
        name: 'brace',
        dur: 0.35 * k,
        pose: P.brace,
        ease: 'inQuad',
        enter: () => {
          place();
          this.ik.L = { target: tl, weight: 0 };
          this.ik.R = { target: tr, weight: 0 };
        },
        update: (t) => {
          if (this.ik.L) this.ik.L.weight = t;
          if (this.ik.R) this.ik.R.weight = t;
        },
        exit: () => bus.emit('slamImpact', { pos: this.pos.clone(), radius: 2, big: false }),
      },
      {
        name,
        dur: dur * k,
        pose: (out, t) => {
          out.copy(P.brace);
          golemBreath(out, this.rig, this.time * 2.2, 1.6);
          out.pos.y -= 0.2 * Math.sin(t * Math.PI);
        },
        update: () => {
          if (this.ik.L) this.ik.L.weight = 1;
          if (this.ik.R) this.ik.R.weight = 1;
        },
      },
      {
        name: 'pull',
        dur: 0.45 * k,
        pose: P.idle,
        ease: 'inOutSine',
        update: (t) => {
          if (this.ik.L) this.ik.L.weight = 1 - t;
          if (this.ik.R) this.ik.R.weight = 1 - t;
        },
        exit: () => (this.ik.L = this.ik.R = null),
      },
    ];
  }

  private sweepSteps(side: Side, ctx: FightContext, chained: boolean, second = false): Step[] {
    const S = second || chained ? this.A.sweepCombo : this.A.sweep;
    const k = this.k;
    const P = this.poses;
    const sign = side === 'L' ? 1 : -1;
    const a0 = 95 * DEG * sign;
    const a1 = -62 * DEG * sign;
    const R = 10;
    let hit = false;
    const arcPoint = (u: number, h: number, out: THREE.Vector3) => {
      const a = this.yaw + lerp(a0, a1, u);
      return out.set(this.pos.x + Math.sin(a) * R, h, this.pos.z + Math.cos(a) * R);
    };
    const goal: IKGoal = { target: new THREE.Vector3(), weight: 0 };
    const hi = this.rig.i(`hand_${side}`);
    const fi = this.rig.i(`forearm_${side}`);
    const windDur = (second ? (this.A.sweepCombo.between ?? 0.45) : S.windup) * k;
    let tele: { set: (p: THREE.Vector3) => void; kill: () => void } | null = null;
    // the arc it will really sweep: fixed the moment the red sector appears (it stops turning then)
    const INNER = 1.8;
    const OUTER = R + 2.2;
    let arcYaw = this.yaw;
    const inSweep = (p: THREE.Vector3, margin: number): boolean => {
      const dx = p.x - this.pos.x;
      const dz = p.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < INNER - margin || d > OUTER + margin) return false;
      const lo = Math.min(a0, a1) - margin / Math.max(d, 1);
      const hi2 = Math.max(a0, a1) + margin / Math.max(d, 1);
      const rel = Math.atan2(Math.sin(Math.atan2(dx, dz) - arcYaw), Math.cos(Math.atan2(dx, dz) - arcYaw));
      return rel >= lo && rel <= hi2;
    };
    const steps: Step[] = [
      {
        name: 'windup',
        dur: windDur,
        pose: P[`sweepWind_${side}`],
        ease: 'outCubic',
        enter: () => bus.emit('golemWindup', { attack: 'sweep', duration: windDur, pos: this.pos }),
        update: (t, dt) => {
          // face the player until the warning appears, then commit: the sweep covers exactly the red sector
          if (!tele) {
            const want = Math.atan2(ctx.player.pos.x - this.pos.x, ctx.player.pos.z - this.pos.z);
            this.yaw = rotateToward(this.yaw, want, 70 * DEG * dt);
          }
          if (!tele && t > (second ? 0 : 0.35)) {
            arcYaw = this.yaw;
            tele = ctx.threats.sector(this.pos, INNER, OUTER, arcYaw + a0, arcYaw + a1, windDur * (1 - t) + S.strike * k * 0.5);
          }
          arcPoint(0, 1.6, goal.target);
          goal.weight = ease.inQuad(t) * 0.6;
          this.ik[side] = goal;
        },
      },
      {
        name: 'strike',
        dur: S.strike * k,
        pose: P[`sweepEnd_${side}`],
        ease: 'inOutSine',
        enter: () => bus.emit('sweepWhoosh', { pos: this.pos }),
        update: (t) => {
          const u = ease.inOutSine(t);
          if (t > 0.6) tele?.kill();
          arcPoint(u, 1.2 - 0.9 * u * u, goal.target);
          goal.weight = 0.6 + 0.4 * Math.min(1, t * 3);
          if (!hit && ctx.player.alive) {
            const c1 = this.capsules[fi];
            const c2 = this.capsules[hi];
            const touching = this.hitsPlayer(ctx, c1.a, c1.b, c1.r) || this.hitsPlayer(ctx, c2.a, c2.b, c2.r + 0.2);
            // fair: only inside the red sector it showed (plus the warrior's own radius)
            if (touching && inSweep(ctx.player.pos, 0.45)) {
              hit = true;
              ctx.player.takeHit({ damage: S.damage, from: this.pos, knockback: S.knockback, knockdown: S.knockdown, source: 'sweep' });
            }
          }
        },
        exit: () => bus.emit('slamImpact', { pos: arcPoint(1, 0, new THREE.Vector3()), radius: 2.5, big: false }),
      },
    ];
    if (!chained) {
      steps.push(
        {
          name: 'rest',
          dur: S.rest * k,
          pose: P[`sweepEnd_${side}`],
          update: () => {
            arcPoint(1, -0.3, goal.target);
            goal.weight = 1;
          },
        },
        {
          name: 'recover',
          dur: S.recover * k,
          pose: P.idle,
          ease: 'inOutSine',
          update: (t) => (goal.weight = 1 - ease.outQuad(t)),
          exit: () => (this.ik[side] = null),
        },
      );
    } else {
      steps.push({
        name: 'swap',
        dur: 0.15 * k,
        pose: P[`sweepEnd_${side}`],
        update: (t) => (goal.weight = 1 - t),
        exit: () => (this.ik[side] = null),
      });
    }
    return steps;
  }

  private stompSteps(side: Side, ctx: FightContext, chained: boolean, second = false): Step[] {
    const S = this.A.stomp;
    const k = this.k;
    const P = this.poses;
    const wind = second ? this.A.doubleStomp.between : chained ? this.A.doubleStomp.windup : S.windup;
    let tele: { set: (p: THREE.Vector3) => void; kill: () => void } | null = null;
    const footSpot = new THREE.Vector3();
    const steps: Step[] = [
      {
        name: 'windup',
        dur: wind * k,
        pose: P[`stompRaise_${side}`],
        ease: 'outCubic',
        enter: () => bus.emit('golemWindup', { attack: 'stomp', duration: wind * k, pos: this.pos }),
        update: (t, dt) => {
          this.faceToward(ctx.player.pos, dt, 0.35);
          const foot = this.capsules[this.rig.i(`foot_${side}`)];
          footSpot.addVectors(foot.a, foot.b).multiplyScalar(0.5).setY(0);
          if (!tele && t > 0.25) tele = ctx.threats.telegraph(footSpot, S.directRadius, wind * k * (1 - t) + S.strike * k, 'stomp');
          tele?.set(footSpot);
        },
        exit: () => tele?.kill(),
      },
      {
        name: 'strike',
        dur: (chained || second ? this.A.doubleStomp.strike : S.strike) * k,
        pose: P[`stompHit_${side}`],
        ease: 'inQuad',
        exit: () => {
          const foot = this.capsules[this.rig.i(`foot_${side}`)];
          const center = new THREE.Vector3().addVectors(foot.a, foot.b).multiplyScalar(0.5).setY(0);
          bus.emit('stompImpact', { pos: center.clone(), radius: S.directRadius });
          if (this.radialHit(ctx, center, S.directRadius, 2)) {
            ctx.player.takeHit({ damage: S.damage, from: center, knockdown: S.knockdown, knockback: 8, source: 'stomp' });
          }
          ctx.threats.shockwave(center, S.ringSpeed, S.ringMaxRadius, S.ringWidth, S.ringHeight, S.ringDamage, 'stomp');
        },
      },
    ];
    if (!chained) {
      steps.push(...this.braceSteps(second ? this.A.doubleStomp.brace : S.brace));
      steps.push({ name: 'recover', dur: (second ? this.A.doubleStomp.recover : S.recover) * 0.6 * k, pose: P.idle, ease: 'inOutSine' });
    }
    return steps;
  }

  private throwSteps(side: Side, ctx: FightContext, volley: boolean): Step[] {
    const T = volley ? this.A.volley : this.A.throw;
    const k = this.k;
    const P = this.poses;
    const hi = this.rig.i(`hand_${side}`);
    const releaseDur = volley ? this.A.volley.interval * (this.A.volley.count - 1) + 0.3 : 0.3;
    let thrown = 0;
    const throwOne = (offset: number) => {
      const from = this.rig.tailWorld(hi, new THREE.Vector3());
      // release low enough that the whole flight stays in the player's view
      from.y = clamp(from.y, 3, 10.5);
      const pl = ctx.player;
      const lead = (volley ? 0.3 : this.A.throw.lead) * this.A.throw.flightTime;
      const to = new THREE.Vector3(pl.pos.x + pl.vel.x * lead, 0, pl.pos.z + pl.vel.z * lead);
      if (offset !== 0) {
        // spread sideways relative to the throw direction
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const l = Math.hypot(dx, dz) || 1;
        to.x += (-dz / l) * offset;
        to.z += (dx / l) * offset;
      }
      ctx.threats.rock(from, to, T.flightTime, T.damage, T.radius, !!T.knockdown, volley ? this.A.volley.knockback : 8, volley ? 1.05 : 1.5);
      bus.emit('rockThrow', { pos: from });
    };
    return [
      {
        name: 'grab',
        dur: T.grab * k,
        pose: P[`throwGrab_${side}`],
        ease: 'inOutSine',
        enter: () => bus.emit('golemWindup', { attack: volley ? 'volley' : 'throw', duration: (T.grab + T.windup) * k, pos: this.pos }),
        update: (_t, dt) => this.faceToward(ctx.player.pos, dt, 1.2),
        exit: () => {
          this.heldRock = side;
          bus.emit('rockGrab', { pos: this.rig.tailWorld(hi, new THREE.Vector3()) });
        },
      },
      {
        name: 'windup',
        dur: T.windup * k,
        pose: P[`throwRaise_${side}`],
        ease: 'outCubic',
        update: (_t, dt) => this.faceToward(ctx.player.pos, dt, 1.2),
      },
      {
        name: 'release',
        dur: releaseDur,
        pose: P[`throwRelease_${side}`],
        ease: 'outCubic',
        update: (t) => {
          if (!volley) {
            if (thrown === 0 && t > 0.55) {
              thrown = 1;
              this.heldRock = '';
              throwOne(0);
            }
            return;
          }
          const V = this.A.volley;
          const offsets = [-V.spread, 0, V.spread];
          const elapsed = t * releaseDur;
          while (thrown < V.count && elapsed >= 0.08 + thrown * V.interval) {
            throwOne(offsets[thrown % offsets.length] * (thrown === 1 ? 0 : 1));
            thrown++;
            if (thrown >= V.count) this.heldRock = '';
          }
        },
        exit: () => {
          this.heldRock = '';
        },
      },
      { name: 'recover', dur: T.recover * k, pose: P.idle, ease: 'inOutSine' },
    ];
  }

  private leapSteps(ctx: FightContext): Step[] {
    const L = this.A.leap;
    const k = this.k;
    const P = this.poses;
    const start = new THREE.Vector3();
    const land = new THREE.Vector3();
    const impact = new THREE.Vector3();
    const mid = new THREE.Vector3().addVectors(this.fistRest.double_L, this.fistRest.double_R).multiplyScalar(0.5);
    const midDist = Math.hypot(mid.x, mid.z);
    let tele: { set: (p: THREE.Vector3) => void; kill: () => void } | null = null;
    const fl = this.fistRest.double_L;
    const fr = this.fistRest.double_R;
    return [
      {
        name: 'windup',
        dur: L.windup * k,
        pose: P.leapCrouch,
        ease: 'outCubic',
        enter: () => bus.emit('golemWindup', { attack: 'leap', duration: L.windup * k, pos: this.pos }),
        update: (_t, dt) => this.faceToward(ctx.player.pos, dt, 1.5),
        exit: () => {
          start.copy(this.pos);
          impact.set(ctx.player.pos.x, 0, ctx.player.pos.z);
          const dir = _v.set(impact.x - start.x, 0, impact.z - start.z);
          const dist = dir.length();
          dir.normalize();
          this.yaw = Math.atan2(dir.x, dir.z);
          land.copy(impact).addScaledVector(dir, -Math.min(midDist, dist));
          const lim = this.G.arenaLimit;
          const ld = Math.hypot(land.x, land.z);
          if (ld > lim) land.multiplyScalar(lim / ld);
          impact.copy(land).addScaledVector(dir, midDist);
          tele = ctx.threats.telegraph(impact, L.radius, L.air * k, 'leap');
          this.leapTarget = impact.clone();
          bus.emit('leapTakeoff', { pos: start.clone() });
        },
      },
      {
        name: 'air',
        dur: L.air * k,
        pose: P.leapAir,
        ease: 'outCubic',
        update: (t) => {
          this.pos.lerpVectors(start, land, ease.inOutSine(t));
          this.pos.y = 4 * 6 * t * (1 - t);
        },
        exit: () => {
          this.pos.copy(land);
          this.pos.y = 0;
          this.leapTarget = null;
        },
      },
      {
        name: 'land',
        dur: L.land * k,
        pose: P.doubleHit,
        ease: 'inQuad',
        enter: () => {
          const c = Math.cos(this.yaw);
          const s = Math.sin(this.yaw);
          this.ik.L = { target: new THREE.Vector3(this.pos.x + fl.x * c + fl.z * s, -0.25, this.pos.z - fl.x * s + fl.z * c), weight: 0 };
          this.ik.R = { target: new THREE.Vector3(this.pos.x + fr.x * c + fr.z * s, -0.25, this.pos.z - fr.x * s + fr.z * c), weight: 0 };
        },
        update: (t) => {
          if (this.ik.L) this.ik.L.weight = t;
          if (this.ik.R) this.ik.R.weight = t;
        },
        exit: () => {
          tele?.kill();
          bus.emit('slamImpact', { pos: impact.clone(), radius: L.radius, big: true });
          if (this.radialHit(ctx, impact, L.radius)) {
            ctx.player.takeHit({ damage: L.damage, from: impact, knockdown: true, knockback: 11, source: 'leap' });
          }
          ctx.threats.shockwave(impact, L.ringSpeed, L.ringMaxRadius, 1.1, 0.9, L.ringDamage, 'leap');
          ctx.threats.hazard(impact, 4, perPhase(this.A.slam.hazardDuration, this.phase), this.A.slam.hazardDps, 'lava', (L.stuck + L.recover * 0.5) * k);
        },
      },
      {
        name: 'stuck',
        dur: L.stuck * k,
        pose: P.doubleHit,
        update: () => {
          if (this.ik.L) this.ik.L.weight = 1;
          if (this.ik.R) this.ik.R.weight = 1;
        },
      },
      {
        name: 'recover',
        dur: L.recover * k,
        pose: P.idle,
        ease: 'inOutSine',
        update: (t) => {
          if (this.ik.L) this.ik.L.weight = 1 - t;
          if (this.ik.R) this.ik.R.weight = 1 - t;
        },
        exit: () => (this.ik.L = this.ik.R = null),
      },
    ];
  }

  private meteorSteps(ctx: FightContext): Step[] {
    const M = this.A.meteor;
    const k = this.k;
    const P = this.poses;
    let spawned = 0;
    const placed: THREE.Vector3[] = [];
    const spawnAt = (i: number) => {
      const pl = ctx.player.pos;
      const p = new THREE.Vector3();
      // rejection-sample so warning rings never overlap
      for (let tries = 0; tries < 12; tries++) {
        if (i < M.nearPlayer) {
          const r = i === 0 ? 0 : rng.range(M.radius * 2.2, M.radius * 3.4);
          const a = rng.range(0, Math.PI * 2);
          p.set(pl.x + Math.cos(a) * r, 0, pl.z + Math.sin(a) * r);
        } else {
          const r = rng.range(6, 30);
          const a = rng.range(0, Math.PI * 2);
          p.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        }
        const d = Math.hypot(p.x, p.z);
        if (d > 34) p.multiplyScalar(34 / d);
        if (placed.every((q) => q.distanceTo(p) > M.radius * 2.2)) break;
      }
      placed.push(p.clone());
      ctx.threats.meteor(p, M.warn, M.damage, M.radius, M.knockback, this.pos);
    };
    return [
      {
        name: 'windup',
        dur: M.windup * k,
        pose: P.roarSky,
        ease: 'outCubic',
        enter: () => {
          bus.emit('golemWindup', { attack: 'meteor', duration: M.windup * k, pos: this.pos });
          bus.emit('roar', { pos: this.pos, phase: 4 });
          // it roars at the sky and shoves the warrior back: room to see the rain coming
          this.pushTele = { pos: this.pos.clone(), radius: M.pushRadius, dur: M.windup * k };
        },
      },
      {
        name: 'rain',
        dur: M.spreadTime,
        enter: () => this.pushWave(M.pushRadius, M.pushForce, 0),
        pose: (out, t) => {
          out.copy(P.roarSky);
          const s = Math.sin(this.time * 20) * 1.5;
          out.addEuler(this.rig.i('chest'), s * (1 - t), 0, 0);
        },
        update: (t) => {
          // the shove lands first (about 0.35 s), then the rubble starts to fall around where the warrior ended up
          if (t < 0.12) return;
          const want = Math.floor(((t - 0.12) / 0.88) * M.count + 0.001);
          while (spawned < Math.min(M.count, want + 1)) spawnAt(spawned++);
        },
      },
      ...this.braceSteps(M.exhausted),
      { name: 'recover', dur: M.recover * k, pose: P.idle, ease: 'inOutSine' },
    ];
  }

  /** Current sequence step name ('' when idle). */
  get step(): string {
    return this.anim.seq?.stepName ?? '';
  }

  /** Seconds until the named step of the current attack starts (-1 if none). */
  timeUntil(stepName: string): number {
    return this.anim.seq ? this.anim.seq.timeUntil(stepName) : -1;
  }

  /** For the bot and HUD: is an arm core low enough to hit right now? */
  exposedArm(): CoreInfo | null {
    let best: CoreInfo | null = null;
    for (const t of this.targets) if (t.kind === 'arm' && t.pos.y < 3.4 && (!best || t.pos.y < best.pos.y)) best = t;
    return best;
  }

  /** Tick hook for the fight director when a transition is pending after a stagger. */
  get transitionPending(): boolean {
    return this.pendingPhase > this.phase;
  }
}
