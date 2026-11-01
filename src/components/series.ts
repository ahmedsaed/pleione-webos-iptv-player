import type { Action, PlaylistEntry, SeriesCategory, SeriesItem, SeriesInfo, Episode, ResumeEntry, ResumeKind, VodQueueItem, WatchlistEntry } from '../types';
import { html, Safe } from '../utils/dom';
import { morph } from '../utils/morph';
import { StorageService } from '../services/storage-service';
import { loadSeriesCategories, loadSeries, loadSeriesInfo } from '../services/xtream-catalog';
import { xtreamEpisodeUrl, type XtreamCredentials } from '../utils/xtream-url';
import { CatalogView, type CatalogHandlers, type CollectionKind, type CollectionEntry, type HeroDetails } from './catalog-view';
import { PLAY_ICON, RESTART_ICON } from './icons';
import { showToast } from './toast';
import { t, tp } from '../i18n';
import { VirtualList } from '../utils/virtual-list';
import { uiPx } from '../utils/ui-scale';
import { castGradient, parseCast } from '../utils/cast';
import { formatPosition } from '../utils/time';
import { loadTmdbCredits, matchTmdbPeople, type TmdbPerson } from '../services/tmdb';
import { CONFIG } from '../config';
import { composeEpisodeLabel, episodeCodeOf, episodeLabelOf, episodeTitle, seriesNameOf } from '../utils/episode-label';

// An episode card's width plus the gap after it, as in catalog-view.css.
const EPISODE_STRIDE = 428;
const EPISODE_OVERSCAN = 3;
const EPISODE_VIEWPORT_FALLBACK = 1760;
function episodeRowTitle(ep: Episode): string {
  const code = t('catalog.episodeShort', { episode: ep.episode });
  const title = episodeTitle(ep.title);
  return title ? `${code} · ${title}` : code;
}

// What the browse hero keeps of a series' provider details.
type SeriesSummary = Pick<SeriesInfo, 'poster' | 'genre' | 'year' | 'plot' | 'backdrop'>;

// A saved queue's episodes, named in the UI language.
function localizedQueue(items: VodQueueItem[]): VodQueueItem[] {
  return items.map(item => ({ ...item, title: episodeLabelOf(item, item.title) }));
}

// The Series section: browse (Continue rail of resumed episodes + per-category
// rails + an "all categories" drill-in) → per-category poster grid → a detail
// screen whose Episodes row has season tabs over a sideways row of episode
// cards. The browse/grid/nav machinery lives in CatalogView.
export class Series extends CatalogView<SeriesCategory, SeriesItem> {
  protected get kicker(): string { return t('common.series'); }
  protected readonly resumeKind: ResumeKind = 'episode';
  protected readonly parentalKind = 'series' as const;
  protected scopeName(): string { return 'series'; }
  protected get emptyMessage(): string { return t('catalog.noSeries'); }
  protected get loadFailedMessage(): string { return t('catalog.loadSeriesFailed'); }
  protected get gridEmptyMessage(): string { return t('catalog.noSeriesCategory'); }
  protected itemCount(count: number): string { return tp('catalog.seriesCount', count); }

  private currentSeries: SeriesItem | null = null;
  private currentInfo: SeriesInfo | null = null;
  private pinnedResume: string | null = null;
  private heroInfo = new Map<string, SeriesSummary>();
  // Continue Watching series no loaded category lists, kept so the hero
  // sees the same item each time.
  private resumeSeriesItems = new Map<string, SeriesItem>();
  private selectedSeason = 0;
  private detailLoading = false;
  private detailController: AbortController | null = null;
  private castPhotos = new Map<string, TmdbPerson>();
  private readonly episodeVirtualizer = new VirtualList({
    itemSize: () => uiPx(EPISODE_STRIDE),
    overscan: EPISODE_OVERSCAN,
    fallbackViewportSize: EPISODE_VIEWPORT_FALLBACK,
  });
  private episodeScrollFrame: number | null = null;
  // The episode window last rendered; a scroll inside it needs no render.
  private episodeWindow = '';
  // A held key's reveal writes the row's offset without a smooth scroll.
  private instantEpisodeScroll = false;

  constructor(container: HTMLElement, handlers: CatalogHandlers) {
    super(container, handlers);
  }

