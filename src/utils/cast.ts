import { firstLetter } from './avatar';

// The people a catalog detail shows: the provider's comma-separated `cast`
// and `director` strings, actors first, each name once.
export interface CastMember {
  name: string;
  director: boolean;
}

export const CAST_LIMIT = 12;

function splitNames(value: string): string[] {
  return value.split(/[,;|\n]+/)
    .map(name => name.replace(/\s+/g, ' ').trim())
    .filter(name => name.length > 0 && name.length <= 80);
}

export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\wÀ-￿]+/g, ' ').trim();
}

export function parseCast(cast: string, director: string, limit = CAST_LIMIT): CastMember[] {
  const seen = new Set<string>();
  const out: CastMember[] = [];
  const add = (name: string, isDirector: boolean): void => {
    const key = normalizeName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name, director: isDirector });
  };
  const directors = splitNames(director);
  // Room is kept for the directors, who come last.
  const actors = splitNames(cast).slice(0, Math.max(0, limit - Math.min(directors.length, 2)));
  actors.forEach(name => add(name, false));
  directors.forEach(name => add(name, true));
  return out.slice(0, limit);
}

// The first letters of the first and last words; one for a single word.
export function castInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(word => word.length > 0);
  if (!words.length) return '#';
  const first = firstLetter(words[0]);
  if (words.length === 1) return first;
  const last = firstLetter(words[words.length - 1]);
  return first === '#' ? last : last === '#' ? first : first + last;
}

// Diagonal two-tone fills, each dark enough for white initials; like
// artwork, they carry their own color in every theme.
export const CAST_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#e0566a', '#7d2a6b'],
  ['#3f8cff', '#2b2f8a'],
  ['#1fb58f', '#14526b'],
  ['#f2a33a', '#a8452c'],
  ['#9b6bff', '#4b2f9a'],
  ['#38bdf8', '#1e4f8a'],
  ['#ef6aa8', '#7a2d63'],
  ['#5fd17a', '#22663f'],
];

// A stable palette slot per name, so a person keeps their color on every
// title; names that differ in one letter land on different slots.
export function castColorIndex(name: string): number {
  const key = normalizeName(name) || name;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % CAST_PALETTE.length;
}

export function castGradient(name: string): string {
  const [from, to] = CAST_PALETTE[castColorIndex(name)];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
