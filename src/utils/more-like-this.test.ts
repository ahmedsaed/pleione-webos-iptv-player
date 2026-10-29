import { describe, expect, it } from 'vitest';
import { genreSet, rankMoreLikeThis, type SimilarCandidate } from './more-like-this';

const c = (id: string, genre: string, rating: string): SimilarCandidate<string> =>
  ({ id, item: id, genres: genreSet(genre), rating });

describe('genreSet', () => {
  it('splits, trims, lowercases, and dedupes genres', () => {
    expect(genreSet('Drama, Thriller / drama & Comedy')).toEqual(['drama', 'thriller', 'comedy']);
    expect(genreSet(undefined)).toEqual([]);
  });
});

describe('rankMoreLikeThis', () => {
  it('ranks by shared genres, then rating, then catalog order, without the current title', () => {
    const ranked = rankMoreLikeThis('m0', genreSet('Drama, Thriller'), [
      c('m0', 'Drama, Thriller', '9'),
      c('m1', 'Comedy', '9.5'),
      c('m2', 'Drama', '6'),
      c('m3', 'Drama, Thriller', '5'),
      c('m4', 'Drama', '8'),
      c('m5', '', '0'),
      c('m6', '', ''),
    ]);
    expect(ranked).toEqual(['m3', 'm4', 'm2', 'm1', 'm5', 'm6']);
  });

  it('treats a zero or missing rating as unrated', () => {
    expect(rankMoreLikeThis('x', [], [c('a', '', '0'), c('b', '', '1'), c('c', '', 'n/a')]))
      .toEqual(['b', 'a', 'c']);
  });

  it('returns at most the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => c(`m${String(i)}`, '', ''));
    expect(rankMoreLikeThis('none', [], many)).toHaveLength(20);
    expect(rankMoreLikeThis('none', [], many, 5)).toHaveLength(5);
  });
});
