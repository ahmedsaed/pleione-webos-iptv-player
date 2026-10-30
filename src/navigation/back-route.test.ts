import { describe, expect, it } from 'vitest';
import { backStep } from './back-route';

describe('backStep', () => {
  it('leaves the app from Home', () => {
    expect(backStep('home', 'home')).toBe('exit');
    expect(backStep('home', 'channels')).toBe('exit');
  });

  it('goes Home from every section page', () => {
    for (const view of ['channels', 'movies', 'series', 'search', 'settings']) {
      expect(backStep(view, 'channels')).toBe('home');
    }
  });

  it('returns from the player to where playback started', () => {
    expect(backStep('player', 'home')).toBe('home');
    expect(backStep('player', 'channels')).toBe('channels');
    expect(backStep('player', 'search')).toBe('search');
  });

  it('returns from the Settings sub-pages to Settings', () => {
    expect(backStep('reminders', 'home')).toBe('settings');
    expect(backStep('parental-controls', 'home')).toBe('settings');
  });
});