  protected loadCategories(
    account: PlaylistEntry,
    signal: AbortSignal,
  ): Promise<SeriesCategory[]> {
    return loadSeriesCategories(account, signal);
  }
  protected loadItems(
    account: PlaylistEntry,
    categoryId: string,
    signal: AbortSignal,
  ): Promise<SeriesItem[]> {
    return loadSeries(account, categoryId, signal);
  }
  protected itemId(s: SeriesItem): string { return s.seriesId; }
  protected itemName(s: SeriesItem): string { return s.name; }
  protected itemPoster(s: SeriesItem): string { return s.poster; }
  protected itemCategoryId(s: SeriesItem): string { return s.categoryId; }
  protected clearDetail(): void {
    this.detailController?.abort();
    this.detailController = null;
    this.currentSeries = null;
    this.pinnedResume = null;
  }
  protected onRequestSessionReset(): void {
    this.detailController?.abort();
    this.detailController = null;
  }

  protected collectionEntries(kind: CollectionKind): CollectionEntry[] {
    if (kind === 'continue') {
      return this.resume.map(entry => ({
        id: entry.itemId, key: `r:${entry.itemId}`,
        tile: () => this.resumeTile(entry),
      }));
    }
    return this.visibleWatchlist('series').map(entry => {
      const series = this.watchlistEntryToSeries(entry);
      return {
        id: entry.itemId, key: `i:${series.categoryId}:${series.seriesId}`,
        tile: () => this.tile(series),
      };
    });
  }

  protected fallbackItem(seriesId: string): SeriesItem | null {
    const entry = this.visibleWatchlist('series')
      .find((item) => item.itemId === seriesId);
    return entry ? this.watchlistEntryToSeries(entry) : null;
  }

  protected itemGenre(s: SeriesItem): string | undefined { return s.genre; }

  // The series list usually carries what the hero shows; a series without
  // it, such as one only Continue Watching names, asks get_series_info.
  protected heroDetails(s: SeriesItem): HeroDetails {
    const info = this.heroInfo.get(this.heroInfoKey(s.seriesId));
    return {
      poster: s.poster ? undefined : info?.poster || undefined,
      genre: s.genre || info?.genre || undefined,
      year: s.year || info?.year || undefined,
      plot: s.plot || info?.plot || undefined,
      backdrop: s.backdrop || info?.backdrop || undefined,
    };
  }

  protected heroDetailsPending(s: SeriesItem): boolean {
    return !!this.account && !(s.genre || s.year || s.plot || s.backdrop)
      && !this.heroInfo.has(this.heroInfoKey(s.seriesId));
  }

  protected async loadHeroDetails(s: SeriesItem, signal: AbortSignal): Promise<void> {
    const account = this.account;
    if (!account) return;
    const info = await loadSeriesInfo(account, s.seriesId, signal);
    if (info && !signal.aborted && this.account?.id === account.id) this.rememberHeroInfo(s.seriesId, info);
  }

  private heroInfoKey(seriesId: string): string {
    return `${this.account?.id ?? ''}|${seriesId}`;
  }

  private rememberHeroInfo(seriesId: string, info: SeriesInfo): void {
    const key = this.heroInfoKey(seriesId);
    this.heroInfo.delete(key);
    this.heroInfo.set(key, {
      poster: info.poster, genre: info.genre, year: info.year, plot: info.plot, backdrop: info.backdrop,
    });
    if (this.heroInfo.size > CONFIG.XTREAM.HERO_DETAILS_CACHE_ITEMS) {
      this.heroInfo.delete(this.heroInfo.keys().next().value!);
    }
  }

  // The series a Continue Watching episode belongs to: its catalog item, or
  // one built from what the episode saved until its category loads.
  protected resumeItem(entry: ResumeEntry): SeriesItem | null {
    const seriesId = entry.watchlistOwner?.itemId;
    if (!seriesId) return null;
    const found = this.findItem(entry.categoryId ?? '', seriesId);
    if (found) return found;
    const key = `${entry.accountId}|${seriesId}`;
    let item = this.resumeSeriesItems.get(key);
    if (!item) {
      item = {
        accountId: entry.accountId, seriesId,
        name: seriesNameOf(entry, entry.name) || this.resumeName(entry),
        poster: entry.seriesEpisode?.seriesPoster ?? '', rating: '', categoryId: entry.categoryId ?? '',
      };
      this.resumeSeriesItems.set(key, item);
    }
    return item;
  }

