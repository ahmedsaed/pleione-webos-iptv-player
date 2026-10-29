import {
  foldArabic,
  isLetterOrNumber,
  splitLetterNumberTokens,
  stripCombiningDiacritics,
} from './unicode-text';

const SYNONYM_GROUPS = [
  ['sports', 'sport', 'footy', 'football', 'soccer', 'athletics'],
  ['kids', 'kid', 'children', 'child', 'cartoons', 'cartoon', 'animation', 'animated'],
  ['news', 'headlines', 'current affairs'],
  ['movies', 'movie', 'films', 'film', 'cinema'],
  ['music', 'songs', 'song', 'concerts', 'concert'],
  ['documentaries', 'documentary', 'docs', 'history', 'nature'],
] as const;

const STOP_WORDS = new Set(['find', 'me', 'show', 'watch', 'for', 'please', 'channel', 'channels', 'program', 'programs']);

// Documents and queries both pass through here, in the worker and on the
// page alike; a change must bump SEARCH_INDEX_FORMAT, whose stored indexes
// hold folded text.
function fold(value: string): string {
  return foldArabic(stripCombiningDiacritics(value.normalize('NFD'))).toLowerCase();
}

function splitFolded(value: string): string[] {
  return splitLetterNumberTokens(value);
}

function tokens(value: string): string[] {
  return splitFolded(fold(value));
}

function queryTokens(query: string): string[] {
  const all = tokens(query);
  const meaningful = all.filter(token => !STOP_WORDS.has(token));
  return meaningful.length ? meaningful : all;
}

function variants(token: string): string[] {
  for (const group of SYNONYM_GROUPS) {
    if ((group as readonly string[]).includes(token)) return [token, ...group.filter(value => value !== token)];
  }
  return [token];
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let edits = 0;
    for (let i = 0; i < a.length;) {
      if (a[i] === b[i]) {
        i++;
        continue;
      }
      if (edits > 0) return false;
      edits++;
      if (i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i]) i += 2;
      else i++;
    }
    return true;
  }

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let shortIndex = 0;
  let longIndex = 0;
  let edits = 0;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex++;
      longIndex++;
    } else {
      if (edits > 0) return false;
      edits++;
      longIndex++;
    }
  }
  return true;
}

function tokenScore(
  queryToken: string,
  fieldTokens: string[],
  start: number,
  end: number,
): number | null {
  let best: number | null = null;
  const expanded = variants(queryToken);
  for (let variantIndex = 0; variantIndex < expanded.length; variantIndex++) {
    const variant = expanded[variantIndex];
    for (let tokenIndex = start; tokenIndex < end; tokenIndex++) {
      const fieldToken = fieldTokens[tokenIndex];
      let score: number | null = null;
      if (fieldToken === variant) score = variantIndex === 0 ? 0 : 4;
      else if (fieldToken.startsWith(variant)) score = variantIndex === 0 ? 1 : 5;
      else if (variantIndex === 0 && variant.length >= 4 && withinOneEdit(variant, fieldToken)) score = 2;
      if (score !== null && (best === null || score < best)) best = score;
    }
  }
  return best;
}

export interface PreparedSearchItem<T> {
  item: T;
  values: string[];
  fieldTokens: string[];
  fieldTokenOffsets: number[];
}

export interface PreparedNameSearchIndex<T> {
  items: T[];
  values: string[];
}

export interface RankedSearchResult<T> {
  items: T[];
  hasMore: boolean;
  /** Every match the ranking would publish with no limit. */
  total: number;
}

export interface RankOptions<T> {
  // Fuzzy matches join only while direct ones are fewer than this
  // (default: the limit), so a fixed value keeps the total stable.
  fuzzyBelow?: number;
  // Recently watched or favorite: first within its match tier.
  boosted?: (item: T) => boolean;
}

// Match tiers, best first. A title match outranks one in other fields.
const TIER_EXACT = 0;
const TIER_PREFIX = 1;
const TIER_WORD_PREFIX = 2;
const TIER_SUBSTRING = 3;
const TIER_OTHER_FIELD = 4;
const TIER_FUZZY = 8;

interface ScoredSearchItem<T> {
  item: T;
  tier: number;
  boost: number;
  score: number;
  idx: number;
}

interface ScoredNameItem<T> {
  item: T;
  tier: number;
  boost: number;
  pos: number;
  len: number;
  idx: number;
}

export { fold as foldSearchText };

export function prepareSearchItem<T>(
  item: T,
  fields: (item: T) => string[],
): PreparedSearchItem<T> {
  return prepareFoldedSearchItem(item, fields(item).map(fold));
}

