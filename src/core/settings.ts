/**
 * Player settings (pause menu), remembered in this browser. Storage can be missing or blocked
 * (private windows, previews), so every access is guarded and the defaults always work.
 */
export interface Settings {
  /** mouse look speed multiplier (0.3 .. 2.5) */
  sensitivity: number;
  invertY: boolean;
  /** 0 .. 1 */
  master: number;
  music: number;
  sfx: number;
  /** camera shake 0 .. 1 */
  shake: number;
  /** show the controls card at the start of a fight */
  showControls: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  master: 0.8,
  music: 0.6,
  sfx: 0.9,
  shake: 1,
  showControls: true,
};

const KEY = 'colossus.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = s[k];
      if (typeof v === typeof DEFAULT_SETTINGS[k]) (out as Record<string, unknown>)[k] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings last for this session only
  }
}