  // The series' own poster, else the episode's.
  protected resumePoster(entry: ResumeEntry): string {
    const series = this.resumeItem(entry);
    if (!series) return entry.poster;
    return series.poster || this.heroInfo.get(this.heroInfoKey(series.seriesId))?.poster || entry.poster;
  }

  protected resumeCategoryIds(): string[] {
    return this.resume.map(entry => (entry.watchlistOwner ? entry.categoryId ?? '' : ''));
  }

  protected heroFallback(): SeriesItem | null {
    const entry = this.visibleWatchlist('series')[0];
    return entry ? this.watchlistEntryToSeries(entry) : null;
  }

  private watchlistEntryToSeries(entry: WatchlistEntry): SeriesItem {
    return {
      accountId: entry.accountId,
      seriesId: entry.itemId,
      name: entry.name,
      poster: entry.poster,
      rating: entry.rating,
      categoryId: entry.categoryId,
    };
  }

  protected selectExtra(el: HTMLElement): boolean {
    if (el.dataset.action === 'watchlist') { this.toggleWatchlist(); return true; }
    if (el.dataset.action === 'resume') { this.resumeSeries(); return true; }
    if (el.dataset.action === 'play') { this.playFirstEpisode(); return true; }
    if (el.dataset.action === 'restart') { this.restartSeries(); return true; }
    if (el.dataset.resumeEpisode !== undefined) { this.openResumed(el.dataset.resumeEpisode); return true; }
    if (el.dataset.season !== undefined) { this.selectSeason(Number(el.dataset.season)); return true; }
    if (el.dataset.episodeId !== undefined) { this.playEpisode(el.dataset.episodeId); return true; }
    return false;
  }

  // A Continue Watching episode opens its series' page, whose Resume plays
  // that episode. An entry saved without its series still plays directly.
  private openResumed(episodeId: string): void {
    const entry = this.resume.find((e) => e.itemId === episodeId);
    const seriesId = entry?.watchlistOwner?.itemId;
    if (!entry || !seriesId) {
      this.playResume(episodeId);
      return;
    }
    void this.openDetail(this.resumeItem(entry)!, episodeId);
  }

  private toggleWatchlist(): void {
    const series = this.currentSeries;
    const account = this.account;
    if (!series || !account) return;
    const result = StorageService.toggleWatchlist({
      accountId: account.id,
      kind: 'series',
      itemId: series.seriesId,
      name: series.name,
      poster: this.currentInfo?.poster || series.poster,
      rating: this.currentInfo?.rating || series.rating,
      categoryId: series.categoryId,
      addedAt: Date.now(),
    });
    showToast(t(result === 'full' ? 'catalog.watchlistFull'
      : result === 'added' ? 'catalog.watchlistAdded' : 'catalog.watchlistRemoved'));
    this.renderDetail();
  }

  // `resumeEpisodeId`: the episode Resume plays while it has a resume point,
  // instead of the series' latest one.
  protected async openDetail(series: SeriesItem, resumeEpisodeId: string | null = null): Promise<void> {
    const account = this.account;
    if (!account || !this.requestSignal) return;
    this.detailController?.abort();
    this.detailController = new AbortController();
    const signal = this.detailController.signal;
    this.currentSeries = series;
    this.pinnedResume = resumeEpisodeId;
    this.enterDetail();
    this.currentInfo = null;
    this.selectedSeason = 0;
    this.castPhotos = new Map();
    this.episodeVirtualizer.setScrollOffset(0);
    this.detailLoading = true;
    this.renderDetail();
    void this.ensureCategoryItems(series.categoryId, signal).then((loaded) => {
      if (loaded && this.mode === 'detail' && this.currentSeries === series) this.renderDetail();
    });
    if (await this.loadDetailInfo(account, series, signal)) await this.loadCastPhotos(series, signal);
  }

