/** Full-screen menus: title, pause, death, victory. Buttons call the provided handlers. */
export type ScreenName = 'none' | 'loading' | 'title' | 'pause' | 'dead' | 'victory';

export interface ScreenHandlers {
  begin: () => void;
  resume: () => void;
  retry: () => void;
  title: () => void;
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
}

export class Screens {
  readonly root: HTMLDivElement;
  current: ScreenName = 'none';
  private focusIndex = 0;

  constructor(
    parent: HTMLElement,
    private readonly h: ScreenHandlers,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'screens';
    parent.appendChild(this.root);
  }

  private buttons(): HTMLButtonElement[] {
    return [...this.root.querySelectorAll<HTMLButtonElement>('button[data-act]')];
  }

  private wire(): void {
    for (const b of this.buttons()) {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activate(b.dataset.act!);
      });
      b.addEventListener('mouseenter', () => {
        this.focusIndex = this.buttons().indexOf(b);
        this.highlight();
      });
    }
    this.focusIndex = 0;
    this.highlight();
  }

  private activate(act: string): void {
    const fn = (this.h as unknown as Record<string, () => void>)[act];
    fn?.();
  }

  private highlight(): void {
    this.buttons().forEach((b, i) => b.classList.toggle('focus', i === this.focusIndex));
  }

  /** Keyboard / gamepad navigation. */
  nav(up: boolean, down: boolean, confirm: boolean): void {
    const bs = this.buttons();
    if (!bs.length) return;
    if (up) this.focusIndex = (this.focusIndex + bs.length - 1) % bs.length;
    if (down) this.focusIndex = (this.focusIndex + 1) % bs.length;
    if (up || down) this.highlight();
    if (confirm) this.activate(bs[this.focusIndex].dataset.act!);
  }

  show(name: ScreenName, stats?: EndStats): void {
    this.current = name;
    this.root.className = `screens ${name}`;
    switch (name) {
      case 'none':
        this.root.innerHTML = '';
        return;
      case 'loading':
        this.root.innerHTML = `<div class="panel center"><h1 class="logo">COLOSSUS</h1><p class="sub">Loading...</p></div>`;
        return;
      case 'title':
        this.root.innerHTML = `<div class="panel center"><h1 class="logo">COLOSSUS</h1>
          <p class="sub">A lone warrior. A drowned arena. A living ruin.</p>
          <div class="menu"><button data-act="begin">Begin</button></div>
          <p class="hint">Only the glowing cores can be harmed.</p></div>`;
        break;
      case 'pause':
        this.root.innerHTML = `<div class="panel center"><h2>Paused</h2>
          <div class="menu"><button data-act="resume">Resume</button><button data-act="retry">Restart fight</button><button data-act="title">Quit to title</button></div></div>`;
        break;
      case 'dead':
        this.root.innerHTML = `<div class="panel center"><h1 class="death">FALLEN</h1>
          <p class="cause">Killed by ${stats?.cause ?? 'the Ruin'}</p>
          <p class="sub">Attempt ${stats?.attempt ?? 1} · The Ruin endures at ${Math.round((stats?.bossLeft ?? 1) * 100)}%</p>
          <p class="hint">${stats?.hint ?? ''}</p>
          <div class="menu"><button data-act="retry">Try again</button><button data-act="title">Title</button></div></div>`;
        break;
      case 'victory':
        this.root.innerHTML = `<div class="panel center"><h1 class="victory">RUIN SILENCED</h1>
          <p class="sub">Ostrakon has fallen · attempt ${stats?.attempt ?? 1} · ${fmtTime(stats?.time ?? 0)}</p>
          <div class="menu"><button data-act="retry">Fight again</button><button data-act="title">Title</button></div></div>`;
        break;
    }
    this.wire();
  }
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}
