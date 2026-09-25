import * as THREE from 'three';
import type { Game } from '../game/game';
import type { AttackName } from '../game/golem';
import { balance } from '../core/balance';
import { bus, type GameEvents } from '../core/events';
import { Bot, SKILLS } from './bot';

const r2 = (v: number) => Math.round(v * 100) / 100;
const vec = (v: THREE.Vector3) => ({ x: r2(v.x), y: r2(v.y), z: r2(v.z) });

/** window.__CO: state snapshots and controls for the Playwright self-test (only with ?test=1). */
export function installHooks(game: Game): void {
  const log: { t: number; type: string; info?: string }[] = [];
  const watch: (keyof GameEvents)[] = [
    'playerHit',
    'playerDeath',
    'coreHit',
    'deflect',
    'staggerStart',
    'phaseChange',
    'golemDeath',
    'justGuard',
    'playerBlock',
    'heal',
    'golemWindup',
  ];
  for (const w of watch) {
    bus.on(w, (e: unknown) => {
      const info = w === 'golemWindup' ? (e as GameEvents['golemWindup']).attack : w === 'playerHit' ? (e as GameEvents['playerHit']).source : undefined;
      log.push({ t: Math.round(game.ctx.time * 100) / 100, type: w, info });
      if (log.length > 400) log.shift();
    });
  }
  const api = {
    state: () => {
      const p = game.player;
      const g = game.golem;
      return {
        flow: game.flow,
        paused: game.paused,
        screen: game.screens.current,
        attempt: game.attempt,
        time: r2(game.ctx.time),
        fightTime: r2(game.fightTime),
        frameMs: r2(game.frameMs),
        player: {
          pos: vec(p.pos),
          y: r2(p.y),
          yaw: r2(p.yaw),
          hp: r2(p.hp),
          stamina: r2(p.stamina),
          state: p.state,
          locked: p.locked,
          flasks: p.flasks,
          invulnerable: p.invulnerable,
          vel: vec(p.vel),
          stats: { ...p.stats },
        },
        golem: {
          pos: vec(g.pos),
          yaw: r2(g.yaw),
          hp: r2(g.hp),
          hpFrac: r2(g.healthFrac),
          phase: g.phase,
          state: g.state,
          attack: g.attack?.name ?? null,
          side: g.attack?.side ?? null,
          step: g.step,
          breakMeter: r2(g.breakMeter),
          staggers: g.stats.staggers,
          targets: g.targets.map((t) => ({ name: t.name, pos: vec(t.pos), open: t.open, r: t.radius })),
        },
        threats: {
          hazards: game.threats.hazards.map((h) => ({ pos: vec(h.pos), r: h.radius, left: r2(h.dur - h.t) })),
          waves: game.threats.waves.map((w) => ({ c: vec(w.center), r: r2(w.r), speed: w.speed, h: w.height, hit: w.hit })),
          rocks: game.threats.rocks.map((r) => ({ pos: vec(r.pos), target: vec(r.target), left: r2(r.flight - r.t), radius: r.radius })),
          telegraphs: game.threats.telegraphs.map((t) => ({ pos: vec(t.pos), r: t.radius, left: r2(t.dur - t.t), kind: t.kind })),
          fissures: game.threats.fissures.map((f) => ({ from: vec(f.from), dir: vec(f.dir), dist: r2(f.dist), len: f.length })),
        },
      };
    },
    events: (since = 0) => log.filter((e) => e.t >= since),
    setTimeScale: (s: number) => (game.timeScale = s),
    begin: () => game.begin(),
    retry: () => game.retry(),
    skipIntro: () => game.skipIntro(),
    toTitle: () => game.toTitle(),
    pause: () => game.pause(),
    resume: () => game.resume(),
    god: (on: boolean) => (game.player.god = on),
    holdGolem: (on: boolean) => (game.golem.aiHold = on),
    forceAttack: (name: AttackName, side: 'L' | 'R' = 'L') => game.golem.startAttack(name, side, game.ctx),
    setGolemHp: (frac: number) => {
      game.golem.hp = game.golem.maxHp * frac;
    },
    audioLevel: () => game.audio.level(),
    audioState: () => game.audio.ctx?.state ?? 'none',
    /** Always plays the phase-change roar into phase ph (even if the fight already reached it). */
    forcePhase: (ph: number) => {
      const g = game.golem;
      const th = balance.golem.phaseThresholds;
      g.phase = ph - 1;
      g.hp = g.maxHp * (ph === 2 ? th[0] - 0.005 : th[1] - 0.005);
      g.pendingPhase = ph;
    },
    /** Kills the golem at once (victory flow). */
    killGolem: () => {
      const g = game.golem as unknown as { phase: number; hp: number; die: () => void };
      g.phase = 3;
      g.hp = 0;
      g.die();
    },
    setGolemPhase: (ph: number) => {
      const th = balance.golem.phaseThresholds;
      game.golem.hp = game.golem.maxHp * (ph === 2 ? th[0] - 0.005 : th[1] - 0.005);
      game.golem.pendingPhase = ph;
    },
    damageGolem: (amount: number) => {
      const g = game.golem;
      g.hp = Math.max(0, g.hp - amount);
    },
    killPlayer: () => game.player.takeHit({ damage: 9999, from: game.golem.pos, source: 'test' }),
    teleportPlayer: (x: number, z: number) => game.player.pos.set(x, 0, z),
    balance: () => balance,
    bot: (mode: string, seed = 99) => {
      const b = new Bot(game, SKILLS[mode] ?? SKILLS.decent, seed);
      game.onFrame = () => b.update();
      return b.mode;
    },
    stopBot: () => {
      game.onFrame = null;
      game.input.virtual = null;
    },
    ready: true,
  };
  (window as unknown as { __CO: typeof api }).__CO = api;
}
