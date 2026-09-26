import * as THREE from 'three';
import { balance } from '../core/balance';
import { bus } from '../core/events';
import type { InputFrame } from '../core/input';
import { angleDiff, clamp, DEG, dirToYaw, rotateToward, yawToDir, ease } from '../core/math';
import { Animator, type Step } from '../anim/pose';
import type { Rig } from '../anim/rig';
import { buildWarriorPoses, warriorBreath, warriorRun, type WarriorPoses } from '../anim/warriorPoses';
import type { FightContext, GolemTarget, SwordHit } from './context';

export type PlayerState =
  | 'move'
  | 'light'
  | 'heavy'
  | 'roll'
  | 'air'
  | 'land'
  | 'heal'
  | 'hit'
  | 'down'
  | 'guardbreak'
  | 'deflect'
  | 'dead';

type Act = 'light' | 'heavy' | 'roll' | 'jump' | 'heal';

export interface IncomingHit {
  damage: number;
  from: THREE.Vector3;
  knockdown?: boolean;
  knockback?: number;
  unblockable?: boolean;
  source: string;
}

export type HitOutcome = 'dodged' | 'blocked' | 'justguard' | 'guardbreak' | 'hit' | 'ignored';

interface AttackRun {
  heavy: boolean;
  index: number;
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  breakAmount: number;
  reach: number;
  arc: number;
  maxHeight: number;
  lunge: number;
  lunged: number;
  target: GolemTarget | null;
  charged: boolean;
  charge: number;
  chargeDone: boolean;
  resolved: 'none' | 'core' | 'deflect' | 'body' | 'whiff';
}