/** Like `prepareSearchItem`, for field values already passed through `foldSearchText`. */
export function prepareFoldedSearchItem<T>(item: T, folded: string[]): PreparedSearchItem<T> {
  const values = folded.filter(Boolean);
  const fieldTokens: string[] = [];
  const fieldTokenOffsets = [0];
  for (const value of values) {
    const tokens = splitFolded(value);
    for (const token of tokens) fieldTokens.push(token);
    fieldTokenOffsets.push(fieldTokens.length);
  }
  return { item, values, fieldTokens, fieldTokenOffsets };
}

export function prepareSearchItems<T>(items: T[], fields: (item: T) => string[]): PreparedSearchItem<T>[] {
  return items.map(item => prepareSearchItem(item, fields));
}

export function prepareNameSearchItems<T extends { name: string }>(
  items: T[],
): PreparedNameSearchIndex<T> {
  return {
    items,
    values: items.map(item => fold(item.name)),
  };
}

function compareScored<T>(a: ScoredSearchItem<T>, b: ScoredSearchItem<T>): number {
  return a.tier - b.tier || b.boost - a.boost || a.score - b.score || a.idx - b.idx;
}

function compareNameScored<T>(a: ScoredNameItem<T>, b: ScoredNameItem<T>): number {
  return a.tier - b.tier
    || b.boost - a.boost
    || a.pos - b.pos
    || a.len - b.len
    || a.idx - b.idx;
}

function isWordStart(value: string, pos: number): boolean {
  return pos === 0 || !isLetterOrNumber(value[pos - 1]);
}

/** Where `query` best matches the folded `value`: its first word-start
 *  occurrence, else its first occurrence; -1 when it doesn't occur. */
function bestMatchPosition(value: string, query: string): number {
  const first = value.indexOf(query);
  if (first <= 0) return first;
  for (let pos = first; pos !== -1; pos = value.indexOf(query, pos + 1)) {
    if (isWordStart(value, pos)) return pos;
  }
  return first;
}

function matchTier(value: string, query: string, pos: number): number {
  if (pos === 0) return value.length === query.length ? TIER_EXACT : TIER_PREFIX;
  return isWordStart(value, pos) ? TIER_WORD_PREFIX : TIER_SUBSTRING;
}

interface DirectMatch {
  tier: number;
  score: number;
}

function directMatch<T>(
  prepared: PreparedSearchItem<T>,
  query: string,
): DirectMatch | null {
  let best: DirectMatch | null = null;
  for (let fieldIndex = 0; fieldIndex < prepared.values.length; fieldIndex++) {
    const value = prepared.values[fieldIndex];
    const pos = bestMatchPosition(value, query);
    if (pos === -1) continue;
    const fieldTier = matchTier(value, query, pos);
    const tier = fieldIndex === 0 ? fieldTier : TIER_OTHER_FIELD;
    const score = (fieldIndex === 0 ? 0 : fieldTier * 1_000_000 + fieldIndex * 100_000)
      + Math.min(pos, 999) * 100 + Math.min(value.length, 99);
    if (!best || tier < best.tier || (tier === best.tier && score < best.score)) best = { tier, score };
  }
  return best;
}

function fuzzyScore<T>(
  prepared: PreparedSearchItem<T>,
  terms: string[],
): number | null {
  let total = 10000;
  for (const term of terms) {
    let best: number | null = null;
    for (let fieldIndex = 0; fieldIndex < prepared.values.length; fieldIndex++) {
      const score = tokenScore(
        term,
        prepared.fieldTokens,
        prepared.fieldTokenOffsets[fieldIndex],
        prepared.fieldTokenOffsets[fieldIndex + 1],
      );
      if (score !== null) {
        const weighted = score + fieldIndex * 10;
        if (best === null || weighted < best) best = weighted;
      }
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

class BoundedHeap<T> {
  private values: T[] = [];

  constructor(
    private limit: number,
    private compare: (a: T, b: T) => number,
  ) {}

  add(value: T): void {
    if (this.values.length < this.limit) {
      this.values.push(value);
      this.bubbleUp(this.values.length - 1);
      return;
    }
    if (this.compare(value, this.values[0]) >= 0) return;
    this.values[0] = value;
    this.bubbleDown(0);
  }

  sorted(): T[] {
    return this.values.sort(this.compare);
  }

  private bubbleUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.values[parent], this.values[index]) >= 0) break;
      [this.values[parent], this.values[index]] = [this.values[index], this.values[parent]];
      index = parent;
    }
  }

  private bubbleDown(start: number): void {
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let worse = index;
      if (left < this.values.length
          && this.compare(this.values[left], this.values[worse]) > 0) worse = left;
      if (right < this.values.length
          && this.compare(this.values[right], this.values[worse]) > 0) worse = right;
      if (worse === index) return;
      [this.values[index], this.values[worse]] = [this.values[worse], this.values[index]];
      index = worse;
    }
  }
}

