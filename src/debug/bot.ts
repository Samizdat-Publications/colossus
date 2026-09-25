import * as THREE from 'three';
import type { ActionName, VirtualInput } from '../core/input';
import type { Game } from '../game/game';
import { balance } from '../core/balance';
import { angleDiff, rng, RNG } from '../core/math';

/**
 * In-page bot that plays through the same virtual input a player uses. It sees what a player
 * sees (attack wind-ups, rings, rocks) and reacts after a human-like delay with timing noise.
 * `expert` rarely errs; `decent` is a proxy for a reasonable first-week Souls player; `idle` stands still.
 */
export interface BotSkill {
  reaction: number; // seconds before it notices a new wind-up
  noise: number; // timing noise (seconds, std-dev-ish)
  miss: number; // chance to not react to a threat at all
  greed: number; // 0..1, how long it keeps attacking into a closing window
  heal: number; // HP fraction under which it drinks
}

export const SKILLS: Record<string, BotSkill> = {
  expert: { reaction: 0.18, noise: 0.03, miss: 0.02, greed: 0.3, heal: 0.5 },
  decent: { reaction: 0.3, noise: 0.08, miss: 0.1, greed: 0.55, heal: 0.42 },
  novice: { reaction: 0.42, noise: 0.14, miss: 0.25, greed: 0.8, heal: 0.3 },
  idle: { reaction: 9, noise: 0, miss: 1, greed: 0, heal: 0 },
};

const _d = new THREE.Vector3();
const _t = new THREE.Vector3();

