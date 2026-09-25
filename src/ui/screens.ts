import type { Settings } from '../core/settings';

/** Full-screen menus: loading, title, how to fight, settings, pause, death, victory. */
export type ScreenName = 'none' | 'loading' | 'title' | 'howto' | 'settings' | 'pause' | 'dead' | 'victory';

export interface ScreenHandlers {
  begin: () => void;
  resume: () => void;
  retry: () => void;
  title: () => void;
  /** a setting changed (already written into the settings object) */
  settingsChanged: () => void;
  /** menu click sound */
  click: () => void;
}

export interface EndStats {
  cause: string;
  attempt: number;
  time: number;
  bossLeft: number;
  phase: number;
  hint: string;
  hits: number;
  flasks: number;
  damageTaken?: number;
  coreHits?: number;
  staggers?: number;
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'move'],
  ['Mouse', 'camera (click the game to capture it)'],
  ['Left click', 'light attack, three-hit combo'],
  ['Right click', 'heavy attack, hold to charge'],
  ['Shift', 'block'],
  ['Space', 'dodge roll (invulnerable for a moment)'],
  ['F', 'jump'],
  ['Q or Tab', 'lock on to the golem'],
  ['R', 'drink a flask (3 per attempt)'],
  ['Esc', 'pause'],
];

export class Screens {
  readonly root: HTMLDivElement;
  current: ScreenName = 'none';
  private focusIndex = 0;
  /** where Back goes from how-to and settings */
  private back: ScreenName = 'title';
  private lastStats: EndStats | undefined;

  constructor(
    parent: HTMLElement,
    private readonly h: ScreenHandlers,
    private readonly settings: Settings,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'screens';
    parent.appendChild(this.root);
  }

