import type { PlaylistEntry, VodCategory, VodItem, VodInfo, ResumeKind, WatchlistEntry, VodQueueItem } from '../types';
import { html, raw, Safe } from '../utils/dom';
import { morph } from '../utils/morph';
import { StorageService } from '../services/storage-service';
import { loadVodCategories, loadVodStreams, loadVodInfo } from '../services/xtream-catalog';
import { xtreamVodUrl } from '../utils/xtream-url';
import { CatalogView, type CollectionKind, type CollectionEntry, type HeroDetails } from './catalog-view';
import { PLAY_ICON, RESTART_ICON } from './icons';
import { parseCast } from '../utils/cast';
import { formatDuration, formatPosition } from '../utils/time';
import { loadTmdbCredits, matchTmdbPeople, type TmdbPerson } from '../services/tmdb';
import { showToast } from './toast';
import { t, tp } from '../i18n';
import { CONFIG } from '../config';

// The Movies section: browse (Continue rail + per-category rails + an "all
// categories" drill-in) → per-category poster grid → a detail screen with
// Play / Resume. The browse/grid/nav machinery lives in CatalogView.
export class Movies extends CatalogView<VodCategory, VodItem> {
  protected get kicker(): string { return t('common.movies'); }
  protected readonly resumeKind: ResumeKind = 'vod';
  protected readonly parentalKind = 'vod' as const;
  protected scopeName(): string { return 'movies'; }
  protected get emptyMessage(): string { return t('catalog.noMovies'); }
  protected get gridEmptyMessage(): string { return t('catalog.noMoviesCategory'); }
  protected itemCount(count: number): string { return tp('catalog.movieCount', count); }

  private currentVod: VodItem | null = null;
  private currentInfo: VodInfo | null = null;
  private openedFromWatchlist = false;
  private detailController: AbortController | null = null;
  private castPhotos = new Map<string, TmdbPerson>();
  // get_vod_info results the browse hero has shown, newest last; null when
  // the provider had none, so a title is asked for once.
  private readonly heroInfo = new Map<string, VodInfo | null>();

  protected loadCategories(
    account: PlaylistEntry,
    signal: AbortSignal,
  ): Promise<VodCategory[]> {
    return loadVodCategories(account, signal);
  }
  protected loadItems(
    account: PlaylistEntry,
    categoryId: string,
    signal: AbortSignal,
  ): Promise<VodItem[]> {
    return loadVodStreams(account, categoryId, signal);
  }
  protected itemId(v: VodItem): string { return v.streamId; }
  protected itemName(v: VodItem): string { return v.name; }
  protected itemPoster(v: VodItem): string { return v.poster; }
  protected itemCategoryId(v: VodItem): string { return v.categoryId; }
  protected clearDetail(): void {
    this.detailController?.abort();
    this.detailController = null;
    this.currentVod = null;
    this.openedFromWatchlist = false;
  }
  protected onRequestSessionReset(): void {
    this.detailController?.abort();
    this.detailController = null;
  }

  // Continue and Watchlist tiles may not be in a preloaded category, so
  // synthesize the minimal item needed to open their detail screen.
  protected fallbackItem(streamId: string): VodItem | null {
    return this.resumeToVod(streamId) ?? this.watchlistToVod(streamId);
  }
  private heroInfoKey(v: VodItem): string {
    return `${this.account?.id ?? ''}|${v.streamId}`;
  }

  private rememberHeroInfo(v: VodItem, info: VodInfo | null): void {
    const key = this.heroInfoKey(v);
    this.heroInfo.delete(key);
    this.heroInfo.set(key, info);
    if (this.heroInfo.size > CONFIG.XTREAM.HERO_DETAILS_CACHE_ITEMS) {
      this.heroInfo.delete(this.heroInfo.keys().next().value!);
    }
  }

  // The stream list carries no genre or plot; get_vod_info does.
  protected heroDetails(v: VodItem): HeroDetails {
    const info = this.heroInfo.get(this.heroInfoKey(v));
    return {
      genre: info?.genre || undefined,
      year: info?.year || v.year,
      plot: info?.plot || undefined,
      backdrop: info?.backdrop || undefined,
    };
  }

  protected heroDetailsPending(v: VodItem): boolean {
    return !!this.account && !this.heroInfo.has(this.heroInfoKey(v));
  }

  protected async loadHeroDetails(v: VodItem, signal: AbortSignal): Promise<void> {
    const account = this.account;
    if (!account) return;
    const info = await loadVodInfo(account, v.streamId, signal);
    if (!signal.aborted && this.account?.id === account.id) this.rememberHeroInfo(v, info);
  }

  protected heroFallback(): VodItem | null {
    return this.resumeToVod(this.resume[0]?.itemId ?? '')
      ?? this.watchlistToVod(this.visibleWatchlist('vod')[0]?.itemId ?? '');
  }

