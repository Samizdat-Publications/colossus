import * as THREE from 'three';
import { bus } from '../core/events';
import type { Player } from '../game/player';
import type { Golem } from '../game/golem';
import type { GolemTarget } from '../game/context';

export const BOSS_NAME = 'OSTRAKON, THE LIVING RUIN';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

/** In-fight HUD: boss bar + break meter, player health/stamina/flasks, lock reticle, tips, damage numbers. */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly boss: HTMLDivElement;
  private readonly bossFill: HTMLDivElement;
  private readonly bossTrail: HTMLDivElement;
  private readonly bossDmg: HTMLDivElement;
  private readonly breakFill: HTMLDivElement;
  private readonly breakWrap: HTMLDivElement;
  private readonly breakLabel: HTMLSpanElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpTrail: HTMLDivElement;
  private readonly stFill: HTMLDivElement;
  private readonly stWrap: HTMLDivElement;
  private readonly flaskWrap: HTMLDivElement;
  private readonly reticle: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private readonly coreDots: HTMLDivElement[] = [];
  /** A core to point at with a pulsing chevron (punish windows, first attempts). */
  markCore: GolemTarget | null = null;
  private readonly tip: HTMLDivElement;
  private readonly controls: HTMLDivElement;
  private readonly floaters: HTMLDivElement;
  private bossTrailFrac = 1;
  private hpTrailFrac = 1;
  private dmgAccum = 0;
  private dmgTimer = 0;
  private tipTimer = 0;
  private stFlash = 0;
  bossVisible = false;
  showControls = true;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);
    this.boss = el('div', 'boss', this.root);
    el('div', 'boss-name', this.boss, BOSS_NAME);
    const bar = el('div', 'boss-bar', this.boss);
    this.bossTrail = el('div', 'trail', bar);
    this.bossFill = el('div', 'fill', bar);
    el('i', 'notch', bar).style.left = '66%';
    el('i', 'notch', bar).style.left = '33%';
    this.bossDmg = el('div', 'boss-dmg', this.boss);
    this.breakWrap = el('div', 'break', this.boss);
    this.breakLabel = el('span', 'break-label', this.breakWrap, 'BREAK');
    const bb = el('div', 'break-bar', this.breakWrap);
    this.breakFill = el('div', 'fill', bb);

    const pl = el('div', 'player', this.root);
    const hp = el('div', 'pbar hp', pl);
    this.hpTrail = el('div', 'trail', hp);
    this.hpFill = el('div', 'fill', hp);
    this.stWrap = el('div', 'pbar st', pl);
    this.stFill = el('div', 'fill', this.stWrap);
    this.flaskWrap = el('div', 'flasks', pl);

    this.reticle = el('div', 'reticle', this.root);
    this.marker = el('div', 'core-marker', this.root, '<i></i><span>STRIKE</span>');
    for (let i = 0; i < 3; i++) this.coreDots.push(el('div', 'core-dot', this.root));
    this.tip = el('div', 'tip', this.root);
    this.floaters = el('div', 'floaters', this.root);
    this.controls = el(
      'div',
      'controls',
      this.root,
      `<div><b>WASD</b> move</div><div><b>Mouse</b> camera</div><div><b>LMB</b> light attack</div><div><b>RMB</b> heavy (hold to charge)</div><div><b>Shift</b> block</div><div><b>Space</b> roll</div><div><b>F</b> jump</div><div><b>Q</b> lock on</div><div><b>R</b> flask</div><div class="dim"><b>H</b> hide this card</div>`,
    );

    bus.on('noStamina', () => (this.stFlash = 1));
    bus.on('coreHit', (e) => {
      this.dmgAccum += e.damage;
      this.dmgTimer = 2.2;
      this.floatText(e.pos, e.crit ? `${Math.round(e.damage)}!` : `${Math.round(e.damage)}`, e.crit ? 'crit' : 'core');
    });
    bus.on('bodyHit', (e) => {
      this.dmgAccum += e.damage;
      this.dmgTimer = 2.2;
      this.floatText(e.pos, `${Math.round(e.damage)}`, 'body');
    });
    bus.on('deflect', (e) => this.floatText(e.pos, 'DEFLECTED', 'deflect'));
  }

  private camera: THREE.Camera | null = null;
  private readonly pending: { pos: THREE.Vector3; text: string; cls: string; t: number; el: HTMLDivElement }[] = [];

  private floatText(pos: THREE.Vector3, text: string, cls: string): void {
    const e = el('div', `floater ${cls}`, this.floaters, text);
    this.pending.push({ pos: pos.clone(), text, cls, t: 0, el: e });
    if (this.pending.length > 12) this.pending.shift()!.el.remove();
  }

  showTip(text: string, seconds = 4): void {
    this.tip.innerHTML = text;
    this.tip.classList.add('on');
    this.tipTimer = seconds;
  }

  hideTip(): void {
    this.tipTimer = 0;
    this.tip.classList.remove('on');
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  update(dt: number, player: Player, golem: Golem, camera: THREE.Camera, width: number, height: number): void {
    this.camera = camera;
    this.boss.classList.toggle('on', this.bossVisible);
    const bf = golem.healthFrac;
    this.bossFill.style.width = `${bf * 100}%`;
    if (this.bossTrailFrac < bf) this.bossTrailFrac = bf;
    else if (this.dmgTimer < 1.4) this.bossTrailFrac = Math.max(bf, this.bossTrailFrac - dt * 0.35);
    this.bossTrail.style.width = `${this.bossTrailFrac * 100}%`;
    // while the golem is down the BREAK bar becomes a countdown of the opening
    const down = golem.staggerLeft;
    this.breakFill.style.width = `${(down >= 0 ? down : golem.breakFrac) * 100}%`;
    this.breakWrap.classList.toggle('staggered', down >= 0);
    this.breakLabel.textContent = down >= 0 ? 'DOWN' : 'BREAK';
    this.boss.dataset.phase = String(golem.phase);
    if (this.dmgTimer > 0) {
      this.dmgTimer -= dt;
      this.bossDmg.textContent = `-${Math.round(this.dmgAccum)}`;
      this.bossDmg.style.opacity = String(Math.min(1, this.dmgTimer * 2));
      if (this.dmgTimer <= 0) this.dmgAccum = 0;
    } else this.bossDmg.style.opacity = '0';

    const hf = player.healthFrac;
    this.hpFill.style.width = `${hf * 100}%`;
    if (this.hpTrailFrac < hf || !player.alive) this.hpTrailFrac = hf;
    else this.hpTrailFrac = Math.max(hf, this.hpTrailFrac - dt * 0.4);
    this.hpTrail.style.width = `${this.hpTrailFrac * 100}%`;
    this.stFill.style.width = `${(player.stamina / player.B.maxStamina) * 100}%`;
    this.stFlash = Math.max(0, this.stFlash - dt * 2.5);
    this.stWrap.classList.toggle('flash', this.stFlash > 0);
    const flasks = player.flasks;
    if (this.flaskWrap.dataset.n !== String(flasks)) {
      this.flaskWrap.dataset.n = String(flasks);
      this.flaskWrap.innerHTML = `<span class="key">R</span>` + Array.from({ length: player.B.flask.charges }, (_, i) => `<i class="${i < flasks ? 'full' : 'empty'}"></i>`).join('');
    }

    // lock-on reticle sits on a core (the only thing worth hitting), with dots on the other open cores
    const toScreen = (v: THREE.Vector3) => {
      const p = v.clone().project(camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height, on: p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 };
    };
    const focus = player.locked && golem.lockable ? golem.focusCore(player.pos) : null;
    if (focus) {
      const p = toScreen(focus.pos);
      this.reticle.style.display = p.on ? 'block' : 'none';
      this.reticle.style.transform = `translate(${p.x}px, ${p.y}px) rotate(45deg)`;
    } else this.reticle.style.display = 'none';
    let di = 0;
    if (player.locked && golem.lockable) {
      for (const t of golem.targets) {
        if (!t.open || t === focus || di >= this.coreDots.length) continue;
        const p = toScreen(t.pos);
        if (!p.on) continue;
        const d = this.coreDots[di++];
        d.style.display = 'block';
        d.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
    }
    for (; di < this.coreDots.length; di++) this.coreDots[di].style.display = 'none';
    if (this.markCore) {
      const p = toScreen(this.markCore.pos.clone().setY(this.markCore.pos.y + this.markCore.radius + 0.6));
      this.marker.style.display = p.on ? 'block' : 'none';
      this.marker.style.transform = `translate(${p.x}px, ${p.y}px)`;
    } else this.marker.style.display = 'none';

    if (this.tipTimer > 0) {
      this.tipTimer -= dt;
      if (this.tipTimer <= 0) this.tip.classList.remove('on');
    }
    this.controls.classList.toggle('hidden', !this.showControls);

    for (let i = this.pending.length - 1; i >= 0; i--) {
      const f = this.pending[i];
      f.t += dt;
      const p = f.pos.clone();
      p.y += f.t * 1.2;
      p.project(this.camera);
      if (f.t > 1.1 || p.z > 1) {
        f.el.remove();
        this.pending.splice(i, 1);
        continue;
      }
      f.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, (1.1 - f.t) * 3));
    }
  }
}