  private items(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-act], input[type=range], input[type=checkbox]')];
  }

  private wire(): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('button[data-act]')) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(b.dataset.act!);
      });
    }
    for (const it of this.items()) {
      it.addEventListener('mouseenter', () => {
        this.focusIndex = this.items().indexOf(it);
        this.highlight();
      });
    }
    for (const r of this.root.querySelectorAll<HTMLInputElement>('input[data-set]')) {
      const key = r.dataset.set as keyof Settings;
      const out = this.root.querySelector<HTMLElement>(`output[data-for="${key}"]`);
      const show = () => {
        if (out) out.textContent = r.type === 'checkbox' ? (r.checked ? 'On' : 'Off') : `${Math.round(Number(r.value) * (key === 'sensitivity' ? 100 : 100))}%`;
      };
      show();
      r.addEventListener('input', () => {
        (this.settings as unknown as Record<string, unknown>)[key] = r.type === 'checkbox' ? r.checked : Number(r.value);
        show();
        this.h.settingsChanged();
      });
      r.addEventListener('click', (e) => e.stopPropagation());
    }
    this.focusIndex = 0;
    this.highlight();
  }

  private activate(act: string): void {
    this.h.click();
    switch (act) {
      case 'howto':
      case 'settings':
        this.back = this.current === 'pause' ? 'pause' : 'title';
        this.show(act);
        return;
      case 'back':
        this.show(this.back, this.lastStats);
        return;
    }
    const fn = (this.h as unknown as Record<string, () => void>)[act];
    fn?.();
  }

  private highlight(): void {
    this.items().forEach((b, i) => b.classList.toggle('focus', i === this.focusIndex));
  }

  /** Keyboard / gamepad navigation. left/right adjust the focused slider or toggle. */
  nav(up: boolean, down: boolean, confirm: boolean, left = false, right = false, cancel = false): void {
    if (cancel && (this.current === 'howto' || this.current === 'settings')) {
      this.activate('back');
      return;
    }
    const its = this.items();
    if (!its.length) return;
    if (up) this.focusIndex = (this.focusIndex + its.length - 1) % its.length;
    if (down) this.focusIndex = (this.focusIndex + 1) % its.length;
    if (up || down) this.highlight();
    const cur = its[this.focusIndex];
    if ((left || right) && cur instanceof HTMLInputElement) {
      if (cur.type === 'range') {
        const step = Number(cur.step) || 0.05;
        cur.value = String(Math.min(Number(cur.max), Math.max(Number(cur.min), Number(cur.value) + (right ? step : -step))));
      } else cur.checked = !cur.checked;
      cur.dispatchEvent(new Event('input'));
    }
    if (confirm) {
      if (cur instanceof HTMLInputElement && cur.type === 'checkbox') {
        cur.checked = !cur.checked;
        cur.dispatchEvent(new Event('input'));
      } else if (cur.dataset.act) this.activate(cur.dataset.act);
    }
  }

  /** Loading progress (0..1) while the Blender assets stream in. */
  progress(f: number): void {
    const bar = this.root.querySelector<HTMLElement>('.load-bar i');
    if (bar) bar.style.width = `${Math.round(f * 100)}%`;
  }

  show(name: ScreenName, stats?: EndStats): void {
    this.current = name;
    if (stats) this.lastStats = stats;
    this.root.className = `screens ${name}`;
    const s = this.settings;
    switch (name) {
      case 'none':
        this.root.innerHTML = '';
        return;
      case 'loading':
        this.root.innerHTML = `<div class="center-col"><h1 class="logo">COLOSSUS</h1><div class="load-bar"><i></i></div>
          <p class="whisper">The ruin is gathering itself...</p></div>`;
        return;
      case 'title':
        this.root.innerHTML = `<div class="title-side">
            <p class="eyebrow">One fight in the drowned arena</p>
            <h1 class="logo">COLOSSUS</h1>
            <div class="rule"></div>
            <p class="tagline">A lone warrior. A drowned arena. A living ruin.</p>
            <nav class="menu">
              <button data-act="begin" class="primary">Begin</button>
              <button data-act="howto">How to fight</button>
              <button data-act="settings">Settings</button>
            </nav>
            <p class="hint"><span class="core">Only the glowing cores can be harmed.</span></p>
          </div>
          <p class="credit">Every stone modelled in Blender by script · every sound synthesized as you play</p>`;
        break;
      case 'howto':
        this.root.innerHTML = `<div class="sheet">
            <h2>How to fight</h2>
            <div class="cols">
              <section>
                <h3>The loop</h3>
                <p>Stone deflects your blade. Strike only the <span class="core">cyan cores</span>: one on each forearm, one low on its back.</p>
                <p>After a slam or a sweep a fist stays stuck in the ground. That is your window: the <span class="core">STRIKE</span> tag marks the core.</p>
                <p>Core hits fill <span class="core">BREAK</span>. Fill it and the Ruin falls to its knees: get behind it and strike its back.</p>
                <h3>Read the floor</h3>
                <ul class="legend">
                  <li><i class="sw red"></i><span><b>Red</b> ring, sector or strip: a blow lands here. Roll out.</span></li>
                  <li><i class="sw shock"></i><span><b>Pale red</b> band: a shockwave. Roll or jump through it.</span></li>
                  <li><i class="sw fire"></i><span><b>Amber</b> cracks: burning ground. Step off.</span></li>
                  <li><i class="sw cyan"></i><span><b>Cyan</b>: a weak point. Strike it.</span></li>
                </ul>
              </section>
              <section>
                <h3>Controls</h3>
                <table class="keys">${CONTROLS.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</table>
                <p class="small">A gamepad works too. Every action is buffered: press it during another move and it fires as soon as it can.</p>
              </section>
            </div>
            <nav class="menu row"><button data-act="back" class="primary">Back</button></nav>
          </div>`;
        break;
      case 'settings':
        this.root.innerHTML = `<div class="sheet narrow">
            <h2>Settings</h2>
            <div class="form">
              ${slider('sensitivity', 'Mouse sensitivity', s.sensitivity, 0.3, 2.5, 0.05)}
              ${toggle('invertY', 'Invert camera Y', s.invertY)}
              ${slider('master', 'Master volume', s.master, 0, 1, 0.05)}
              ${slider('music', 'Music', s.music, 0, 1, 0.05)}
              ${slider('sfx', 'Effects', s.sfx, 0, 1, 0.05)}
              ${slider('shake', 'Camera shake', s.shake, 0, 1, 0.05)}
              ${toggle('showControls', 'Controls card at the start', s.showControls)}
            </div>
            <nav class="menu row"><button data-act="back" class="primary">Back</button></nav>
          </div>`;
        break;
      case 'pause':
        this.root.innerHTML = `<div class="center-col panel">
            <h2>Paused</h2>
            <nav class="menu">
              <button data-act="resume" class="primary">Resume</button>
              <button data-act="howto">How to fight</button>
              <button data-act="settings">Settings</button>
              <button data-act="retry">Restart the fight</button>
              <button data-act="title">Quit to title</button>
            </nav>
          </div>`;
        break;
      case 'dead': {
        const st = stats ?? this.lastStats;
        this.root.innerHTML = `<div class="center-col end">
            <h1 class="death-title">FALLEN</h1>
            <p class="cause">Killed by ${st?.cause ?? 'the Ruin'}</p>
            <p class="hint">${st?.hint ?? ''}</p>
            <div class="stats">
              <div><span>Attempt</span><b>${st?.attempt ?? 1}</b></div>
              <div><span>The Ruin endures at</span><b>${Math.round((st?.bossLeft ?? 1) * 100)}%</b></div>
              <div><span>Phase reached</span><b>${roman(st?.phase ?? 1)}</b></div>
            </div>
            <nav class="menu row"><button data-act="retry" class="primary">Try again</button><button data-act="title">Title</button></nav>
          </div>`;
        break;
      }
      case 'victory': {
        const st = stats ?? this.lastStats;
        this.root.innerHTML = `<div class="center-col end">
            <p class="eyebrow">Ostrakon falls back into the rubble</p>
            <h1 class="victory-title">RUIN SILENCED</h1>
            <div class="rule gold"></div>
            <div class="stats">
              <div><span>Time</span><b>${fmtTime(st?.time ?? 0)}</b></div>
              <div><span>Attempt</span><b>${st?.attempt ?? 1}</b></div>
              <div><span>Damage taken</span><b>${Math.round(st?.damageTaken ?? 0)}</b></div>
              <div><span>Flasks drunk</span><b>${st?.flasks ?? 0}</b></div>
              <div><span>Core strikes</span><b>${st?.coreHits ?? 0}</b></div>
              <div><span>Times it fell</span><b>${st?.staggers ?? 0}</b></div>
            </div>
            <nav class="menu row"><button data-act="retry" class="primary">Fight again</button><button data-act="title">Title</button></nav>
          </div>`;
        break;
      }
    }
    this.wire();
  }
}

function slider(key: string, label: string, value: number, min: number, max: number, step: number): string {
  return `<label class="field"><span>${label}</span><input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><output data-for="${key}"></output></label>`;
}

function toggle(key: string, label: string, value: boolean): string {
  return `<label class="field"><span>${label}</span><input type="checkbox" data-set="${key}" ${value ? 'checked' : ''}><output data-for="${key}"></output></label>`;
}

function roman(n: number): string {
  return ['I', 'II', 'III'][Math.max(0, Math.min(2, n - 1))];
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}