export function rankPreparedTopK<T>(
  items: PreparedSearchItem<T>[],
  query: string,
  limit: number,
  includeFuzzy = true,
  options: RankOptions<T> = {},
): RankedSearchResult<T> {
  const q = fold(query.trim());
  const terms = queryTokens(query);
  if (!q || !terms.length || limit <= 0) return { items: [], hasMore: false, total: 0 };
  const boosted = options.boosted;
  const fuzzyBelow = options.fuzzyBelow ?? limit;
  const heap = new BoundedHeap<ScoredSearchItem<T>>(limit, compareScored);
  const directMatches = includeFuzzy ? new Uint8Array(items.length) : null;
  let matches = 0;
  for (let i = 0; i < items.length; i++) {
    const prepared = items[i];
    const match = directMatch(prepared, q);
    if (!match) continue;
    if (directMatches) directMatches[i] = 1;
    matches++;
    heap.add({
      item: prepared.item,
      tier: match.tier,
      boost: boosted?.(prepared.item) ? 1 : 0,
      score: match.score,
      idx: i,
    });
  }
  const fuzzy = includeFuzzy && matches < fuzzyBelow;
  if (fuzzy) {
    for (let i = 0; i < items.length; i++) {
      const prepared = items[i];
      if (directMatches?.[i]) continue;
      const score = fuzzyScore(prepared, terms);
      if (score === null) continue;
      matches++;
      heap.add({
        item: prepared.item,
        tier: TIER_FUZZY,
        boost: boosted?.(prepared.item) ? 1 : 0,
        score,
        idx: i,
      });
    }
  }
  return {
    items: heap.sorted().map(value => value.item),
    hasMore: matches > limit
      || (includeFuzzy && !fuzzy && matches >= limit && items.length > matches
        && options.fuzzyBelow === undefined),
    total: matches,
  };
}

export function rankPreparedNamesTopK<T>(
  index: PreparedNameSearchIndex<T>,
  query: string,
  limit: number,
  options: RankOptions<T> = {},
): RankedSearchResult<T> {
  const q = fold(query.trim());
  if (!q || limit <= 0) return { items: [], hasMore: false, total: 0 };
  const boosted = options.boosted;
  const heap = new BoundedHeap<ScoredNameItem<T>>(limit, compareNameScored);
  let matches = 0;
  for (let i = 0; i < index.items.length; i++) {
    const value = index.values[i];
    const pos = bestMatchPosition(value, q);
    if (pos === -1) continue;
    matches++;
    const item = index.items[i];
    heap.add({
      item,
      tier: matchTier(value, q, pos),
      boost: boosted?.(item) ? 1 : 0,
      pos,
      len: value.length,
      idx: i,
    });
  }
  return {
    items: heap.sorted().map(value => value.item),
    hasMore: matches > limit,
    total: matches,
  };
}

export function rankPrepared<T>(items: PreparedSearchItem<T>[], query: string): T[] {
  return rankPreparedTopK(items, query, items.length).items;
}

export function rankByFields<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  return rankPrepared(prepareSearchItems(items, fields), query);
}

export function rankByName<T extends { name: string }>(items: T[], query: string): T[] {
  return rankPreparedNamesTopK(
    prepareNameSearchItems(items),
    query,
    items.length,
  ).items;
}

export function rankChannels<T extends { name: string; group: string; sourceName?: string }>(
  items: T[],
  query: string,
): T[] {
  // A renamed channel stays findable under its source name too.
  return rankByFields(items, query, item => [item.name, item.group, item.sourceName ?? '']);
}

export interface MatchRange {
  start: number;
  end: number;
}

// The folded text of `value` and, per folded unit, the span of the source
// character it came from.
function foldWithMap(value: string): { folded: string; starts: number[]; ends: number[] } {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < value.length;) {
    const code = value.charCodeAt(i);
    const width = code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length ? 2 : 1;
    const part = fold(value.slice(i, i + width));
    let end = i + width;
    // Marks the fold drops belong to the character before them.
    while (end < value.length && !fold(value[end])) end++;
    for (let unit = 0; unit < part.length; unit++) {
      starts.push(i);
      ends.push(end);
    }
    folded += part;
    i = end;
  }
  return { folded, starts, ends };
}

/** The spans of `value` a query matched, for highlighting: the whole query
 *  where it occurs, else each query word that does. Typo matches show none. */
export function searchMatchRanges(value: string, query: string): MatchRange[] {
  const q = fold(query.trim());
  if (!q || !value) return [];
  const { folded, starts, ends } = foldWithMap(value);
  const span = (pos: number, length: number): MatchRange =>
    ({ start: starts[pos], end: ends[pos + length - 1] });
  const whole = bestMatchPosition(folded, q);
  if (whole !== -1) return [span(whole, q.length)];
  const ranges: MatchRange[] = [];
  for (const term of queryTokens(query)) {
    const pos = bestMatchPosition(folded, term);
    if (pos !== -1) ranges.push(span(pos, term.length));
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}