export const PLAYER_RADIUS = 0.42;
/** Extra radius around cores for sword checks (forgiving aim). */
const CORE_GRACE = 0.45;
const STRIDE = 4.2; // metres per run cycle (two steps)

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Player {
  readonly anim: Animator;
  readonly poses: WarriorPoses;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly knockVel = new THREE.Vector3();
  y = 0;
  vy = 0;
  yaw = Math.PI;
  hp = 100;
  stamina = 100;
  flasks = 3;
  state: PlayerState = 'move';
  stateTime = 0;
  time = 0;
  locked = false;
  blocking = false;
  blockStart = -10;
  combo = -1;
  comboTimer = 0;
  staminaDelay = 0;
  god = false;
  control = true;
  atk: AttackRun | null = null;
  readonly rollDir = new THREE.Vector3();
  private rollDone = 0;
  private healDone = false;
  private buffer: { a: Act; t: number } | null = null;
  private lockToggle = false;
  private held = { block: false, heavy: false };
  private readonly moveWish = new THREE.Vector3();
  private moveMag = 0;
  private gait = 0;
  private moveAmount = 0;
  private localX = 0;
  private localZ = 1;
  private blockWeight = 0;
  private hitFlash = 0;
  lastHitSource = '';
  /** seconds left of a small flinch from standing in fire */
  private burnJolt = 0;
  private lastDodge = -9;
  private aimW = 0;
  lastOutcome: HitOutcome | '' = '';
  readonly stats = { damageTaken: 0, hits: 0, flasksUsed: 0, rolls: 0, swings: 0, coreHits: 0, bodyHits: 0, deflects: 0, whiffs: 0 };

  constructor(readonly rig: Rig) {
    this.anim = new Animator(rig);
    this.poses = buildWarriorPoses(rig);
  }

  get B() {
    return balance.player;
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  reset(x: number, z: number, yaw: number): void {
    const B = this.B;
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.knockVel.set(0, 0, 0);
    this.y = 0;
    this.vy = 0;
    this.yaw = yaw;
    this.hp = B.maxHealth;
    this.stamina = B.maxStamina;
    this.flasks = B.flask.charges;
    this.state = 'move';
    this.stateTime = 0;
    this.locked = false;
    this.blocking = false;
    this.combo = -1;
    this.comboTimer = 0;
    this.atk = null;
    this.buffer = null;
    this.anim.seq = null;
    this.hitFlash = 0;
    for (const k of Object.keys(this.stats) as (keyof typeof this.stats)[]) this.stats[k] = 0;
    this.syncRig();
  }

  /** Per rendered frame: record held buttons, movement wish and buffered presses. */
  handleInput(f: InputFrame, camYaw: number): void {
    if (!this.control) {
      this.moveWish.set(0, 0, 0);
      this.moveMag = 0;
      this.held.block = false;
      this.held.heavy = false;
      return;
    }
    const s = Math.sin(camYaw);
    const c = Math.cos(camYaw);
    this.moveWish.set(s * f.moveY - c * f.moveX, 0, c * f.moveY + s * f.moveX);
    this.moveMag = Math.min(1, Math.hypot(f.moveX, f.moveY));
    if (this.moveMag > 1e-3) this.moveWish.normalize();
    this.held.block = f.held.block;
    this.held.heavy = f.held.heavy;
    if (f.pressed.roll) this.push('roll');
    else if (f.pressed.jump) this.push('jump');
    else if (f.pressed.light) this.push('light');
    else if (f.pressed.heavy) this.push('heavy');
    else if (f.pressed.heal) this.push('heal');
    if (f.pressed.lock) this.lockToggle = true;
  }

  private push(a: Act): void {
    this.buffer = { a, t: this.time };
  }

  /** Is the player immune to damage right now? */
  get invulnerable(): boolean {
    if (this.state === 'dead' || this.state === 'down') return true;
    if (this.state === 'roll') {
      const R = this.B.roll;
      return this.stateTime >= R.iframeStart && this.stateTime <= R.iframeEnd;
    }
    return !this.control;
  }

  get airborne(): boolean {
    return this.y > 0.02;
  }

  /** Height of the feet above the floor (for shockwave tests). */
  get feetHeight(): number {
    return this.y;
  }

  private setState(s: PlayerState): void {
    this.state = s;
    this.stateTime = 0;
  }

  private spend(cost: number): boolean {
    if (this.stamina <= 0) {
      bus.emit('noStamina', {});
      return false;
    }
    this.stamina -= cost;
    if (this.stamina <= 0) {
      this.stamina = 0;
      this.staminaDelay = this.B.exhaustedRegenDelay;
    } else this.staminaDelay = this.B.staminaRegenDelay;
    return true;
  }

  /** Try to start the buffered action if it is in `allowed`. */
  private tryBuffered(ctx: FightContext, allowed: readonly Act[]): boolean {
    const b = this.buffer;
    if (!b || !allowed.includes(b.a)) return false;
    let ok = false;
    switch (b.a) {
      case 'light':
        ok = this.startLight(ctx);
        break;
      case 'heavy':
        ok = this.startHeavy(ctx);
        break;
      case 'roll':
        ok = this.startRoll();
        break;
      case 'jump':
        ok = this.startJump();
        break;
      case 'heal':
        ok = this.startHeal();
        break;
    }
    // A refused press (no stamina) is dropped so it does not fire late and surprise the player.
    this.buffer = null;
    return ok;
  }

  // ------------------------------------------------------------------ actions

  private pickTarget(ctx: FightContext, reach: number): GolemTarget | null {
    let best: GolemTarget | null = null;
    let bestScore = Infinity;
    const wishYaw = this.moveMag > 0.2 ? dirToYaw(this.moveWish.x, this.moveWish.z) : this.yaw;
    for (const t of ctx.golem.targets) {
      if (!t.open) continue;
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      const dh = Math.hypot(dx, dz);
      if (dh - t.radius > reach + 1.6) continue;
      const dy = t.pos.y - this.y;
      if (dy - t.radius > 3.4 || dy + t.radius < 0) continue;
      const ang = Math.abs(angleDiff(wishYaw, Math.atan2(dx, dz)));
      if (ang > 115 * DEG && dh > 1.5) continue;
      const score = dh + ang * 2;
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  private startLight(ctx: FightContext): boolean {
    if (!this.spend(this.B.light.stamina)) return false;
    const L = this.B.light;
    const next = this.comboTimer > 0 || this.state === 'light' ? (this.combo + 1) % L.combo.length : 0;
    this.combo = next;
    const c = L.combo[next];
    this.beginAttack(ctx, {
      heavy: false,
      index: next,
      windup: c.windup,
      active: c.active,
      recovery: c.recovery,
      damage: c.damage,
      breakAmount: c.break,
      reach: c.reach,
      arc: c.arc,
      maxHeight: next === 2 ? 3.3 : 2.9,
      lunge: c.lunge,
    });
    const P = this.poses;
    const wind = [P.l1Wind, P.l2Wind, P.l3Wind][next];
    const strike = [P.l1Strike, P.l2Strike, P.l3Strike][next];
    this.anim.play([
      { name: 'wind', dur: c.windup, pose: wind, ease: 'outQuad' },
      { name: 'strike', dur: c.active, pose: strike, ease: 'outCubic' },
      { name: 'recover', dur: c.recovery, pose: P.idle, ease: 'inOutSine' },
    ]);
    this.setState('light');
    bus.emit('swing', { heavy: false, charged: false, pos: this.pos });
    return true;
  }

  private startHeavy(ctx: FightContext): boolean {
    if (!this.spend(this.B.heavy.stamina)) return false;
    const H = this.B.heavy;
    this.combo = -1;
    this.beginAttack(ctx, {
      heavy: true,
      index: 0,
      windup: H.windup,
      active: H.active,
      recovery: H.recovery,
      damage: H.damage,
      breakAmount: H.break,
      reach: H.reach,
      arc: H.arc,
      maxHeight: 3.4,
      lunge: H.lunge,
    });
    const P = this.poses;
    const steps: Step[] = [
      { name: 'wind', dur: H.windup, pose: P.heavyWind, ease: 'outCubic' },
      {
        name: 'charge',
        dur: H.chargeMax,
        pose: (out, t) => {
          out.copy(P.heavyWind);
          // tremble while charging
          const s = Math.sin(this.time * 60) * 1.5 * t;
          out.addEuler(this.rig.i('chest'), -3 * t + s, 0, 0);
          out.pos.y -= 0.04 * t;
        },
        ease: 'linear',
        update: (t) => {
          if (this.atk) {
            this.atk.charge = t;
            this.atk.charged = t > 0.98;
          }
        },
      },
      {
        name: 'strike',
        dur: H.active,
        pose: P.heavyStrike,
        ease: 'inQuad',
        enter: () => bus.emit('swing', { heavy: true, charged: !!this.atk?.charged, pos: this.pos }),
      },
      { name: 'recover', dur: H.recovery, pose: P.idle, ease: 'inOutSine' },
    ];
    this.anim.play(steps);
    this.setState('heavy');
    return true;
  }

  private beginAttack(ctx: FightContext, a: Omit<AttackRun, 'lunged' | 'target' | 'charged' | 'charge' | 'chargeDone' | 'resolved'>): void {
    const target = this.pickTarget(ctx, a.reach);
    this.atk = { ...a, lunged: 0, target, charged: false, charge: 0, chargeDone: !a.heavy, resolved: 'none' };
    this.stats.swings++;
    this.blocking = false;
    // snap most of the way toward the target (or lock target / move wish) right away
    let aimYaw: number | null = null;
    if (target) aimYaw = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
    else if (this.locked) {
      ctx.golem.lockPoint(_v);
      aimYaw = Math.atan2(_v.x - this.pos.x, _v.z - this.pos.z);
    } else if (this.moveMag > 0.2) aimYaw = dirToYaw(this.moveWish.x, this.moveWish.z);
    if (aimYaw !== null) this.yaw += angleDiff(this.yaw, aimYaw) * 0.6;
    this.vel.multiplyScalar(0.3);
  }

  private startRoll(): boolean {
    if (!this.spend(this.B.roll.stamina)) return false;
    if (this.moveMag > 0.2) this.rollDir.copy(this.moveWish);
    else yawToDir(this.yaw + Math.PI, this.rollDir);
    this.rollDir.y = 0;
    this.rollDir.normalize();
    this.rollDone = 0;
    this.atk = null;
    this.blocking = false;
    const backward = this.moveMag <= 0.2;
    if (!backward) this.yaw = dirToYaw(this.rollDir.x, this.rollDir.z);
    this.setState('roll');
    this.stats.rolls++;
    const R = this.B.roll;
    const P = this.poses;
    const dir = backward ? -1 : 1;
    this.anim.play([
      {
        name: 'roll',
        dur: R.duration,
        ease: 'linear',
        pose: (out, t) => {
          // tuck in, somersault around the body centre, untuck at the end
          const tuck = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
          out.blend(P.idle, P.rollTuck, ease.inOutSine(Math.max(0, Math.min(1, tuck))));
          const a = ease.inOutSine(Math.min(1, t / 0.9)) * Math.PI * 2 * dir;
          const h = 0.55;
          out.rot.setFromAxisAngle(_v2.set(1, 0, 0), a);
          out.pos.set(0, h - h * Math.cos(a) - 0.42 * tuck, -h * Math.sin(a));
        },
      },
    ]);
    bus.emit('roll', { pos: this.pos });
    return true;
  }

  private startJump(): boolean {
    if (!this.spend(this.B.jump.stamina)) return false;
    this.vy = this.B.jump.velocity;
    this.y = 0.001;
    this.atk = null;
    this.blocking = false;
    this.setState('air');
    this.anim.play([{ name: 'air', dur: 0.18, pose: this.poses.jump, ease: 'outQuad' }, { name: 'hold', dur: 10, pose: this.poses.jump }]);
    bus.emit('jump', { pos: this.pos });
    return true;
  }

  private startHeal(): boolean {
    if (this.flasks <= 0) {
      bus.emit('healEmpty', {});
      return false;
    }
    const F = this.B.flask;
    this.healDone = false;
    this.blocking = false;
    this.atk = null;
    this.setState('heal');
    this.anim.play([
      { name: 'raise', dur: F.drinkTime * 0.35, pose: this.poses.heal, ease: 'outQuad' },
      { name: 'drink', dur: F.drinkTime * 0.4, pose: this.poses.heal },
      { name: 'lower', dur: F.drinkTime * 0.25, pose: this.poses.idle },
    ]);
    bus.emit('healStart', { pos: this.pos });
    return true;
  }

  // ------------------------------------------------------------------ damage

  takeHit(h: IncomingHit): HitOutcome {
    if (!this.alive) return 'ignored';
    if (this.invulnerable) {
      if (this.lastOutcome !== 'dodged' || this.time - this.lastDodge > 0.3) bus.emit('dodged', { pos: this.pos });
      this.lastDodge = this.time;
      this.lastOutcome = 'dodged';
      return 'dodged';
    }
    const B = this.B;
    _v.subVectors(h.from, this.pos);
    _v.y = 0;
    const fromYaw = Math.atan2(_v.x, _v.z);
    const facing = Math.abs(angleDiff(this.yaw, fromYaw)) <= B.block.arc * 0.5 * DEG;
    const away = _v.lengthSq() > 1e-6 ? _v.normalize().multiplyScalar(-1) : yawToDir(this.yaw + Math.PI, _v);
    this.lastHitSource = h.source;

    if (this.blocking && facing && !h.unblockable && this.state === 'move') {
      if (this.time - this.blockStart <= B.block.justGuardWindow) {
        this.stamina = Math.max(0, this.stamina - h.damage * B.block.staminaPerDamage * B.block.justGuardStaminaMultiplier);
        this.staminaDelay = B.staminaRegenDelay;
        this.knockVel.copy(away).multiplyScalar(1.5);
        bus.emit('justGuard', { pos: this.pos });
        this.lastOutcome = 'justguard';
        return 'justguard';
      }
      const cost = h.damage * B.block.staminaPerDamage;
      const chip = h.damage * (1 - B.block.damageReduction);
      this.applyDamage(chip);
      if (this.stamina >= cost) {
        this.stamina -= cost;
        this.staminaDelay = B.staminaRegenDelay;
        this.knockVel.copy(away).multiplyScalar(Math.min(6, 2 + h.damage * 0.08));
        bus.emit('playerBlock', { damage: chip, pos: this.pos, staminaCost: cost });
        this.lastOutcome = 'blocked';
        if (this.hp <= 0) this.die();
        return 'blocked';
      }
      this.stamina = 0;
      this.staminaDelay = B.exhaustedRegenDelay;
      this.blocking = false;
      this.knockVel.copy(away).multiplyScalar(5);
      bus.emit('guardBreak', { pos: this.pos });
      if (this.hp <= 0) {
        this.die();
        return 'hit';
      }
      this.setState('guardbreak');
      this.anim.play([
        { name: 'stagger', dur: 0.2, pose: this.poses.hit, ease: 'outQuad' },
        { name: 'hold', dur: B.block.guardBreakStun - 0.45, pose: this.poses.hit },
        { name: 'recover', dur: 0.25, pose: this.poses.idle },
      ]);
      this.lastOutcome = 'guardbreak';
      return 'guardbreak';
    }

    this.applyDamage(h.damage);
    this.stats.hits++;
    this.hitFlash = 1;
    bus.emit('playerHit', { damage: h.damage, pos: this.pos, knockdown: !!h.knockdown, source: h.source });
    this.lastOutcome = 'hit';
    this.atk = null;
    this.blocking = false;
    if (this.hp <= 0) {
      this.knockVel.copy(away).multiplyScalar(h.knockback ?? 6);
      this.die();
      return 'hit';
    }
    if (h.knockdown) {
      this.knockVel.copy(away).multiplyScalar(h.knockback ?? 8);
      // thrown: a short toss before the fall (a colossus does not just nudge you)
      this.vy = Math.max(this.vy, 4.2);
      this.knockdown();
    } else {
      this.knockVel.copy(away).multiplyScalar(h.knockback ?? 4);
      this.setState('hit');
      this.anim.play([
        { name: 'flinch', dur: 0.07, pose: this.poses.hit, ease: 'outQuad' },
        { name: 'hold', dur: 0.1, pose: this.poses.hit },
        { name: 'recover', dur: Math.max(0.05, B.hitStun - 0.17), pose: this.poses.idle, ease: 'inOutSine' },
      ]);
    }
    return 'hit';
  }

  /** Damage over time from floor hazards: no flinch, blocked by i-frames and jumps. */
  burn(amount: number): boolean {
    if (!this.alive || this.invulnerable || this.airborne) return false;
    this.applyDamage(amount);
    if (this.burnJolt <= 0) this.burnJolt = 0.3;
    this.lastHitSource = 'hazard';
    if (this.hp <= 0) this.die();
    return true;
  }

  private applyDamage(d: number): void {
    if (d <= 0) return;
    this.hp -= d;
    this.stats.damageTaken += d;
    if (this.god && this.hp < 1) this.hp = 1;
  }

  private knockdown(): void {
    const K = this.B.knockdown;
    this.setState('down');
    this.anim.play([
      { name: 'fall', dur: K.fall, pose: this.poses.down, ease: 'outQuad' },
      { name: 'lie', dur: K.lie, pose: this.poses.down },
      { name: 'getup', dur: K.getup * 0.55, pose: this.poses.getup, ease: 'inOutSine' },
      { name: 'stand', dur: K.getup * 0.45, pose: this.poses.idle, ease: 'outQuad' },
    ]);
  }

  private die(): void {
    this.hp = 0;
    this.atk = null;
    this.blocking = false;
    this.locked = false;
    this.setState('dead');
    this.anim.play([
      { name: 'recoil', dur: 0.12, pose: this.poses.hit, ease: 'outQuad' },
      { name: 'kneel', dur: 0.5, pose: this.poses.kneelDeath, ease: 'outQuad' },
      { name: 'hold', dur: 0.35, pose: this.poses.kneelDeath },
      { name: 'fall', dur: 0.6, pose: this.poses.faceDown, ease: 'inQuad' },
      { name: 'still', dur: 100, pose: this.poses.faceDown },
    ]);
    bus.emit('playerDeath', { pos: this.pos });
  }

  // ------------------------------------------------------------------ update

  update(dt: number, ctx: FightContext): void {
    const B = this.B;
    this.time += dt;
    this.stateTime += dt;
    if (this.buffer && this.time - this.buffer.t > B.inputBuffer) this.buffer = null;
    if (this.comboTimer > 0) this.comboTimer -= dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);

    if (this.lockToggle) {
      this.lockToggle = false;
      if (this.alive) {
        this.locked = !this.locked && ctx.golem.lockable;
        bus.emit('lockOn', { on: this.locked });
      }
    }
    if (this.locked && !ctx.golem.lockable) {
      this.locked = false;
      bus.emit('lockOn', { on: false });
    }

    // stamina
    const busy = this.state === 'light' || this.state === 'heavy' || this.state === 'roll' || this.state === 'air';
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (!busy && this.stamina < B.maxStamina) {
      const mult = this.blocking ? B.blockingRegenMultiplier : 1;
      this.stamina = Math.min(B.maxStamina, this.stamina + B.staminaRegen * mult * dt);
    }

    let speedCap = 0;
    let face: 'move' | 'lock' | 'none' | 'attack' = 'none';
    const allowedAll: Act[] = ['roll', 'jump', 'light', 'heavy', 'heal'];

    switch (this.state) {
      case 'move': {
        if (this.tryBuffered(ctx, allowedAll)) break;
        const wantBlock = this.held.block;
        if (wantBlock && !this.blocking) this.blockStart = this.time;
        this.blocking = wantBlock;
        speedCap = this.blocking ? B.blockMoveSpeed : B.runSpeed;
        face = this.locked ? 'lock' : 'move';
        break;
      }
      case 'light':
      case 'heavy': {
        const a = this.atk;
        if (!a) {
          this.setState('move');
          break;
        }
        const chargeLen = a.heavy ? a.charge * B.heavy.chargeMax : 0;
        // heavy: stop charging when the button is released
        if (a.heavy && !a.chargeDone && this.anim.seq?.stepName === 'charge' && !this.held.heavy) {
          a.chargeDone = true;
          this.anim.seq.skipStep();
        }
        if (a.heavy && this.anim.seq?.stepName === 'strike' && !a.chargeDone) a.chargeDone = true;
        const t = this.stateTime;
        const windEnd = a.windup + chargeLen;
        const inWind = a.heavy ? this.anim.seq?.stepName === 'wind' || this.anim.seq?.stepName === 'charge' : t < a.windup;
        const inActive = a.heavy ? this.anim.seq?.stepName === 'strike' : t >= a.windup && t < a.windup + a.active;
        const inRecover = !inWind && !inActive;
        if (inWind) face = 'attack';
        // lunge during wind-up and strike
        if ((inWind || inActive) && a.lunged < a.lunge) {
          const total = a.windup + a.active;
          const step = (a.lunge / total) * dt * 1.4;
          let allow = true;
          if (a.target) {
            const d = Math.hypot(a.target.pos.x - this.pos.x, a.target.pos.z - this.pos.z) - a.target.radius;
            if (d < 1.2) allow = false;
          }
          if (allow) {
            yawToDir(this.yaw, _fwd);
            this.pos.addScaledVector(_fwd, step);
            a.lunged += step;
          }
        }
        if (inActive) {
          if (a.heavy && a.charged && a.damage === B.heavy.damage) {
            a.damage = B.heavy.chargedDamage;
            a.breakAmount = B.heavy.chargedBreak;
          }
          if (a.resolved === 'none') this.resolveSwing(ctx, a);
          if (a.heavy && a.resolved === 'none' && !a.chargeDone) a.chargeDone = true;
        }
        if (inRecover) {
          if (a.resolved === 'none') {
            a.resolved = 'whiff';
            this.stats.whiffs++;
            bus.emit('whiff', { heavy: a.heavy });
          }
          const sinceRecover = a.heavy ? (this.anim.seq ? this.anim.seq.time : 1) : t - windEnd - a.active;
          if (this.tryBuffered(ctx, ['roll', 'jump'])) break;
          if (sinceRecover >= B.light.chainAfter && this.tryBuffered(ctx, ['light', 'heavy', 'heal'])) break;
          // allow walking out of the tail of the recovery
          if (!this.anim.busy) {
            this.atk = null;
            if (!a.heavy) this.comboTimer = B.light.comboResetTime;
            this.setState('move');
          } else if (this.moveMag > 0.2 && sinceRecover > (a.heavy ? 0.3 : 0.2)) {
            this.atk = null;
            if (!a.heavy) this.comboTimer = B.light.comboResetTime;
            this.anim.stop(0.2);
            this.setState('move');
          }
        }
        break;
      }
      case 'roll': {
        const R = B.roll;
        const u = Math.min(1, this.stateTime / R.duration);
        // fast start, smooth stop
        const prog = 0.7 * Math.sin((u * Math.PI) / 2) + 0.3 * u;
        const target = prog * R.distance;
        const step = target - this.rollDone;
        this.rollDone = target;
        this.pos.addScaledVector(this.rollDir, step);
        this.vel.copy(this.rollDir).multiplyScalar(R.distance / R.duration);
        if (this.stateTime >= R.chainAfter && this.tryBuffered(ctx, allowedAll)) break;
        if (this.stateTime >= R.duration) {
          this.vel.multiplyScalar(0.4);
          this.setState('move');
        }
        break;
      }
      case 'air': {
        const J = B.jump;
        this.vy -= J.gravity * dt;
        this.y += this.vy * dt;
        // limited air control
        if (this.moveMag > 0.1) {
          this.vel.addScaledVector(this.moveWish, B.runSpeed * J.airControl * dt * 4);
          const sp = Math.hypot(this.vel.x, this.vel.z);
          if (sp > B.runSpeed) this.vel.multiplyScalar(B.runSpeed / sp);
        }
        this.pos.addScaledVector(this.vel, dt);
        if (this.y <= 0 && this.vy < 0) {
          this.y = 0;
          this.vy = 0;
          this.setState('land');
          this.anim.play([
            { name: 'land', dur: 0.08, pose: this.poses.land, ease: 'outQuad' },
            { name: 'rise', dur: J.landRecovery + 0.1, pose: this.poses.idle },
          ]);
          bus.emit('land', { pos: this.pos, hard: false });
        }
        break;
      }
      case 'land': {
        this.vel.multiplyScalar(Math.exp(-10 * dt));
        if (this.stateTime >= B.jump.landRecovery) {
          if (this.tryBuffered(ctx, allowedAll)) break;
          this.setState('move');
        }
        break;
      }
      case 'heal': {
        const F = B.flask;
        speedCap = B.healMoveSpeed;
        face = this.locked ? 'lock' : 'move';
        if (!this.healDone && this.stateTime >= F.drinkTime * F.healAt) {
          this.healDone = true;
          this.flasks--;
          this.stats.flasksUsed++;
          const before = this.hp;
          this.hp = Math.min(B.maxHealth, this.hp + F.heal);
          bus.emit('heal', { amount: this.hp - before, pos: this.pos });
        }
        if (this.stateTime >= F.drinkTime) this.setState('move');
        break;
      }
      case 'hit': {
        if (this.stateTime >= B.hitStun * 0.6 && this.tryBuffered(ctx, ['roll'])) break;
        if (this.stateTime >= B.hitStun) this.setState('move');
        break;
      }
      case 'guardbreak': {
        if (this.stateTime >= B.block.guardBreakStun) this.setState('move');
        break;
      }
      case 'deflect': {
        if (this.stateTime >= 0.1 && this.tryBuffered(ctx, ['roll', 'jump'])) break;
        if (this.stateTime >= B.deflectRecoil) {
          if (this.tryBuffered(ctx, allowedAll)) break;
          this.setState('move');
        }
        break;
      }
      case 'down': {
        const K = B.knockdown;
        // airborne knockdowns land first
        if (this.y > 0 || this.vy > 0) {
          this.vy -= B.jump.gravity * dt;
          this.y = Math.max(0, this.y + this.vy * dt);
          if (this.y === 0) this.vy = 0;
        }
        // roll out of the knockdown once on the ground
        if (this.stateTime >= K.fall && this.tryBuffered(ctx, ['roll'])) break;
        if (this.stateTime >= K.fall + K.lie + K.getup) this.setState('move');
        break;
      }
      case 'dead': {
        if (this.y > 0 || this.vy > 0) {
          this.vy -= B.jump.gravity * dt;
          this.y = Math.max(0, this.y + this.vy * dt);
        }
        break;
      }
    }
    if (this.state !== 'move') this.blocking = false;

    // horizontal locomotion
    if (this.state === 'move' || this.state === 'heal') {
      _v.copy(this.moveWish).multiplyScalar(speedCap * this.moveMag);
      _v2.subVectors(_v, this.vel);
      const maxDv = B.acceleration * dt;
      const l = _v2.length();
      if (l > maxDv) _v2.multiplyScalar(maxDv / l);
      this.vel.add(_v2);
      this.pos.addScaledVector(this.vel, dt);
    } else if (this.state !== 'roll' && this.state !== 'air') {
      this.vel.multiplyScalar(Math.exp(-12 * dt));
      this.pos.addScaledVector(this.vel, dt);
    }
    // knockback
    if (this.knockVel.lengthSq() > 1e-4) {
      this.pos.addScaledVector(this.knockVel, dt);
      this.knockVel.multiplyScalar(Math.exp(-5.5 * dt));
    }

    // facing
    if (face === 'move' && this.moveMag > 0.1) {
      this.yaw = rotateToward(this.yaw, dirToYaw(this.moveWish.x, this.moveWish.z), B.turnRate * dt);
    } else if (face === 'lock') {
      ctx.golem.lockPoint(_v);
      this.yaw = rotateToward(this.yaw, Math.atan2(_v.x - this.pos.x, _v.z - this.pos.z), B.turnRate * 0.8 * dt);
    } else if (face === 'attack' && this.atk) {
      let aim: number | null = null;
      if (this.atk.target) aim = Math.atan2(this.atk.target.pos.x - this.pos.x, this.atk.target.pos.z - this.pos.z);
      else if (this.locked) {
        ctx.golem.lockPoint(_v);
        aim = Math.atan2(_v.x - this.pos.x, _v.z - this.pos.z);
      }
      if (aim !== null) this.yaw = rotateToward(this.yaw, aim, 16 * dt);
    }

    ctx.world.resolve(this.pos, PLAYER_RADIUS);

    // animation locomotion values
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moving = (this.state === 'move' || this.state === 'heal') && speed > 0.3;
    this.moveAmount += ((moving ? Math.min(1, speed / B.runSpeed) : 0) - this.moveAmount) * Math.min(1, dt * 10);
    if (speed > 0.05) {
      const lx = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
      const lz = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
      const l = Math.hypot(lx, lz) || 1;
      this.localX += (lx / l - this.localX) * Math.min(1, dt * 10);
      this.localZ += (lz / l - this.localZ) * Math.min(1, dt * 10);
    }
    const prevGait = this.gait;
    this.gait = (this.gait + (speed * dt) / STRIDE) % 1;
    if (moving && ((prevGait < 0.5 && this.gait >= 0.5) || this.gait < prevGait)) {
      bus.emit('footstep', { pos: this.pos, run: speed > 3 });
    }
    this.blockWeight += ((this.blocking ? 1 : 0) - this.blockWeight) * Math.min(1, dt * 18);

    this.anim.update(dt, (out) => {
      warriorRun(out, this.poses.idle, this.rig, this.gait, this.moveAmount, this.localX, this.localZ, true);
      if (this.blockWeight > 0.001) out.blend(out, this.poses.block, this.blockWeight);
      warriorBreath(out, this.rig, this.time, 1 - this.moveAmount);
    });
    // a core above the chest: lean back and lift the sword arm so the blade meets it (a flat slash under a
    // raised fist looked like a miss that counted anyway)
    // standing in fire: a sharp little flinch, repeated while it burns
    if (this.burnJolt > 0) {
      this.burnJolt -= dt;
      const k = Math.sin(Math.max(0, this.burnJolt) / 0.3 * Math.PI);
      this.rig.bone('chest').rotation.x += 0.22 * k;
      this.rig.bone('head').rotation.x += 0.2 * k;
      this.rig.bone('upperarm_L').rotation.z += 0.3 * k;
    }
    const tgt = this.atk?.target;
    const aimWant = tgt ? Math.min(1, Math.max(0, (tgt.pos.y - (this.y + 1.3)) / 1.8)) : 0;
    this.aimW += (aimWant - this.aimW) * Math.min(1, dt * 12);
    if (this.aimW > 0.01) {
      this.rig.bone('chest').rotation.x -= 0.3 * this.aimW;
      this.rig.bone('upperarm_R').rotation.x -= 0.55 * this.aimW;
    }
    this.syncRig();
  }

  private syncRig(): void {
    this.rig.root.position.set(this.pos.x, this.y, this.pos.z);
    this.rig.root.rotation.set(0, this.yaw, 0);
    this.rig.update();
  }

  // ------------------------------------------------------------------ sword

  private resolveSwing(ctx: FightContext, a: AttackRun): void {
    const g = ctx.golem;
    let best: GolemTarget | null = null;
    let bestScore = Infinity;
    for (const t of g.targets) {
      if (!t.open) continue;
      // cores are generous targets: the blade only has to pass near the glow
      const r = t.radius + CORE_GRACE;
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      const dh = Math.hypot(dx, dz);
      if (dh - r > a.reach) continue;
      const dy = t.pos.y - this.y;
      if (dy - r > a.maxHeight || dy + r < 0.05) continue;
      let score = dh;
      if (dh > r + 0.6) {
        const ang = Math.abs(angleDiff(this.yaw, Math.atan2(dx, dz)));
        const arc = Math.max(a.arc * 0.5, dh < 3 ? 60 : 0) * DEG;
        if (ang > arc) continue;
        score += ang * 1.5;
      }
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    yawToDir(this.yaw, _fwd);
    if (best) {
      // the burst sits on the side of the core facing the sword hand, where the blade meets it
      this.rig.worldPos(this.rig.i('hand_R'), _p);
      _p.sub(best.pos);
      if (_p.lengthSq() < 1e-6) _p.set(this.pos.x - best.pos.x, this.y + 1.2 - best.pos.y, this.pos.z - best.pos.z);
      _p.normalize();
      const hitPos = best.pos.clone().addScaledVector(_p, best.radius * 0.8);
      const hit: SwordHit = {
        kind: 'core',
        core: best,
        damage: a.damage,
        breakAmount: a.breakAmount,
        heavy: a.heavy,
        charged: a.charged,
        pos: hitPos,
        normal: _p.clone(),
      };
      const r = g.receiveSwordHit(hit);
      if (r === 'core' || r === 'crit') {
        a.resolved = 'core';
        this.stats.coreHits++;
        return;
      }
      if (r === 'body') {
        a.resolved = 'body';
        this.stats.bodyHits++;
        return;
      }
      this.deflect(hit.pos, hit.normal, a);
      return;
    }
    // stone: sample the swing arc against the golem's body capsules
    const caps = g.capsules;
    const angles = [-0.5, -0.25, 0, 0.25, 0.5];
    const heights = [0.9, 1.5, Math.min(2.6, a.maxHeight - 0.3)];
    const radii = [a.reach * 0.5, a.reach * 0.85];
    for (const ang of angles) {
      const yy = this.yaw + ang * a.arc * DEG;
      const dx = Math.sin(yy);
      const dz = Math.cos(yy);
      for (const r of radii) {
        for (const h of heights) {
          _p.set(this.pos.x + dx * r, this.y + h, this.pos.z + dz * r);
          for (const cap of caps) {
            closestOnSeg(cap.a, cap.b, _p, _c);
            if (_c.distanceToSquared(_p) < cap.r * cap.r) {
              const normal = _p.clone().sub(_c).normalize();
              const hit: SwordHit = {
                kind: 'body',
                damage: a.damage,
                breakAmount: 0,
                heavy: a.heavy,
                charged: a.charged,
                pos: _c.clone().addScaledVector(normal, cap.r),
                normal,
              };
              const res = g.receiveSwordHit(hit);
              if (res === 'body') {
                a.resolved = 'body';
                this.stats.bodyHits++;
                return;
              }
              this.deflect(hit.pos, normal, a);
              return;
            }
          }
        }
      }
    }
  }

  private deflect(pos: THREE.Vector3, normal: THREE.Vector3, a: AttackRun): void {
    a.resolved = 'deflect';
    this.stats.deflects++;
    bus.emit('deflect', { pos: pos.clone(), normal: normal.clone(), heavy: a.heavy });
    this.atk = null;
    this.combo = -1;
    this.comboTimer = 0;
    this.setState('deflect');
    this.knockVel.copy(yawToDir(this.yaw + Math.PI, _v)).multiplyScalar(2.2);
    this.anim.play([
      { name: 'recoil', dur: 0.09, pose: this.poses.deflect, ease: 'outQuad' },
      { name: 'recover', dur: this.B.deflectRecoil - 0.09 + 0.1, pose: this.poses.idle, ease: 'inOutSine' },
    ]);
  }

  /** Red hit flash amount for UI/vignette. */
  get hurtFlash(): number {
    return this.hitFlash;
  }

  get healthFrac(): number {
    return clamp(this.hp / this.B.maxHealth, 0, 1);
  }
}

function closestOnSeg(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}
