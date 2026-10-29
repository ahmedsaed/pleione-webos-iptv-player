import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, setLocale } from '../i18n';
import { formatEpgOffset } from './epg-offset';

describe('formatEpgOffset', () => {
  afterEach(() => setLocale(DEFAULT_LOCALE));

  it('formats signed hours and minutes', () => {
    setLocale('en');
    expect(formatEpgOffset(0)).toBe('0 min');
    expect(formatEpgOffset(30)).toBe('+30 min');
    expect(formatEpgOffset(-90)).toBe('-1 h 30 min');
  });

  it('keeps the sign with its number in Arabic', () => {
    setLocale('ar');
    expect(formatEpgOffset(30)).toBe('‏‎+30‎ د');
    expect(formatEpgOffset(-90)).toBe('‏‎-1‎ س 30 د');
  });
});
