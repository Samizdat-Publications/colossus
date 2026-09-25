import DEFAULTS_RAW from 'virtual:balance-defaults';

/** Shape of public/balance.json (type-only import, so Vite never bundles from public/). */
export type Balance = typeof import('../../public/balance.json');
const DEFAULTS = DEFAULTS_RAW as Balance;
export type PlayerBalance = Balance['player'];
export type GolemBalance = Balance['golem'];
export type AttackBalance = Balance['golem']['attacks'];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Deep-merge `over` into a copy of `base`, keeping base's shape: wrong-typed overrides are ignored. */
function merge(base: Json, over: Json, path: string, warnings: string[]): Json {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base)) {
    if (!Array.isArray(over)) {
      warnings.push(`${path}: expected an array`);
      return base;
    }
    // Arrays of objects/arrays merge element-wise; arrays of numbers are replaced (same length preferred).
    return over.map((v, i) => (i < base.length ? merge(base[i], v, `${path}[${i}]`, warnings) : v));
  }
  if (typeof base === 'object' && base !== null) {
    if (typeof over !== 'object' || Array.isArray(over)) {
      warnings.push(`${path}: expected an object`);
      return base;
    }
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(base)) out[k] = merge(base[k], (over as { [k: string]: Json })[k], `${path}.${k}`, warnings);
    for (const k of Object.keys(over)) if (!(k in base) && !k.startsWith('_')) warnings.push(`${path}.${k}: unknown key ignored`);
    return out;
  }
  if (typeof base !== typeof over) {
    warnings.push(`${path}: expected ${typeof base}`);
    return base;
  }
  if (typeof over === 'number' && !Number.isFinite(over)) return base;
  return over;
}

export let balance: Balance = structuredClone(DEFAULTS);

/** Fetch the live balance.json (so edits apply on reload, even in a production build). */
export async function loadBalance(): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}balance.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const live = (await res.json()) as Json;
    balance = merge(DEFAULTS as unknown as Json, live, 'balance', warnings) as unknown as Balance;
  } catch (e) {
    warnings.push(`balance.json could not be loaded (${String(e)}); using built-in defaults`);
    balance = structuredClone(DEFAULTS);
  }
  return warnings;
}

/** Per-phase value helper: arrays of 3 are indexed by phase (1..3). */
export function perPhase<T>(v: T[] | T, phase: number): T {
  if (Array.isArray(v)) return v[Math.max(0, Math.min(v.length - 1, phase - 1))];
  return v;
}
