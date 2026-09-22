// The Office cast — roster metadata + sprite frames.
//
// Both the static portraits (cards / picker) and the in-scene walking sprites are
// now fully custom-drawn from the same per-character recipes in portraitArt.ts:
// the scene sprite reuses the portrait's exact head/face/clothing and adds legs,
// so an agent on the office floor looks identical to its card. The LimeZu base
// sheets are no longer used for the cast. See assets/ATTRIBUTION.md.
//
// ─── AIRA ────────────────────────────────────────────────────────────────────
// The Office VISUAL layer is unchanged: the same 15 characters, the same
// procedural art, the same walking sprites, the same floor. What changed is the
// IDENTITY each character displays. `name` (an `OfficeCharacterName`) is now the
// AVATAR id, and the label a human reads comes from `shared/planets.ts`, so a
// planet can be renamed without repainting a single pixel.
//
// Every legacy cast member is kept, including the ones no planet wears. They are
// still selectable avatars (and still resolve from saved data that names them by
// their old label), so nothing that referenced the cast breaks.

import { Texture } from 'pixi.js';
import { AIRA, planetByAvatar, type PlanetConfig } from '@shared/planets';
import { paintPortrait, sceneFrameBufs, SCENE_W, SCENE_H } from './portraitArt';

export type OfficeCharacterName =
  | 'michael' | 'jim' | 'pam' | 'dwight' | 'kevin' | 'angela'
  | 'oscar' | 'stanley' | 'phyllis' | 'andy' | 'kelly' | 'ryan'
  | 'toby' | 'creed' | 'meredith';

export interface CastMember {
  /** The AVATAR id. Stable, and independent of anything the user can rename. */
  name: OfficeCharacterName;
  /** The identity shown for this avatar: the planet wearing it, or AIRA itself. */
  displayName: string;
  /** Signature accent color (hex) — used for the in-scene selection glow. */
  shirt: string;
  /** Role line shown when this character is picked / has no description yet. */
  blurb: string;
  /** The AIRA planet wearing this avatar, or null for a legacy (unworn) avatar. */
  planet: PlanetConfig | null;
  /** True only for the orchestrator's avatar (AIRA). */
  isAira: boolean;
  /** The avatar's own original label, kept so old data that names a character by
   *  it (`character: 'Jim'`, a saved note, a hire manifest) still resolves. */
  legacyName: string;
}

/** Shirts + the original Munder Difflin labels, in display order. */
const AVATARS: Array<{ name: OfficeCharacterName; legacyName: string; shirt: string }> = [
  { name: 'michael',  legacyName: 'Michael',  shirt: '#5a6b8c' },
  { name: 'jim',      legacyName: 'Jim',      shirt: '#6fa8dc' },
  { name: 'pam',      legacyName: 'Pam',      shirt: '#9caf88' },
  { name: 'dwight',   legacyName: 'Dwight',   shirt: '#b89b3e' },
  { name: 'kevin',    legacyName: 'Kevin',    shirt: '#4a7ab5' },
  { name: 'angela',   legacyName: 'Angela',   shirt: '#8a86a6' },
  { name: 'oscar',    legacyName: 'Oscar',    shirt: '#7a4b6b' },
  { name: 'stanley',  legacyName: 'Stanley',  shirt: '#8c5a4b' },
  { name: 'phyllis',  legacyName: 'Phyllis',  shirt: '#b08bbf' },
  { name: 'andy',     legacyName: 'Andy',     shirt: '#6fae6f' },
  { name: 'kelly',    legacyName: 'Kelly',    shirt: '#d16ba5' },
  { name: 'ryan',     legacyName: 'Ryan',     shirt: '#3a3a44' },
  { name: 'toby',     legacyName: 'Toby',     shirt: '#9a8c5a' },
  { name: 'creed',    legacyName: 'Creed',    shirt: '#6b7a4b' },
  { name: 'meredith', legacyName: 'Meredith', shirt: '#b5544a' }
];

/**
 * The identity an avatar displays.
 *
 * AIRA wears the orchestrator's avatar; the nine planets wear the rest; an
 * avatar no planet uses keeps its own label so it stays a usable extra.
 */
function identityFor(avatar: OfficeCharacterName, legacyName: string): {
  displayName: string;
  blurb: string;
  planet: PlanetConfig | null;
  isAira: boolean;
} {
  if (avatar === AIRA.avatarId) {
    return { displayName: AIRA.displayName, blurb: AIRA.title, planet: null, isAira: true };
  }
  const planet = planetByAvatar(avatar);
  if (planet) {
    return { displayName: planet.displayName, blurb: planet.title, planet, isAira: false };
  }
  return { displayName: legacyName, blurb: 'Office regular', planet: null, isAira: false };
}

/** Selectable roster, in display order. */
export const OFFICE_CAST: CastMember[] = AVATARS.map((a) => ({
  name: a.name,
  shirt: a.shirt,
  legacyName: a.legacyName,
  ...identityFor(a.name, a.legacyName)
}));

export const CAST_BY_NAME: Record<OfficeCharacterName, CastMember> =
  Object.fromEntries(OFFICE_CAST.map((c) => [c.name, c])) as Record<OfficeCharacterName, CastMember>;

/** The avatar a planet wears, or undefined when it is not on the roster. */
export function avatarForPlanet(planetId: string): OfficeCharacterName | undefined {
  const hit = OFFICE_CAST.find((c) => c.planet?.agentId === planetId);
  return hit?.name;
}

export const DEFAULT_CHARACTER: OfficeCharacterName = 'jim';

export function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// ─── scene frames ────────────────────────────────────────────────────────────
const frameCache = new Map<OfficeCharacterName, Texture[][]>();

function bufToTexture(buf: Uint8ClampedArray): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SCENE_W; canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SCENE_W, SCENE_H);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/**
 * Frame grid CharacterSprite expects: 3 rows (down, up, right) × 7 frames
 * [walk1, walk2, walk3, type1, type2, read1, read2]. We provide a front view
 * (down — and reused for the side row, so left/right walkers still show a face)
 * and a back view (up — agents seated facing their desk show their back). The
 * three walk frames are stand / step-left / step-right.
 */
export async function getCastFrames(name: OfficeCharacterName): Promise<Texture[][]> {
  const cached = frameCache.get(name);
  if (cached) return cached;
  const { front, back } = sceneFrameBufs(name);
  const toRow = (bufs: Uint8ClampedArray[]): Texture[] => {
    const [stand, stepL, stepR] = bufs.map(bufToTexture);
    return [stand, stepL, stepR, stand, stand, stand, stand];
  };
  const frontRow = toRow(front);
  const frames: Texture[][] = [frontRow, toRow(back), frontRow]; // down, up, right
  frameCache.set(name, frames);
  return frames;
}

/**
 * Paint a character's static portrait for cards / the picker (delegates to the
 * custom procedural composer in portraitArt.ts).
 */
export async function paintCastPortrait(
  ctx: CanvasRenderingContext2D,
  name: OfficeCharacterName,
  scale = 2,
): Promise<void> {
  paintPortrait(ctx, name, scale);
}
