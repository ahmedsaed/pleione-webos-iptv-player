import { describe, it, expect } from 'vitest';
import type { PlaylistEntry } from '../types';
import { firstRunLanding } from './first-run';

const playlist: PlaylistEntry = { id: 'p1', name: 'P1', url: 'http://host/a.m3u' };

describe('firstRunLanding', () => {
  it('is no first run once any source exists, even a turned-off one', () => {
    expect(firstRunLanding([playlist], 'launch', false)).toBeNull();
    expect(firstRunLanding([{ ...playlist, enabled: false }], 'launch', false)).toBeNull();
  });

  it('shows the first run on Home at launch', () => {
    expect(firstRunLanding([], 'launch', false)).toBe('home');
  });

  it('opens Settings when started on Live or for a later load', () => {
    expect(firstRunLanding([], 'launch', true)).toBe('settings');
    expect(firstRunLanding([], 'channels', false)).toBe('settings');
    expect(firstRunLanding([], 'section', false)).toBe('settings');
  });
});