  private resumeToVod(streamId: string): VodItem | null {
    const r = this.resume.find((e) => e.itemId === streamId);
    if (!r) return null;
    return { accountId: r.accountId, streamId: r.itemId, name: r.name, poster: r.poster, rating: '', categoryId: r.categoryId ?? '', containerExtension: r.ext };
  }

  protected collectionEntries(kind: CollectionKind): CollectionEntry[] {
    if (kind === 'continue') {
      return this.resume.map(entry => {
        const vod = this.resumeToVod(entry.itemId)!;
        const key = `i:${vod.categoryId}:${vod.streamId}`;
        return {
          id: entry.itemId, key,
          tile: managing => this.tile(vod, html`
            ${this.progressBar(entry.position, entry.duration)}${this.removeMark(managing, key)}
          `, managing),
        };
      });
    }
    return this.visibleWatchlist('vod').map(entry => ({
      id: entry.itemId, key: `w:${entry.itemId}`,
      tile: managing => this.watchlistTile(entry, managing),
    }));
  }

  private watchlistTile(entry: WatchlistEntry, managing = false): Safe {
    const vod = this.watchlistEntryToVod(entry);
    return html`
      <div class="catalog-tile" ${raw(managing ? '' : 'data-focusable')} data-key="w:${vod.streamId}"
           data-item-id="${vod.streamId}" data-category-id="${vod.categoryId}"
           data-watchlist-item="${vod.streamId}">
        <div class="catalog-poster-wrap">${this.posterCell(vod.name, vod.poster)}${
          this.itemLockBadge(vod.categoryId, vod.streamId)}${this.removeMark(managing, `w:${vod.streamId}`)}</div>
        <div class="catalog-tile-name">${vod.name}</div>
      </div>
    `;
  }

  private watchlistToVod(streamId: string): VodItem | null {
    const entry = this.visibleWatchlist('vod')
      .find((item) => item.itemId === streamId);
    return entry ? this.watchlistEntryToVod(entry) : null;
  }

  private watchlistEntryToVod(entry: WatchlistEntry): VodItem {
    return {
      accountId: entry.accountId,
      streamId: entry.itemId,
      name: entry.name,
      poster: entry.poster,
      rating: entry.rating,
      categoryId: entry.categoryId,
      containerExtension: entry.containerExtension ?? 'mp4',
    };
  }

  protected itemGenre(v: VodItem): string | undefined {
    return this.heroInfo.get(this.heroInfoKey(v))?.genre || undefined;
  }

  protected selectExtra(el: HTMLElement): boolean {
    if (el.dataset.watchlistItem !== undefined) {
      const vod = this.watchlistToVod(el.dataset.watchlistItem);
      if (vod) void this.openDetail(vod, true);
      return true;
    }
    if (el.dataset.action === 'play' || el.dataset.action === 'resume') {
      this.play(el.dataset.action === 'resume');
      return true;
    }
    if (el.dataset.action === 'watchlist') {
      this.toggleWatchlist();
      return true;
    }
    return false;
  }

  private toggleWatchlist(): void {
    const vod = this.currentVod;
    const account = this.account;
    if (!vod || !account) return;
    const result = StorageService.toggleWatchlist({
      accountId: account.id,
      kind: 'vod',
      itemId: vod.streamId,
      name: vod.name,
      poster: this.currentInfo?.poster || vod.poster,
      rating: vod.rating,
      categoryId: vod.categoryId,
      containerExtension: vod.containerExtension,
      addedAt: Date.now(),
    });
    showToast(t(result === 'full' ? 'catalog.watchlistFull'
      : result === 'added' ? 'catalog.watchlistAdded' : 'catalog.watchlistRemoved'));
    this.renderDetail();
  }

  protected async openDetail(vod: VodItem, fromWatchlist = false): Promise<void> {
    const account = this.account;
    if (!account || !this.requestSignal) return;
    this.detailController?.abort();
    this.detailController = new AbortController();
    const signal = this.detailController.signal;
    this.openedFromWatchlist = fromWatchlist;
    this.currentVod = vod;
    this.enterDetail();
    // What the browse hero already fetched shows at once.
    const shown = this.heroInfo.get(this.heroInfoKey(vod)) ?? null;
    this.currentInfo = shown;
    this.castPhotos = new Map();
    this.renderDetail();
    void this.ensureCategoryItems(vod.categoryId, signal).then((loaded) => {
      if (loaded && this.mode === 'detail' && this.currentVod === vod) this.renderDetail();
    });
    try {
      this.currentInfo = await loadVodInfo(account, vod.streamId, signal);
      if (!signal.aborted) this.rememberHeroInfo(vod, this.currentInfo);
    } catch (err) {
      if (!this.requestFailed('Movie detail load', err, signal)) return;
      this.currentInfo = shown;
    }
    if (this.mode === 'detail' && this.currentVod === vod) this.renderDetail();
    await this.loadCastPhotos(vod, signal);
  }