/** Contextual tips that teach the loop. Each shows a limited number of times. */
export class Tips {
  private readonly shown = new Map<string, number>();
  private readonly perAttempt = new Set<string>();
  enabled = true;

  constructor(private readonly hud: Hud) {}

  newAttempt(): void {
    this.perAttempt.clear();
  }

  private current = '';
  /** While set (danger around the warrior) only critical tips show. */
  quiet = false;

  show(id: string, text: string, maxTotal = 2, seconds = 4.5): void {
    if (!this.enabled) return;
    if (this.quiet && !id.startsWith('stagger')) return;
    const n = this.shown.get(id) ?? 0;
    if (n >= maxTotal || this.perAttempt.has(id)) return;
    this.shown.set(id, n + 1);
    this.perAttempt.add(id);
    this.current = id;
    this.hud.showTip(text, seconds);
  }

  /** Clear whatever tip is showing (danger starts: the warrior's eyes belong on the fight). */
  hush(): void {
    if (this.current && !this.current.startsWith('stagger')) {
      this.hud.hideTip();
      this.current = '';
    }
  }

  /** Hide the tip if it is still the one on screen (e.g. "press Q" once the player has locked on). */
  dismiss(id: string): void {
    if (this.current === id) {
      this.hud.hideTip();
      this.current = '';
    }
  }

  wasShown(id: string): boolean {
    return (this.shown.get(id) ?? 0) > 0;
  }
}