export class Bot {
  readonly v: VirtualInput = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, held: new Set<ActionName>() };
  private pressQueue: ActionName[] = [];
  private lastAttackKey = '';
  private noticedAt = -1;
  private ignoreThis = false;
  private seenWaves = new WeakSet<object>();
  private seenRocks = new WeakSet<object>();
  private handledRocks = new WeakSet<object>();
  private seenTeles = new WeakSet<object>();
  private lastPress = 0;
  private readonly r: RNG;
  mode: string;

  constructor(
    private readonly game: Game,
    readonly skill: BotSkill,
    seed = 99,
  ) {
    this.mode = Object.keys(SKILLS).find((k) => SKILLS[k] === skill) ?? 'custom';
    this.r = new RNG(seed);
    game.input.virtual = this.v;
  }

  private press(a: ActionName): void {
    this.pressQueue.push(a);
  }

  /** Move toward a world-space direction (normalized XZ), camera-relative for the input. */
  private moveWorld(dx: number, dz: number, speed = 1): void {
    const c = this.game.cam.moveYaw;
    const fx = Math.sin(c);
    const fz = Math.cos(c);
    const rx = -Math.cos(c);
    const rz = Math.sin(c);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    this.v.moveY = (dx * fx + dz * fz) * speed;
    this.v.moveX = (dx * rx + dz * rz) * speed;
  }

  private noisy(t: number): number {
    return t + (this.r.next() - 0.5) * 2 * this.skill.noise;
  }

  update(): void {
    const g = this.game;
    const v = this.v;
    // release one-frame presses from last frame, then apply queued presses
    for (const a of ['light', 'heavy', 'roll', 'jump', 'heal', 'lock', 'confirm'] as ActionName[]) {
      if (!this.pressQueue.includes(a)) v.held.delete(a);
    }
    for (const a of this.pressQueue) v.held.add(a);
    this.pressQueue = [];
    v.moveX = v.moveY = v.lookX = v.lookY = 0;

    if (this.mode === 'idle') return;
    const flow = g.flow;
    if (flow !== 'fight') {
      v.held.delete('block');
      v.held.delete('heavy');
      return;
    }
    const p = g.player;
    const golem = g.golem;
    const now = g.ctx.time;
    if (!p.alive) return;
    if (!p.locked && golem.lockable && now - this.lastPress > 0.3) {
      this.press('lock');
      this.lastPress = now;
      return;
    }

    const toG = _d.set(golem.pos.x - p.pos.x, 0, golem.pos.z - p.pos.z);
    const dG = toG.length();
    toG.normalize();

    // ---------------------------------------------------------------- threats
    const att = golem.attack?.name ?? '';
    const step = golem.step;
    const key = `${att}:${golem.attack ? golem.anim.seq?.steps.length : 0}:${golem.anim.seq ? golem.anim.seq.steps[0].name : ''}`;
    if (golem.attack && key + String(golem.attack.side) !== this.lastAttackKey) {
      this.lastAttackKey = key + String(golem.attack.side);
      this.noticedAt = now + this.noisy(this.skill.reaction);
      this.ignoreThis = this.r.chance(this.skill.miss);
    }
    if (!golem.attack) this.lastAttackKey = '';
    const noticed = golem.attack && now >= this.noticedAt && !this.ignoreThis;

    let wantDodge = false;
    let dodgeDir: THREE.Vector3 | null = null;
    let kind: 'roll' | 'jump' = 'roll';

    // shockwave rings
    for (const w of g.threats.waves) {
      if (w.hit) continue;
      const d = Math.hypot(p.pos.x - w.center.x, p.pos.z - w.center.z);
      const gap = d - w.r;
      if (gap < -0.8) continue;
      const tArrive = gap / w.speed;
      if (!this.seenWaves.has(w)) {
        this.seenWaves.add(w);
        if (this.r.chance(this.skill.miss)) (w as unknown as { __ignored: boolean }).__ignored = true;
      }
      if ((w as unknown as { __ignored?: boolean }).__ignored) continue;
      const jump = this.r.chance(0.4);
      const lead = jump ? 0.16 : 0.2;
      if (this.noisy(tArrive) < lead) {
        wantDodge = true;
        kind = jump && p.stamina > balance.player.jump.stamina ? 'jump' : 'roll';
        dodgeDir = _t.set(p.pos.x - w.center.x, 0, p.pos.z - w.center.z).normalize().clone();
      }
    }
    // rocks / meteors / leap / slam telegraphs
    for (const tl of g.threats.telegraphs) {
      const d = Math.hypot(p.pos.x - tl.pos.x, p.pos.z - tl.pos.z);
      if (d > tl.radius + 1.3) continue;
      if (!this.seenTeles.has(tl)) {
        this.seenTeles.add(tl);
        if (this.r.chance(this.skill.miss)) (tl as unknown as { __ignored: boolean }).__ignored = true;
      }
      if ((tl as unknown as { __ignored?: boolean }).__ignored) continue;
      const left = tl.dur - tl.t;
      let lead = 0.32;
      if (tl.kind === 'slam') {
        // slam telegraph ends at impact
        lead = 0.3;
      }
      if (this.noisy(left) < lead) {
        wantDodge = true;
        const away = _t.set(p.pos.x - tl.pos.x, 0, p.pos.z - tl.pos.z);
        if (away.lengthSq() < 0.1) away.set(-toG.z, 0, toG.x);
        away.normalize();
        // roll sideways relative to the golem when the threat is between us
        const side = new THREE.Vector3(-toG.z, 0, toG.x);
        if (side.dot(away) < 0) side.multiplyScalar(-1);
        dodgeDir = away.add(side).normalize().clone();
      }
    }
    for (const rk of g.threats.rocks) {
      if (this.handledRocks.has(rk)) continue;
      if (!this.seenRocks.has(rk)) this.seenRocks.add(rk);
    }
    // sweep: get under the arm or out of range when the strike starts
    if (noticed && (att === 'sweep' || att === 'sweepCombo')) {
      const tStrike = golem.timeUntil('strike');
      if (step === 'windup' && this.noisy(tStrike) < 0.12 && dG > 4 && dG < 13.5) {
        wantDodge = true;
        dodgeDir = dG < 8.5 ? toG.clone() : toG.clone().multiplyScalar(-1);
      }
    }
    // stomp: too close to the foot
    if (noticed && (att === 'stomp' || att === 'doubleStomp') && step === 'windup' && dG < 7.5) {
      const tStrike = golem.timeUntil('strike');
      if (this.noisy(tStrike) < 0.25) {
        wantDodge = true;
        dodgeDir = toG.clone().multiplyScalar(-1);
      }
    }
    // rising from stagger / roaring pushes
    if ((golem.state === 'stagger' && step === 'rise') || (golem.state === 'transition' && step === 'rear')) {
      if (dG < 9) {
        this.moveWorld(-toG.x, -toG.z);
        v.held.delete('heavy');
        return;
      }
    }
    // fissure heading our way
    for (const f of g.threats.fissures) {
      const rel = _t.set(p.pos.x - f.from.x, 0, p.pos.z - f.from.z);
      const along = rel.dot(f.dir) - f.start;
      const lateral = Math.abs(rel.x * f.dir.z - rel.z * f.dir.x);
      const tHit = (f.delay - f.t) + Math.max(0, along - f.dist) / f.speed;
      if (lateral < 2.4 && along > f.dist - 0.5 && this.noisy(tHit) < 0.3) {
        wantDodge = true;
        dodgeDir = new THREE.Vector3(-f.dir.z, 0, f.dir.x);
        if (rel.x * dodgeDir.x + rel.z * dodgeDir.z < 0) dodgeDir.multiplyScalar(-1);
      }
    }

    const canAct = p.state === 'move' || p.state === 'land' || (p.state === 'light' && p.atk?.resolved !== 'none');
    if (wantDodge && dodgeDir && (canAct || p.state === 'light' || p.state === 'heal') && p.state !== 'roll') {
      this.moveWorld(dodgeDir.x, dodgeDir.z);
      if (now - this.lastPress > 0.12) {
        this.press(kind);
        this.lastPress = now;
      }
      v.held.delete('heavy');
      return;
    }

    // hazards: step out
    for (const h of g.threats.hazards) {
      const d = Math.hypot(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
      if (d < h.radius + 0.6 && h.t > h.arm - 0.4) {
        this.moveWorld(p.pos.x - h.pos.x, p.pos.z - h.pos.z);
        return;
      }
    }

    // ---------------------------------------------------------------- healing
    if (p.hp / balance.player.maxHealth < this.skill.heal && p.flasks > 0 && p.state === 'move') {
      const safe = !golem.attack || dG > 15 || step === 'stuck' || step === 'recover';
      if (safe && now - this.lastPress > 0.3) {
        this.press('heal');
        this.lastPress = now;
        return;
      }
      if (!safe) {
        this.moveWorld(-toG.x, -toG.z);
        return;
      }
    }

    // ---------------------------------------------------------------- offense
    let target: THREE.Vector3 | null = null;
    let window = 0;
    if (golem.staggered) {
      const back = golem.targets.find((t) => t.kind === 'back');
      if (back && back.open) target = back.pos;
      else if (step === 'collapse' || step === 'drop') target = golem.pos;
      window = golem.anim.seq ? golem.timeUntil('rise') : 0;
    } else if (golem.attack && (step === 'stuck' || step === 'rest' || step === 'pull' || step === 'brace')) {
      // nearest arm core that is low enough to hit
      let best: THREE.Vector3 | null = null;
      let bestD = 1e9;
      for (const t of golem.targets) {
        if (t.kind !== 'arm' || t.pos.y > 3.3) continue;
        const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        if (d < bestD) {
          bestD = d;
          best = t.pos;
        }
      }
      if (best) {
        target = best;
        window = golem.timeUntil('recover');
      }
    }
    if (target) {
      const dx = target.x - p.pos.x;
      const dz = target.z - p.pos.z;
      const dh = Math.hypot(dx, dz);
      const reach = 2.2;
      if (dh > reach) {
        this.moveWorld(dx, dz);
        v.held.delete('heavy');
      } else {
        const stam = p.stamina;
        const greedy = window > 0.9 - this.skill.greed * 0.6;
        if (canAct && stam > 12 && greedy && now - this.lastPress > 0.1) {
          const useHeavy = golem.staggered && window > 1.4 && stam > 30;
          this.press(useHeavy ? 'heavy' : 'light');
          this.lastPress = now;
        }
        // face the target: tiny forward nudge
        if (Math.abs(angleDiff(p.yaw, Math.atan2(dx, dz))) > 0.6) this.moveWorld(dx, dz, 0.3);
      }
      return;
    }

    // ---------------------------------------------------------------- neutral positioning
    // hover at a medium distance in front, drifting sideways
    const want = golem.phase >= 3 ? 8.5 : 8;
    const side = Math.sin(now * 0.4 + this.r.next() * 0.01) > 0 ? 1 : -1;
    const tang = _t.set(-toG.z * side, 0, toG.x * side);
    if (dG > want + 1.5) this.moveWorld(toG.x + tang.x * 0.3, toG.z + tang.z * 0.3);
    else if (dG < want - 2) this.moveWorld(-toG.x + tang.x * 0.5, -toG.z + tang.z * 0.5);
    else this.moveWorld(tang.x, tang.z, 0.5);
    void rng;
  }
}