  // Opt-in TMDB photos for the provider's cast; nothing is asked without a key.
  private async loadCastPhotos(vod: VodItem, signal: AbortSignal): Promise<void> {
    const info = this.currentInfo;
    if (!info || signal.aborted || !StorageService.getTmdbApiKey()) return;
    const members = parseCast(info.cast, info.director);
    if (!members.length) return;
    const people = await loadTmdbCredits('movie', { tmdbId: info.tmdbId, imdbId: info.imdbId }, signal);
    if (!people || signal.aborted || this.currentVod !== vod) return;
    this.castPhotos = matchTmdbPeople(members.map(m => m.name), people);
    if (this.mode === 'detail' && this.castPhotos.size) this.renderDetail();
  }

  private play(resume: boolean): void {
    const vod = this.currentVod;
    const a = this.account;
    if (!vod || !a) return;
    const saved = StorageService.getResume(a.id, 'vod', vod.streamId);
    this.handlers.onPlayVod({
      url: this.vodUrl(vod),
      title: vod.name,
      poster: this.currentInfo?.poster || vod.poster,
      accountId: a.id,
      itemId: vod.streamId,
      kind: 'vod',
      categoryId: vod.categoryId,
      resumeSecs: resume && saved ? saved.position : 0,
      subtitles: this.currentInfo?.subtitles ?? [],
      watchlistQueue: this.openedFromWatchlist ? this.movieWatchlistQueue(vod.streamId) : undefined,
      searchMeta: {
        imdbId: this.currentInfo?.imdbId || undefined,
        tmdbId: this.currentInfo?.tmdbId || undefined,
        year: this.currentInfo?.year || undefined,
      },
    });
  }

  private movieWatchlistQueue(streamId: string): VodQueueItem[] {
    const entries = this.visibleWatchlist('vod');
    const index = entries.findIndex((entry) => entry.itemId === streamId);
    if (index < 0) return [];
    return entries.slice(index + 1).map((entry) => {
      const vod = this.watchlistEntryToVod(entry);
      return {
        url: this.vodUrl(vod),
        title: vod.name,
        poster: vod.poster,
        accountId: vod.accountId,
        itemId: vod.streamId,
        kind: 'vod',
        categoryId: vod.categoryId,
        subtitles: [],
      };
    });
  }

  private vodUrl(vod: VodItem): string {
    const a = this.account!;
    return xtreamVodUrl(
      { baseUrl: a.url, username: a.xtream!.username, password: a.xtream!.password },
      vod.streamId,
      vod.containerExtension || 'mp4',
    );
  }

  protected renderDetail(): void {
    const vod = this.currentVod;
    const a = this.account;
    if (!vod || !a) return;
    const info = this.currentInfo;
    const saved = StorageService.getResume(a.id, 'vod', vod.streamId);
    const year = info?.year || Number((info?.releaseDate.match(/\d{4}/) || [''])[0]) || vod.year || 0;
    const watchlisted = StorageService.isWatchlisted(a.id, 'vod', vod.streamId);
    const actions = saved ? html`
      ${this.detailButton({
        key: 'resume',
        label: t('catalog.resumeAt', { position: formatPosition(saved.position) }),
        icon: PLAY_ICON,
        primary: true,
        progress: saved.duration > 0 ? saved.position / saved.duration : undefined,
      })}
      ${this.watchlistButton(watchlisted)}
      ${this.detailButton({ key: 'play', label: t('catalog.playFromStart'), icon: RESTART_ICON })}
    ` : html`
      ${this.detailButton({
        key: 'play', label: t('catalog.play'), icon: PLAY_ICON, primary: true,
        progress: StorageService.isWatched(a.id, 'vod', vod.streamId) ? 1 : undefined,
      })}
      ${this.watchlistButton(watchlisted)}
    `;
    morph(this.layer('detail'), this.detailPage({
      id: vod.streamId,
      name: vod.name,
      poster: info?.poster || vod.poster,
      backdrop: info?.backdrop || '',
      year: year > 0 ? String(year) : '',
      runtime: info && info.durationSecs >= 60 ? formatDuration(info.durationSecs * 1000) : '',
      genre: info?.genre ?? '',
      rating: info?.rating || vod.rating,
      plot: info?.plot ?? '',
      actions,
      rows: [
        this.castRail(parseCast(info?.cast ?? '', info?.director ?? ''), this.castPhotos),
        this.moreLikeThisRail(vod.categoryId, vod.streamId, info?.genre ?? ''),
      ],
    }));
    this.settleDetailLayout();
    this.settleDetailFocus();
  }
}
