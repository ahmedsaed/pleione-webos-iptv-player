import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { composeEpisodeLabel, episodeCodeOf, episodeLabelOf, localizeEpisodeLabel, seriesNameOf } from './episode-label';

afterEach(() => setLocale('en'));

describe('localizeEpisodeLabel', () => {
  it('shows a label saved in English in Arabic', () => {
    setLocale('ar');
    expect(localizeEpisodeLabel('Series One — S1E6 — Episode 6')).toBe('Series One — م1ح6 — الحلقة 6');
    expect(localizeEpisodeLabel('Series One — S2E3 — Pilot')).toBe('Series One — م2ح3 — Pilot');
    expect(localizeEpisodeLabel('Series One — S01E06')).toBe('Series One — م1ح6');
  });

  it('shows a label saved in Arabic in English, the older season letter included', () => {
    expect(localizeEpisodeLabel('Series One — م1ح6 — الحلقة 6')).toBe('Series One — S1E6 — Episode 6');
    expect(localizeEpisodeLabel('Series One — س2ح1 — Pilot')).toBe('Series One — S2E1 — Pilot');
  });

  it('reads a placeholder title any locale composed', () => {
    setLocale('de');
    expect(localizeEpisodeLabel('Series One — S1E6 — 6. Bölüm')).toBe('Series One — S1E6 — Folge 6');
    expect(localizeEpisodeLabel('Series One — S1E6 — 第 6 集')).toBe('Series One — S1E6 — Folge 6');
  });

  it('keeps a provider title and a series name with a dash', () => {
    setLocale('ar');
    expect(localizeEpisodeLabel('Series One - S01E02 - Pilot')).toBe('Series One - S01E02 - Pilot');
    expect(localizeEpisodeLabel('Movie Title')).toBe('Movie Title');
    expect(localizeEpisodeLabel('Alpha — Bravo — S1E2 — Charlie')).toBe('Alpha — Bravo — م1ح2 — Charlie');
  });
});

describe('episodeLabelOf', () => {
  const ref = { seriesName: 'Series One', season: 1, episode: 6, title: 'Episode 6' };

  it('composes from the episode\'s place in its series over the saved label', () => {
    setLocale('ar');
    expect(episodeLabelOf({ seriesEpisode: ref }, 'stale')).toBe('Series One — م1ح6 — الحلقة 6');
    expect(composeEpisodeLabel({ ...ref, title: 'Series One - S01E06 - Pilot' })).toBe('Series One - S01E06 - Pilot');
    expect(composeEpisodeLabel({ ...ref, title: '' })).toBe('Series One — م1ح6');
  });

  it('reads the season, episode and series from either source', () => {
    expect(episodeCodeOf({ seriesEpisode: ref }, '')).toEqual({ season: 1, episode: 6 });
    expect(episodeCodeOf({}, 'Series One — م2ح1 — x')).toEqual({ season: 2, episode: 1 });
    expect(episodeCodeOf({}, 'Movie Title')).toBeNull();
    expect(seriesNameOf({ seriesEpisode: ref }, '')).toBe('Series One');
    expect(seriesNameOf({}, 'Series One — S2E1 — x')).toBe('Series One');
  });
});