  // True when the detail still shows `series`, with or without its info.
  private async loadDetailInfo(
    account: PlaylistEntry,
    series: SeriesItem,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      this.currentInfo = await loadSeriesInfo(account, series.seriesId, signal);
      if (this.currentInfo) this.rememberHeroInfo(series.seriesId, this.currentInfo);
    } catch (err) {
      if (!this.requestFailed('Series detail load', err, signal)) return false;
      this.currentInfo = null;
    }
    if (this.mode !== 'detail' || this.currentSeries !== series) return false;
    this.detailLoading = false;
    // The row opens on the season and episode Resume plays.
    const resumed = this.resumeEpisode();
    this.selectedSeason = resumed?.episode?.season ?? this.currentInfo?.seasons[0] ?? 0;
    const index = resumed?.episode ? this.episodeIndexOf(`ep:${resumed.episode.id}`) : -1;
    if (index > 0) this.episodeVirtualizer.ensureVisible(index, this.episodeViewport());
    this.renderDetail();
    return true;
  }

  // Play on a series whose episodes failed to load asks for them again,
  // then plays the first one.
  private retryDetailInfo(): void {
    const account = this.account;
    const series = this.currentSeries;
    const signal = this.detailController?.signal;
    if (!account || !series || !signal || signal.aborted) return;
    this.detailLoading = true;
    this.renderDetail();
    void this.loadDetailInfo(account, series, signal).then((shown) => {
      if (!shown || !this.currentInfo) return;
      this.playFirstEpisode();
      void this.loadCastPhotos(series, signal);
    });
  }

  // Opt-in TMDB photos for the provider's cast; nothing is asked without a key.
  private async loadCastPhotos(series: SeriesItem, signal: AbortSignal): Promise<void> {
    const info = this.currentInfo;
    if (!info || signal.aborted || !StorageService.getTmdbApiKey()) return;
    const members = parseCast(info.cast, info.director);
    if (!members.length) return;
    const people = await loadTmdbCredits('tv', { tmdbId: info.tmdbId, imdbId: info.imdbId }, signal);
    if (!people || signal.aborted || this.currentSeries !== series) return;
    this.castPhotos = matchTmdbPeople(members.map(m => m.name), people);
    if (this.mode === 'detail' && this.castPhotos.size) this.renderDetail();
  }

  private selectSeason(season: number): void {
    if (season === this.selectedSeason) return;
    this.selectedSeason = season;
    this.episodeVirtualizer.setScrollOffset(0);
    this.renderDetail();
  }

  // The series' most recently watched episode, with its place in the
  // catalog once the episode list has loaded.
  private resumeEpisode(): { entry: ResumeEntry; episode: Episode | null } | null {
    const series = this.currentSeries;
    const a = this.account;
    if (!series || !a) return null;
    let best: { entry: ResumeEntry; episode: Episode | null } | null = null;
    for (const entry of StorageService.getResumeList(a.id)) {
      if (entry.kind !== 'episode') continue;
      const episode = this.findEpisode(entry.itemId);
      if (!episode && entry.watchlistOwner?.itemId !== series.seriesId) continue;
      if (entry.itemId === this.pinnedResume) return { entry, episode };
      if (!best || entry.updatedAt > best.entry.updatedAt) best = { entry, episode };
    }
    return best;
  }

  private resumeSeries(): void {
    const resumed = this.resumeEpisode();
    if (!resumed) return;
    if (resumed.episode) this.playEpisode(resumed.episode.id);
    else this.playResume(resumed.entry.itemId);
  }

  private restartSeries(): void {
    const episode = this.resumeEpisode()?.episode;
    if (episode) this.playEpisode(episode.id, true);
  }

  private playFirstEpisode(): void {
    const info = this.currentInfo;
    if (!info) {
      if (!this.detailLoading) this.retryDetailInfo();
      return;
    }
    for (const season of info.seasons) {
      const first = (info.episodesBySeason[season] ?? [])[0];
      if (first) {
        this.playEpisode(first.id);
        return;
      }
    }
  }

  private findEpisode(episodeId: string): Episode | null {
    const info = this.currentInfo;
    if (!info) return null;
    for (const season of info.seasons) {
      const ep = (info.episodesBySeason[season] ?? []).find((e) => e.id === episodeId);
      if (ep) return ep;
    }
    return null;
  }

  private episodePlayback(series: SeriesItem, ep: Episode): VodQueueItem {
    const a = this.account!;
    const seriesPoster = this.currentInfo?.poster || series.poster;
    const seriesEpisode = {
      seriesName: series.name, season: ep.season, episode: ep.episode, title: ep.title, seriesPoster,
    };
    return {
      url: xtreamEpisodeUrl(this.creds(), ep.id, ep.containerExtension || 'mp4'),
      title: composeEpisodeLabel(seriesEpisode),
      poster: ep.poster || seriesPoster,
      accountId: a.id,
      itemId: ep.id,
      kind: 'episode',
      categoryId: series.categoryId,
      parentalItemId: series.seriesId,
      subtitles: ep.subtitles,
      searchMeta: { season: ep.season, episode: ep.episode },
      watchlistOwner: { kind: 'series', itemId: series.seriesId },
      seriesEpisode,
    };
  }

  // The series' episodes in viewing order, split around `episodeId`.
  private episodesAround(episodeId: string, series: SeriesItem): {
    before: VodQueueItem[];
    after: VodQueueItem[];
  } {
    const info = this.currentInfo;
    if (!info) return { before: [], after: [] };
    const episodes = info.seasons.reduce<Episode[]>(
      (all, season) => all.concat(info.episodesBySeason[season] ?? []), []);
    const index = episodes.findIndex((ep) => ep.id === episodeId);
    if (index < 0) return { before: [], after: [] };
    return {
      before: episodes.slice(0, index).map((ep) => this.episodePlayback(series, ep)),
      after: episodes.slice(index + 1).map((ep) => this.episodePlayback(series, ep)),
    };
  }

  private playEpisode(episodeId: string, fromStart = false): void {
    const ep = this.findEpisode(episodeId);
    const series = this.currentSeries;
    const a = this.account;
    if (!ep || !series || !a) return;
    const saved = StorageService.getResume(a.id, 'episode', ep.id);
    const around = this.episodesAround(ep.id, series);
    this.handlers.onPlayVod({
      ...this.episodePlayback(series, ep),
      resumeSecs: saved && !fromStart ? saved.position : 0,
      episodeQueue: around.after,
      previousEpisodes: around.before,
    });
  }

  private creds(): XtreamCredentials {
    const a = this.account!;
    return { baseUrl: a.url, username: a.xtream!.username, password: a.xtream!.password };
  }

  // A Continue-rail tile carries only the resume entry (episode id + composed
  // label + poster + stored container extension), not the owning series, so it
  // resumes the episode directly using the stored ext (falling back to mp4).
  private playResume(episodeId: string): void {
    const a = this.account;
    const r = this.resume.find((e) => e.itemId === episodeId);
    if (!a || !r) return;
    this.handlers.onPlayVod({
      url: xtreamEpisodeUrl(this.creds(), r.itemId, r.ext || 'mp4'),
      title: episodeLabelOf(r, r.name),
      poster: r.poster,
      accountId: a.id,
      itemId: r.itemId,
      kind: 'episode',
      categoryId: r.categoryId,
      parentalItemId: r.watchlistOwner?.itemId,
      resumeSecs: r.position,
      subtitles: [],
      episodeQueue: r.episodeQueue && localizedQueue(r.episodeQueue),
      previousEpisodes: r.previousEpisodes && localizedQueue(r.previousEpisodes),
      watchlistOwner: r.watchlistOwner,
      seriesEpisode: r.seriesEpisode,
    });
  }

  // The name a Continue Watching episode shows, in the UI language.
  protected resumeName(r: ResumeEntry): string {
    return episodeLabelOf(r, r.name);
  }

  private resumeTile(r: ResumeEntry): Safe {
    return html`
      <div class="catalog-tile" data-focusable data-key="r:${r.itemId}" data-resume-episode="${r.itemId}"
           data-long-press>
        <div class="catalog-poster-wrap">${this.posterCell(this.resumeName(r), this.resumePoster(r))}${
          this.itemLockBadge(r.categoryId ?? '', r.watchlistOwner?.itemId ?? r.itemId)}${
          this.progressBar(r.position, r.duration)}</div>
        <div class="catalog-tile-name">${this.resumeName(r)}</div>
      </div>
    `;
  }

  private episodeCard(accountId: string, ep: Episode): Safe {
    const saved = StorageService.getResume(accountId, 'episode', ep.id);
    const mins = ep.durationSecs >= 60 ? t('catalog.minutes', { count: Math.floor(ep.durationSecs / 60) }) : '';
    // Percent-encoded like the hero's, for the CSS url('…') string.
    const poster = ep.poster.replace(/["'()\\\s]/g, encodeURIComponent);
    return html`
      <div class="episode-card" data-focusable data-key="ep:${ep.id}" data-episode-id="${ep.id}">
        <div class="episode-thumb" style="background-image:${castGradient(`${ep.season}:${ep.episode}:${ep.id}`)}">
          ${poster ? html`<div class="episode-thumb-art" style="background-image:url('${poster}')"></div>` : ''}
          ${saved ? this.progressBar(saved.position, saved.duration)
            : StorageService.isWatched(accountId, 'episode', ep.id) ? this.progressBar(1, 1) : ''}
        </div>
        <div class="episode-title">${episodeRowTitle(ep)}</div>
        <div class="episode-meta">${mins}</div>
      </div>
    `;
  }

  private seasonTabs(info: SeriesInfo): Safe | '' {
    if (info.seasons.length === 0) return '';
    return html`
      <div class="series-seasons">
        ${info.seasons.map((n) => html`
          <button class="series-season-btn${n === this.selectedSeason ? ' active' : ''}" type="button"
                  aria-pressed="${String(n === this.selectedSeason)}"
                  data-focusable data-key="season:${n}" data-season="${n}">${t('catalog.season', { number: n })}</button>
        `)}
      </div>
    `;
  }

  private episodesRail(accountId: string): Safe {
    const info = this.currentInfo;
    const hint = (text: string, head: Safe | '' = ''): Safe => this.detailRail(
      'episodes', t('catalog.episodes'), [html`<p class="catalog-hint episode-hint">${text}</p>`], head,
    );
    if (this.detailLoading) return hint(t('common.loading'));
    if (!info) return hint(t('catalog.loadEpisodesFailed'));
    if (info.seasons.length === 0) return hint(t('catalog.noEpisodes'));
    const episodes = this.selectedEpisodes();
    if (!episodes.length) return hint(t('catalog.noSeasonEpisodes'), this.seasonTabs(info));
    const range = this.episodeVirtualizer.getRange(episodes.length, this.episodeViewport());
    this.episodeWindow = `${this.selectedSeason}:${range.start}:${range.end}`;
    return this.detailRail('episodes', t('catalog.episodes'), [html`
      <div class="episode-track-spacer" style="width:${this.episodeVirtualizer.getTotalSize(episodes.length)}px">
        ${episodes.slice(range.start, range.end).map((ep, offset) => {
          const index = range.start + offset;
          return html`
            <div class="episode-cell" data-key="episode-cell:${ep.id}" data-episode-index="${index}"
                 style="left:${this.episodeVirtualizer.getItemOffset(index)}px">
              ${this.episodeCard(accountId, ep)}
            </div>
          `;
        })}
      </div>
    `], this.seasonTabs(info), 'episode-track');
  }

  // Resume, then Play from start for the episode it resumes. The episode after
  // a finished one already starts from the beginning.
  private primaryActions(): Safe {
    const resumed = this.resumeEpisode();
    if (!resumed) {
      return this.detailButton({ key: 'play', label: t('catalog.play'), icon: PLAY_ICON, primary: true });
    }
    const { entry, episode } = resumed;
    const code = episode ? null : episodeCodeOf(entry, entry.name);
    const season = episode ? episode.season : code ? code.season : 0;
    const number = episode ? episode.episode : code ? code.episode : 0;
    return html`
      ${this.detailButton({
        key: 'resume',
        label: t('catalog.resumeAt', {
          position: season > 0 || number > 0
            ? t('catalog.episodeCode', { season, episode: number })
            : formatPosition(entry.position),
        }),
        icon: PLAY_ICON,
        primary: true,
      })}
      ${episode && entry.position > 0
        ? this.detailButton({ key: 'restart', label: t('catalog.playFromStart'), icon: RESTART_ICON }) : ''}
    `;
  }

  protected renderDetail(restoreFocus = true): void {
    const series = this.currentSeries;
    const a = this.account;
    if (!series || !a) return;
    const info = this.currentInfo;
    const track = this.episodeTrack();
    if (restoreFocus && track) this.episodeVirtualizer.setScrollOffset(track.scrollLeft);
    const year = info?.year || series.year || 0;
    const seasons = info?.seasons.length ?? 0;
    const watchlisted = StorageService.isWatchlisted(a.id, 'series', series.seriesId);
    morph(this.layer('detail'), this.detailPage({
      id: series.seriesId,
      name: series.name,
      poster: info?.poster || series.poster,
      backdrop: info?.backdrop || series.backdrop || '',
      year: year > 0 ? String(year) : '',
      runtime: seasons > 0 ? tp('catalog.seasonCount', seasons) : '',
      genre: info?.genre || series.genre || '',
      rating: info?.rating || series.rating,
      plot: info?.plot || series.plot || '',
      actions: html`${this.primaryActions()}${this.watchlistButton(watchlisted)}`,
      rows: [
        this.episodesRail(a.id),
        this.castRail(parseCast(info?.cast ?? '', info?.director ?? ''), this.castPhotos),
        this.moreLikeThisRail(series.categoryId, series.seriesId, info?.genre || series.genre || ''),
      ],
    }));
    const rendered = this.episodeTrack();
    if (rendered) {
      this.scrollGuard.syncOffset(rendered, 'horizontal', this.episodeVirtualizer.scrollOffset,
        this.instantEpisodeScroll);
    }
    this.settleDetailLayout();
    if (restoreFocus) this.settleDetailFocus();
  }

  private episodeTrack(): HTMLElement | null {
    return this.layer('detail').querySelector<HTMLElement>('.episode-track');
  }

  // The cards sit inside the track's padding, which bleeds under its margin.
  private episodeViewport(): number {
    const track = this.episodeTrack();
    if (!track?.clientWidth) return EPISODE_VIEWPORT_FALLBACK;
    const style = getComputedStyle(track);
    return track.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  }

  private selectedEpisodes(): Episode[] {
    return this.currentInfo?.episodesBySeason[this.selectedSeason] ?? [];
  }

  private episodeIndexOf(key: string): number {
    return this.selectedEpisodes().findIndex((ep) => `ep:${ep.id}` === key);
  }

  protected hasExtraKey(key: string): boolean {
    return this.episodeIndexOf(key) >= 0;
  }

  // An episode the row scrolled away renders again before it is shown; one
  // in the window only scrolls whole into view.
  protected revealExtraKey(key: string, instant: boolean): boolean | null | undefined {
    const index = this.episodeIndexOf(key);
    if (index < 0) return undefined;
    if (!this.episodeVirtualizer.ensureVisible(index, this.episodeViewport())) return null;
    if (instant) this.instantEpisodeScroll = true;
    try {
      this.renderDetail(false);
    } finally {
      this.instantEpisodeScroll = false;
    }
    return true;
  }

  // Left and Right step through the season's episodes, rendering the next
  // one first; at either end they stay put.
  protected moveExtraFocus(action: Action): boolean {
    if (this.mode !== 'detail' || (action !== 'left' && action !== 'right')) return false;
    const key = this.focusedKey();
    const current = key === null ? -1 : this.episodeIndexOf(key);
    if (current < 0) return false;
    const next = current + (action === 'left' ? -1 : 1);
    if (next < 0 || next >= this.selectedEpisodes().length) return true;
    this.episodeVirtualizer.ensureVisible(next, this.episodeViewport());
    this.renderDetail(false);
    this.place(
      this.layer('detail').querySelector<HTMLElement>(`[data-episode-index="${next}"] [data-focusable]`),
      'key',
    );
    return true;
  }

  protected handleExtraScroll(target: HTMLElement): boolean {
    if (this.mode !== 'detail' || !target.classList.contains('episode-track')) return false;
    const offset = this.scrollGuard.readUserOffset(target, 'horizontal');
    if (offset === null) return true;
    this.episodeVirtualizer.setScrollOffset(offset);
    if (this.episodeScrollFrame === null) {
      this.episodeScrollFrame = requestAnimationFrame(() => {
        this.episodeScrollFrame = null;
        if (this.mode !== 'detail') return;
        const range = this.episodeVirtualizer.getRange(this.selectedEpisodes().length, this.episodeViewport());
        if (this.episodeWindow !== `${this.selectedSeason}:${range.start}:${range.end}`) this.renderDetail(false);
      });
    }
    return true;
  }
}
