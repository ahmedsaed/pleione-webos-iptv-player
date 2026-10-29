// "More like this" on a catalog detail: titles from the provider's own
// catalog only, ranked by how many genres they share with the title shown,
// then by rating, keeping the catalog's order on a tie.

export const MORE_LIKE_THIS_LIMIT = 20;

export interface SimilarCandidate<T> {
  id: string;
  item: T;
  genres: string[];
  rating: string;
}

export function genreSet(genre: string | undefined): string[] {
  if (!genre) return [];
  const out: string[] = [];
  genre.split(/[,/&|;]+/).forEach((part) => {
    const g = part.trim().toLowerCase();
    if (g && out.indexOf(g) < 0) out.push(g);
  });
  return out;
}

function ratingValue(rating: string): number {
  const n = parseFloat(rating);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function rankMoreLikeThis<T>(
  currentId: string,
  currentGenres: string[],
  candidates: SimilarCandidate<T>[],
  limit = MORE_LIKE_THIS_LIMIT,
): T[] {
  const wanted = new Set(currentGenres);
  return candidates
    .filter(c => c.id !== currentId)
    .map((c, index) => ({
      c,
      index,
      overlap: c.genres.filter(g => wanted.has(g)).length,
      rating: ratingValue(c.rating),
    }))
    .sort((a, b) => b.overlap - a.overlap || b.rating - a.rating || a.index - b.index)
    .slice(0, limit)
    .map(entry => entry.c.item);
}
