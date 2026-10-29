import { describe, expect, it } from 'vitest';
import { CAST_PALETTE, castColorIndex, castGradient, castInitials, normalizeName, parseCast } from './cast';

describe('parseCast', () => {
  it('lists actors first, then the director, each name once', () => {
    expect(parseCast('Actor A,  Actor B , Actor A', 'Director G')).toEqual([
      { name: 'Actor A', director: false },
      { name: 'Actor B', director: false },
      { name: 'Director G', director: true },
    ]);
  });

  it('keeps a director who also acts as an actor only', () => {
    expect(parseCast('Actor A', 'actor a')).toEqual([{ name: 'Actor A', director: false }]);
  });

  it('caps the list and keeps room for the directors', () => {
    const cast = Array.from({ length: 20 }, (_, i) => `Actor ${String(i)}`).join(', ');
    const people = parseCast(cast, 'Director G', 12);
    expect(people).toHaveLength(12);
    expect(people[11]).toEqual({ name: 'Director G', director: true });
  });

  it('splits other separators and drops empty names', () => {
    expect(parseCast('Actor A; Actor B | ,, ', '').map(p => p.name)).toEqual(['Actor A', 'Actor B']);
    expect(parseCast('', '')).toEqual([]);
  });
});

describe('castInitials', () => {
  it('takes the first letters of the first and last words', () => {
    expect(castInitials('Actor A')).toBe('AA');
    expect(castInitials('director middle g')).toBe('DG');
    expect(castInitials('Alpha')).toBe('A');
    expect(castInitials('  ')).toBe('#');
  });

  it('keeps letters of uncased scripts and skips digits', () => {
    expect(castInitials('演员 甲')).toBe('演甲');
    expect(castInitials('Actor 1')).toBe('A');
  });
});

describe('castGradient', () => {
  it('gives a name the same palette color every time, ignoring case and accents', () => {
    expect(castGradient('Actor A')).toBe(castGradient('actor a'));
    expect(castGradient('Actor É')).toBe(castGradient('Actor E'));
    const [from, to] = CAST_PALETTE[castColorIndex('Actor A')];
    expect(castGradient('Actor A')).toBe(`linear-gradient(135deg, ${from}, ${to})`);
  });

  it('spreads names that differ in one letter over different colors', () => {
    const slots = new Set(['Actor A', 'Actor B', 'Actor C', 'Actor D'].map(castColorIndex));
    expect(slots.size).toBe(4);
  });

  it('normalizes names for matching', () => {
    expect(normalizeName('  Actor-É.  ')).toBe('actor e');
  });
});
