import type {
  Action,
  PlaylistEntry,
  ResumeEntry,
  ResumeKind,
  VodPlayback,
  WatchlistEntry,
  WatchlistKind,
} from '../types';
import { SpatialNav, isFocusMove } from '../navigation/spatial-nav';
import { Focus, type FocusScope, type Via } from '../navigation/focus-scope';
import { FocusRing, isHovered, ringShown } from '../navigation/focus-ring';
import { InputMode } from '../navigation/input-mode';
import type { NavWheelDetail } from '../navigation/key-handler';
import { html, raw, Safe, withInstantScroll } from '../utils/dom';
import { categoryLockBadge, lockBadge } from './parental-badge';
import { SORT_ASCENDING_ICON, SORT_DESCENDING_ICON, SEE_ALL_ICON, REMOVE_ICON, CHECK_ICON, TRASH_ICON, PENCIL_ICON, PLUS_ICON, STAR_ICON } from './icons';
import { ConfirmationPrompt } from './confirmation-prompt';
import { DetailTextOverlay } from './detail-text-overlay';
import { castGradient, castInitials, type CastMember } from '../utils/cast';
import { genreSet, rankMoreLikeThis } from '../utils/more-like-this';
import { tmdbProfileUrl, type TmdbPerson } from '../services/tmdb';
import { backKey, okHint } from './key-hints';
import { showToast } from './toast';
import { dropdown, toggleDropdown, closeDropdown, commitDropdownOption } from './dropdown';
import { morph } from '../utils/morph';
import { StorageService } from '../services/storage-service';
import {
  catalogParentalRequest,
  isResumeConcealed,
  isWatchlistConcealed,
  ParentalControlService,
} from '../services/parental-control';
import { CONFIG } from '../config';
import { getLocale, t, tp } from '../i18n';
import { VirtualGrid } from '../utils/virtual-grid';
import { VirtualList } from '../utils/virtual-list';
import { VirtualScrollGuard } from '../utils/virtual-scroll';
import { createLogger } from '../utils/logger';
import {
  defaultSortDirection, isCatalogSort, sortCatalogItems,
  type CatalogSort, type CatalogSortDirection, type CatalogSortItem, type CatalogSortPreference,
} from '../utils/catalog-sort';
import { uiPx } from '../utils/ui-scale';

const log = createLogger('Catalog');

const SORT_DIRECTION_LABELS = {
  name: { asc: 'catalog.sortAToZ', desc: 'catalog.sortZToA' },
  added: { asc: 'catalog.sortOldest', desc: 'catalog.sortNewest' },
  year: { asc: 'catalog.sortOldest', desc: 'catalog.sortNewest' },
  rating: { asc: 'catalog.sortLowest', desc: 'catalog.sortHighest' },
} as const;

function sortDirectionLabel(by: Exclude<CatalogSort, 'default'>, direction: CatalogSortDirection): string {
  return t(SORT_DIRECTION_LABELS[by][direction]);
}

// The field's starting direction leads, so Newest sits before Oldest.
function sortDirections(by: CatalogSort): CatalogSortDirection[] {
  return defaultSortDirection(by) === 'asc' ? ['asc', 'desc'] : ['desc', 'asc'];
}

const CATALOG_GRID_COLUMN_STRIDE = 244;
const CATALOG_GRID_POSTER_WIDTH = 220;
const CATALOG_GRID_ROW_STRIDE = 395;
const CATALOG_GRID_OVERSCAN_ROWS = 2;
const CATALOG_GRID_VIEWPORT_WIDTH = 1760;
const CATALOG_GRID_VIEWPORT_HEIGHT = 900;
const CATEGORY_RAIL_STRIDE = 320;
const CATEGORY_RAIL_VIEWPORT = 1760;
// Match .detail-body, .detail-poster-wrap, and the line boxes in
// catalog-view.css.
const DETAIL_BODY_TOP = 96;
const DETAIL_EDGE_PAD = 24;
const DETAIL_POSTER_TOP = 120;
const DETAIL_POSTER_HEIGHT = 450;
const DETAIL_POSTER_RIGHT = 120;
const DETAIL_BODY_WIDTH = 1040;
const DETAIL_COLUMN_GAP = 60;
const DETAIL_TITLE_LINES = 2;
const DETAIL_PLOT_LINES = 3;

// Matches the rail track's padding and its end spacer in catalog-view.css.
const RAIL_EDGE_GUTTER = 12;
// Match .catalog-hero-body's top and the title and plot line clamps in
// catalog-view.css.
const HERO_TITLE_ANCHOR = 0.32;
const HERO_TITLE_LINES = 2;
const HERO_PLOT_LINES = 3;

export interface CatalogHandlers {
  // Left at the browse's left edge.
  onBack: () => void;
  onPlayVod: (req: Omit<VodPlayback, 'onBack'>) => void;
}

type Mode = 'browse' | 'grid' | 'detail';

export type CollectionKind = 'continue' | 'watchlist';

export interface CollectionEntry {
  id: string;
  key: string;
  tile: (managing: boolean) => Safe;
}

interface GridSource {
  count: number;
  keyAt: (index: number) => string;
  render: (index: number) => Safe;
}

// What the browse hero shows: a catalog title, or a resumed episode, which
// carries only its own name and artwork.
interface HeroSubject<I> {
  key: string;
  name: string;
  poster: string;
  item: I | null;
}

// What a detail page shows. Every block keeps its place and size whether
// its text is there, short, long, or still loading.
export interface DetailPage {
  id: string;
  name: string;
  poster: string;
  backdrop: string;
  year: string;
  runtime: string;
  genre: string;
  rating: string;
  plot: string;
  actions: Safe;
  rows: Array<Safe | ''>;
}

export interface DetailAction {
  key: string;
  label: string;
  icon: string;
  primary?: boolean;
  progress?: number;
  pressed?: boolean;
}

export interface HeroDetails {
  genre?: string;
  year?: number;
  plot?: string;
  backdrop?: string;
}

interface BrowseReturn {
  el: HTMLElement;
  railKey: string;
  index: number;
}

// Tile keys repeat across rails (a resumed title is also in its category) and
// detail buttons across items, so a focus key names the mode and rail too.
interface CatalogKey {
  mode: Mode;
  rail: string;
  key: string;
}

function parseKey(key: string | null): CatalogKey | null {
  if (key === null) return null;
  try {
    const parts: unknown = JSON.parse(key);
    if (!Array.isArray(parts) || parts.length !== 3) return null;
    const [mode, rail, item] = parts as unknown[];
    if (mode !== 'browse' && mode !== 'grid' && mode !== 'detail') return null;
    if (typeof rail !== 'string' || typeof item !== 'string') return null;
    return { mode, rail, key: item };
  } catch {
    return null;
  }
}

function isScroller(overflow: string): boolean {
  return overflow === 'auto' || overflow === 'scroll';
}

// Shared browse/grid/detail machinery for the Xtream catalog sections (Movies,
// Series): a hero + poster rails browse view, a per-category poster grid, and a
// detail screen. One focus scope holds the focused tile or button across all
// modes, and a SpatialNav only picks the next one geometrically. Back walks
// detail -> grid -> browse -> the host, which goes Home.
// Each mode renders into its own stacked layer. Browse stays resident (hidden,
// not rebuilt) while a grid or detail is open, so Back finds its rails, scroll
// positions, and focused tile exactly as they were.
// Subclasses supply the catalog loaders, item accessors, and the detail
// rendering / playback specifics.
export abstract class CatalogView<C extends { id: string; name: string }, I extends CatalogSortItem> {
  protected nav: SpatialNav;
  protected account: PlaylistEntry | null = null;
  protected mode: Mode = 'browse';
  protected categories: C[] = [];
  protected railGroups: { category: C; items: I[] }[] = [];
  protected resume: ResumeEntry[] = [];
  protected itemsByCategory: Record<string, I[]> = {};
  private serverItemsByCategory: Record<string, I[]> = {};
  private sort: CatalogSortPreference = { by: 'default', direction: 'asc' };
  private resetBrowseRailOffsets = false;
  private hero: HeroSubject<I> | null = null;
  private heroTimer: ReturnType<typeof setTimeout> | null = null;
  private heroController: AbortController | null = null;
  private lastWheelStepAt = 0;
  private wheelTarget = 0;
  protected gridCategory: C | null = null;
  private collection: CollectionKind | null = null;
  private managing = false;
  private readonly clearPrompt: ConfirmationPrompt;
  protected deepLinkBack: (() => void) | null = null;
  private gridFocusIndex = 0;
  private gridReturnKey: string | null = null;
  // The browse tile that opened a grid or detail, refocused on Back.
  private readonly gridVirtualizer = new VirtualGrid({
    columnStride: () => uiPx(CATALOG_GRID_COLUMN_STRIDE),
    rowStride: () => uiPx(CATALOG_GRID_ROW_STRIDE),
    overscanRows: CATALOG_GRID_OVERSCAN_ROWS,
    fallbackViewportWidth: CATALOG_GRID_VIEWPORT_WIDTH,
    fallbackViewportHeight: CATALOG_GRID_VIEWPORT_HEIGHT,
  });
  private gridScrollFrame: number | null = null;
  private gridWindowStale = false;
  private readonly categoryVirtualizer = new VirtualList({
    itemSize: () => uiPx(CATEGORY_RAIL_STRIDE),
    overscan: 4,
    fallbackViewportSize: CATEGORY_RAIL_VIEWPORT,
  });
  private categoryScrollFrame: number | null = null;
  // The All categories window last rendered; its cells sit at fixed offsets,
  // so a scroll inside the window needs no render.
  private categoryWindow = '';
  protected readonly scrollGuard = new VirtualScrollGuard();
  private requestController: AbortController | null = null;
  private readonly layers: Record<Mode, HTMLElement>;
  private browseReturn: BrowseReturn | null = null;
  private gridRequest = 0;
  private browseStale = false;
  readonly focusScope: FocusScope;
  // How the element SpatialNav is picking was asked for; null only follows it.
  private pickVia: Via | null = null;
  private lastRevealKey: string | null = null;
  private lastRevealAt = 0;
  private lastRevealInstant = false;
  private readonly plotOverlay: DetailTextOverlay;
  private detailText: { title: string; text: string } | null = null;

  constructor(protected container: HTMLElement, protected handlers: CatalogHandlers) {
    const layer = (mode: Mode): HTMLElement => {
      const el = document.createElement('div');
      el.className = `catalog-layer catalog-layer-${mode}`;
      if (mode !== 'browse') el.classList.add('catalog-layer-hidden');
      container.appendChild(el);
      return el;
    };
    this.layers = { browse: layer('browse'), grid: layer('grid'), detail: layer('detail') };
    this.nav = new SpatialNav(container, (el) => this.onFocusChanged(el), { follow: false });
    this.nav.setRestrict(this.layers.browse);
    this.clearPrompt = new ConfirmationPrompt(`prompt.${this.scopeName()}.collection`);
    this.plotOverlay = new DetailTextOverlay(`prompt.${this.scopeName()}.plot`);
    this.focusScope = Focus.register({
      id: `${this.scopeName()}.catalog`,
      root: container,
      defaultKey: () => this.defaultKey(),
      resolve: (key) => this.resolveKey(key),
      has: (key) => this.hasKey(key),
      reveal: (key) => this.revealKey(key),
      concealOnLeave: true,
      // With the keys in a prompt nothing in the rails is focused, so the
      // hero goes back to the first title; it follows the focus once back.
      onRelease: () => this.syncHero(),
      onAcquire: () => this.syncHero(),
    });
    this.container.addEventListener('nav:wheel', (e: Event) => this.onWheel(e as CustomEvent<NavWheelDetail>));
    // The pointer lights a tile or button where it rests, without scrolling.
    this.container.addEventListener('nav:hover', (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.hasAttribute('data-focusable') || !this.layers[this.mode].contains(target)) return;
      const menu = this.openSortMenu();
      if (menu && !menu.contains(target)) return;
      this.place(target, 'pointer');
    });
    this.container.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.catalog-sort, [data-collection-manage], [data-collection-see-all], [data-collection-action]')) return;
      const el = target.closest<HTMLElement>('[data-focusable]');
      if (!el || !this.layers[this.mode].contains(el)) return;
      this.place(el, 'pointer');
      this.onSelect();
    });
    document.addEventListener('click', (e: MouseEvent) => {
      const menu = this.openSortMenu();
      if (menu && !menu.contains(e.target as Node)) this.dismissSort(null);
    }, true);
    // A ring the pointer left stays off; the next key only shows it again.
    this.container.addEventListener('nav:unhover', (e: Event) => {
      if (e.target === this.current()) this.focusScope.conceal();
    });
    this.container.addEventListener('scroll', (event: Event) => {
      const target = event.target as HTMLElement;
      if (this.handleExtraScroll(target)) return;
      if (this.mode === 'browse' && target.classList.contains('catalog-category-rail')) {
        const offset = this.scrollGuard.readUserOffset(target, 'horizontal');
        if (offset === null) return;
        this.categoryVirtualizer.setScrollOffset(offset);
        if (this.categoryScrollFrame === null) {
          this.categoryScrollFrame = requestAnimationFrame(() => {
            this.categoryScrollFrame = null;
            if (this.mode === 'browse') {
              const latest = this.scrollGuard.readUserOffset(target, 'horizontal');
              if (latest !== null) this.categoryVirtualizer.setScrollOffset(latest);
              if (this.categoryWindow !== this.categoryWindowFor(target.clientWidth)) {
                this.renderBrowse(false);
              }
            }
          });
        }
        return;
      }
      if (this.mode !== 'grid' || !target.classList.contains('catalog-grid')) return;
      const scrollTop = this.scrollGuard.readUserOffset(target, 'vertical');
      if (scrollTop === null) return;
      const track = this.layers.grid.querySelector<HTMLElement>('.catalog-grid-track');
      this.gridVirtualizer.setScrollOffset(
        Math.max(0, scrollTop - this.gridTrackStart(target, track)),
      );
      if (this.gridScrollFrame !== null) return;
      this.gridScrollFrame = requestAnimationFrame(() => {
        this.gridScrollFrame = null;
        if (this.mode !== 'grid') return;
        // A render would close the open sort menu (revealing its trigger
        // scrolls the grid); the window catches up once the menu closes.
        if (this.openSortMenu()) this.gridWindowStale = true;
        else this.renderGrid(false, true);
      });
    }, true);
  }

  // --- subclass configuration ---
  // The focus scope's prefix, e.g. 'movies'; a method, as the constructor reads it.
  protected abstract scopeName(): string;
  protected abstract readonly kicker: string;             // hero/grid label, e.g. 'Movies'
  protected abstract readonly resumeKind: ResumeKind;     // which resume entries this section owns
  protected abstract readonly emptyMessage: string;       // no catalog on the account
  protected abstract readonly gridEmptyMessage: string;   // empty category grid
  protected abstract loadCategories(
    account: PlaylistEntry,
    signal: AbortSignal,
  ): Promise<C[]>;
  protected abstract loadItems(
    account: PlaylistEntry,
    categoryId: string,
    signal: AbortSignal,
  ): Promise<I[]>;
  protected abstract itemId(item: I): string;
  protected abstract itemName(item: I): string;
  protected abstract itemPoster(item: I): string;
  protected abstract itemCategoryId(item: I): string;
  protected abstract itemCount(count: number): string;
  protected abstract readonly parentalKind: 'vod' | 'series';
  protected abstract openDetail(item: I): Promise<void>;
  protected abstract renderDetail(restoreFocus?: boolean): void;
  protected abstract clearDetail(): void;                 // drop detail state on deep-link back
  // Section-specific selects (play/resume/season/episode). Returns true if handled.
  protected abstract selectExtra(el: HTMLElement): boolean;
  protected moveExtraFocus(_action: Action): boolean { return false; }
  // A detail key the subclass virtualizes: whether it is still listed, and
  // bringing it into view (true when that scrolled, null when nothing had to).
  protected hasExtraKey(_key: string): boolean { return false; }
  protected revealExtraKey(_key: string, _instant: boolean): boolean | null | undefined {
    return undefined;
  }
  protected handleExtraScroll(_target: HTMLElement): boolean { return false; }
  protected onRequestSessionReset(): void {}
  protected abstract collectionEntries(kind: CollectionKind): CollectionEntry[];
  // A tile id that isn't in a loaded category (Continue/Watchlist); default none.
  protected fallbackItem(_id: string): I | null { return null; }
  // Hero when no rail item exists (Movies falls back to a resumed item); default none.
  protected heroFallback(): I | null { return null; }
  // What the hero can show for a title right away.
  protected heroDetails(_item: I): HeroDetails { return {}; }
  // Details the hero still has to ask the provider for, once focus rests.
  protected heroDetailsPending(_item: I): boolean { return false; }
  protected loadHeroDetails(_item: I, _signal: AbortSignal): Promise<void> { return Promise.resolve(); }

  // The active mode's layer; hidden layers keep their DOM but never take focus.
  protected layer(mode: Mode = this.mode): HTMLElement {
    return this.layers[mode];
  }

  protected showLayer(mode: Mode): void {
    if (mode !== this.mode) this.dismissSort(null);
    if (this.mode === 'browse' && mode !== 'browse') {
      this.leaveBrowse();
      this.cancelHeroDetails();
    }
    this.mode = mode;
    (Object.keys(this.layers) as Mode[]).forEach((key) => {
      this.layers[key].classList.toggle('catalog-layer-hidden', key !== mode);
    });
    this.nav.setRestrict(this.layers[mode]);
  }

  // Keys embed provider ids, so compare rather than build a selector from them.
  protected focusableByKey(root: HTMLElement, key: string): HTMLElement | null {
    return Array.from(root.querySelectorAll<HTMLElement>('[data-focusable][data-key]'))
      .find((el) => el.getAttribute('data-key') === key) ?? null;
  }

  protected clearLayer(mode: Mode): void {
    if (mode === 'grid') this.gridReturnKey = null;
    morph(this.layers[mode], html``);
  }

  // Detail entry for subclasses: remembers where browse focus was first.
  protected enterDetail(): void {
    if (this.mode === 'grid') this.gridReturnKey = this.focusedKey();
    this.showLayer('detail');
    // A new item's detail starts on its first button.
    this.focusScope.track(null);
  }

  // --- focus ---

  private keyFor(el: HTMLElement): string {
    const rail = el.closest<HTMLElement>('[data-rail-key]')?.dataset.railKey ?? '';
    return JSON.stringify([this.mode, rail, el.getAttribute('data-key') ?? '']);
  }

  // The focused item's own data-key, while the focus belongs to the shown mode.
  protected focusedKey(): string | null {
    const parsed = parseKey(this.focusScope.focusKey);
    return parsed && parsed.mode === this.mode ? parsed.key : null;
  }

  // The element that holds the focus, if it is rendered in the shown mode.
  protected current(): HTMLElement | null {
    const key = this.focusScope.focusKey;
    return key === null ? null : this.resolveKey(key);
  }

  private resolveKey(key: string): HTMLElement | null {
    const parsed = parseKey(key);
    if (!parsed || parsed.mode !== this.mode) return null;
    const layer = this.layers[parsed.mode];
    const rail = parsed.rail
      ? Array.from(layer.querySelectorAll<HTMLElement>('[data-rail-key]'))
        .find((el) => el.dataset.railKey === parsed.rail) ?? null
      : layer;
    return rail ? this.focusableByKey(rail, parsed.key) : null;
  }

  private defaultKey(): string | null {
    const first = this.firstTarget();
    return first ? this.keyFor(first) : null;
  }

  // A detail starts on its first action (Play or Resume), not on the
  // description above it.
  private firstTarget(): HTMLElement | null {
    const actions = this.mode === 'detail'
      ? this.layers.detail.querySelector<HTMLElement>('.detail-actions') : null;
    if (actions) {
      this.nav.setRestrict(actions);
      const action = this.nav.first();
      this.nav.setRestrict(this.layers.detail);
      if (action) return action;
    }
    return this.nav.first();
  }

  // Keys the virtualized grid, category rail, or episode list may not render.
  private hasKey(key: string): boolean {
    const parsed = parseKey(key);
    if (!parsed || parsed.mode !== this.mode) return false;
    if (parsed.mode === 'grid') return this.gridIndexOf(parsed.key) >= 0;
    if (parsed.mode === 'browse') {
      return parsed.rail === 'all-categories' && this.categoryIndexOf(parsed.key) >= 0;
    }
    return this.hasExtraKey(parsed.key);
  }

  private gridIndexOf(key: string): number {
    const source = this.gridSource();
    for (let index = 0; index < source.count; index++) {
      if (source.keyAt(index) === key) return index;
    }
    return -1;
  }

  private gridSource(): GridSource {
    if (this.collection) {
      const entries = this.collectionEntries(this.collection);
      return {
        count: entries.length,
        keyAt: index => entries[index].key,
        render: index => entries[index].tile(this.managing),
      };
    }
    const cat = this.gridCategory;
    const items = cat ? (this.itemsByCategory[cat.id] ?? []) : [];
    return {
      count: items.length,
      keyAt: index => `i:${this.itemCategoryId(items[index])}:${this.itemId(items[index])}`,
      render: index => this.tile(items[index]),
    };
  }

  private categoryIndexOf(key: string): number {
    return this.categories.findIndex((c) => `c:${c.id}` === key);
  }

  // Keeps the focus in view; a virtualized list scrolls its window first.
  private revealKey(key: string): boolean | null {
    const parsed = parseKey(key);
    if (!parsed || parsed.mode !== this.mode) return null;
    const now = Date.now();
    if (key !== this.lastRevealKey) {
      // A held key steps instantly, so the focus never outruns its scroll.
      this.lastRevealInstant = this.lastRevealAt !== 0
        && now - this.lastRevealAt <= CONFIG.NAVIGATION.FOCUS_REPEAT_WINDOW_MS;
      this.lastRevealKey = key;
      this.lastRevealAt = now;
    } else if (now - this.lastRevealAt > CONFIG.NAVIGATION.FOCUS_REPEAT_WINDOW_MS) {
      // A later input that only reveals the same key scrolls smoothly again.
      this.lastRevealInstant = false;
    }
    const instant = this.lastRevealInstant;
    let scrolled = false;
    // The grid's window owns its scroll offset; it alone brings a cell in.
    if (parsed.mode === 'grid' && this.gridIndexOf(parsed.key) >= 0) {
      return this.revealGridIndex(this.gridIndexOf(parsed.key)) ? true : null;
    }
    if (parsed.mode === 'browse') {
      if (parsed.rail === 'all-categories') {
        scrolled = this.revealCategoryIndex(this.categoryIndexOf(parsed.key));
      }
      const el = this.resolveKey(key);
      if (!el) return scrolled ? true : null;
      if (this.revealRailGutter(el, instant)) scrolled = true;
      if (this.snapRail(el, instant)) scrolled = true;
      return scrolled ? true : null;
    }
    if (parsed.mode === 'detail') {
      // A virtualized episode renders before it is placed; the rails then
      // snap to its row like the browse rails do.
      const extra = this.revealExtraKey(parsed.key, instant);
      if (extra === true) scrolled = true;
      const el = this.resolveKey(key);
      if (!el) return scrolled ? true : null;
      if (extra === undefined && this.revealRailGutter(el, instant)) scrolled = true;
      if (this.snapRail(el, instant)) scrolled = true;
      return scrolled ? true : null;
    }
    const el = this.resolveKey(key);
    if (el && this.revealElement(el, instant)) scrolled = true;
    return scrolled ? true : null;
  }

  // Compares against the window's recorded offset, not the live scrollTop,
  // which lags a smooth scroll the last step started. Past the scroll
  // guard's two frames, the rest of that scroll reads as a user scroll and
  // moves the recorded offset with it.
  private revealGridIndex(index: number): boolean {
    if (index < 0) return false;
    this.gridFocusIndex = index;
    const view = this.layers.grid.querySelector<HTMLElement>('.catalog-grid');
    const track = this.layers.grid.querySelector<HTMLElement>('.catalog-grid-track');
    if (!this.gridVirtualizer.ensureVisible(
      index,
      track?.clientWidth || CATALOG_GRID_VIEWPORT_WIDTH,
      view?.clientHeight || CATALOG_GRID_VIEWPORT_HEIGHT,
    )) return false;
    this.renderGrid(false);
    return true;
  }

  private revealCategoryIndex(index: number): boolean {
    if (index < 0) return false;
    const rail = this.layers.browse.querySelector<HTMLElement>('.catalog-category-rail');
    if (!this.categoryVirtualizer.ensureVisible(index, this.categoryRailContentWidth(rail))) {
      return false;
    }
    this.renderBrowse(false);
    return true;
  }

  // Scrolls each scroller around `el` just enough to show it whole; a rail
  // tile also keeps a gutter beside it. True when anything scrolled.
  private revealElement(el: HTMLElement, instant: boolean): boolean {
    const r = el.getBoundingClientRect();
    let scrolled = false;
    for (let n = el.parentElement; n && n !== this.container; n = n.parentElement) {
      const style = getComputedStyle(n);
      if (n === el.parentElement && n.classList.contains('catalog-rail-track')) {
        if (this.revealRailGutter(el, instant)) scrolled = true;
      }
      if (!isScroller(style.overflowY) || n.scrollHeight <= n.clientHeight) continue;
      const box = n.getBoundingClientRect();
      const top = box.top + n.clientTop;
      const bottom = top + n.clientHeight;
      let delta = 0;
      if (r.top < top) delta = r.top - top;
      else if (r.bottom > bottom) delta = Math.min(r.bottom - bottom, r.top - top);
      if (Math.abs(delta) < 1) continue;
      const target = n.scrollTop + delta;
      const scroller = n;
      if (instant) withInstantScroll([scroller], () => { scroller.scrollTop = target; });
      else scroller.scrollTop = target;
      scrolled = true;
    }
    return scrolled;
  }

  // Follows the element SpatialNav picked into the focus scope.
  protected place(el: HTMLElement | null, via: Via | null): void {
    this.pick(via, () => this.nav.focus(el));
  }

  private pick(via: Via | null, fn: () => void): void {
    const outer = this.pickVia;
    this.pickVia = via;
    try {
      fn();
    } finally {
      this.pickVia = outer;
    }
  }

  // How a render that settles focus on its own asks for it: in keys mode it
  // may bring it into view, otherwise it lights it where it is. Under a
  // surface that owns the keys it only follows the focus.
  private placementVia(): Via | null {
    if (Focus.owner() !== this.focusScope) return null;
    return InputMode.current === 'keys' ? 'key' : 'pointer';
  }

  // A focus request reaches the scope only while it owns the keys; otherwise
  // the scope just follows it, so no reveal waits for later.
  private request(key: string | null, via: Via | null): void {
    // A pointer request never reveals, so it may wait for the keys.
    if (via === 'pointer' && Focus.owner() !== this.focusScope) {
      this.focusScope.focus(key, via);
      return;
    }
    if (via === null || Focus.owner() !== this.focusScope) {
      this.focusScope.track(key);
      return;
    }
    this.focusScope.focus(key, via);
    Focus.flush();
  }

  // Detail info lands, or a button changes: keep a key that is still there,
  // else start on the first button. A button that vanished only moves the
  // key, so a ring the pointer hid stays hidden.
  protected settleDetailFocus(): void {
    if (this.current()) return;
    this.pick(this.focusScope.focusKey === null ? this.placementVia() : null, () => {
      this.nav.focus(this.firstTarget());
    });
  }

  // SpatialNav picks from where the scope's focus is, which a fallback may have moved.
  private syncNav(): void {
    const el = this.current();
    if (el && el !== this.nav.focused) this.place(el, null);
  }

  // After the pointer left, the first key only shows where focus is.
  private ringHidden(): boolean {
    const el = this.current();
    return !!el && Focus.owner() === this.focusScope && !FocusRing.deferred && !ringShown(el);
  }

  private leaveBrowse(): void {
    const el = this.current();
    if (!el || !this.layers.browse.contains(el)) return;
    const rail = el.closest<HTMLElement>('[data-rail-key]');
    const tiles = rail
      ? Array.from(rail.querySelectorAll<HTMLElement>('[data-focusable]'))
      : [];
    this.browseReturn = {
      el,
      railKey: rail?.dataset.railKey ?? '',
      index: Math.max(0, tiles.indexOf(el)),
    };
  }

  // Back lands on the tile browse was left from. A tile that is gone (e.g. a
  // title removed from the Watchlist) hands focus to its neighbor in the same
  // rail, and a rail that is gone falls back to the first tile.
  private restoreBrowseFocus(): void {
    const origin = this.browseReturn;
    this.browseReturn = null;
    const browse = this.layers.browse;
    const via = this.placementVia();
    if (origin && origin.el.isConnected && browse.contains(origin.el)) {
      this.place(origin.el, via);
      return;
    }
    // Rail keys embed provider category ids, so compare rather than build a selector.
    const rail = origin?.railKey
      ? Array.from(browse.querySelectorAll<HTMLElement>('[data-rail-key]'))
        .find((el) => el.dataset.railKey === origin.railKey) ?? null
      : null;
    const tiles = rail
      ? Array.from(rail.querySelectorAll<HTMLElement>('[data-focusable]'))
      : [];
    if (origin && tiles.length) {
      this.place(tiles[Math.min(origin.index, tiles.length - 1)], via);
      return;
    }
    this.place(browse.querySelector<HTMLElement>('.catalog-tile[data-focusable]') ?? this.nav.first(), via);
  }

  setAccount(account: PlaylistEntry): void {
    if (this.account?.id !== account.id) {
      this.clearPrompt.hide();
      this.dismissSort(null);
      this.cancelHeroDetails();
      this.requestController?.abort();
      this.onRequestSessionReset();
      this.nav.resetRecovery();
    }
    this.account = account;
  }

  protected get requestSignal(): AbortSignal | null {
    return this.requestController?.signal ?? null;
  }

  protected requestFailed(context: string, err: unknown, signal: AbortSignal): boolean {
    if (signal.aborted) return false;
    log.error(
      `${context} failed`,
      'event=xtream.view.load.failed',
      `operation=${context.toLowerCase().replace(/\s+/g, '_')}`,
      err,
    );
    return true;
  }

  private beginRequests(): AbortSignal {
    this.cancelHeroDetails();
    this.requestController?.abort();
    this.onRequestSessionReset();
    this.requestController = new AbortController();
    return this.requestController.signal;
  }

  refreshPlaybackState(): void {
    if (this.mode === 'detail') this.renderDetail();
    else if (this.mode === 'grid') this.renderGrid();
    else {
      this.leaveBrowse();
      this.renderBrowse();
    }
  }

  deactivate(): void {
    this.cancelHeroDetails();
    this.clearPrompt.hide();
    this.plotOverlay.hide();
    this.dismissSort(null);
    this.requestController?.abort();
    this.requestController = null;
    this.onRequestSessionReset();
  }

  async open(account: PlaylistEntry): Promise<void> {
    this.clearPrompt.hide();
    this.collection = null;
    this.managing = false;
    this.dismissSort(null);
    const signal = this.beginRequests();
    this.account = account;
    this.deepLinkBack = null;
    this.browseReturn = null;
    this.browseStale = false;
    this.clearLayer('grid');
    this.clearLayer('detail');
    this.categories = [];
    this.railGroups = [];
    this.itemsByCategory = {};
    this.serverItemsByCategory = {};
    this.sort = StorageService.getCatalogSort(this.parentalKind);
    this.resetBrowseRailOffsets = false;
    this.hero = null;
    this.gridCategory = null;
    this.categoryVirtualizer.setScrollOffset(0);
    this.gridVirtualizer.setScrollOffset(0);
    this.resume = this.visibleResume(account.id);
    this.clearLayer('browse');
    this.renderLoading('browse');
    try {
      const categories = await this.loadCategories(account, signal);
      if (signal.aborted || this.account?.id !== account.id) return;
      this.categories = categories.filter(category => !ParentalControlService.isCategoryConcealed({
        kind: this.parentalKind === 'vod' ? 'vod-category' : 'series-category',
        accountId: account.id,
        categoryId: category.id,
      }));
      const railCats = this.categories.slice(0, CONFIG.XTREAM.RAIL_CATEGORIES);
      // Settle each rail on its own: one failing category must not blank the rest.
      const loaded = await Promise.all(
        railCats.map((c) => this.loadVisibleItems(account, c.id, signal).then(
          (items): I[] | null => items,
          (err: unknown): null => {
            if (!signal.aborted) {
              log.error(
                'Catalog rail load failed',
                'event=xtream.view.load.failed',
                'operation=rail',
                `mode=${this.parentalKind}`,
                err,
              );
            }
            return null;
          },
        )),
      );
      if (signal.aborted || this.account?.id !== account.id) return;
      const groups: { category: C; items: I[] }[] = [];
      railCats.forEach((category, i) => {
        const items = loaded[i];
        if (!items) return;
        this.setCategoryItems(category.id, items);
        groups.push({ category, items: this.itemsByCategory[category.id].slice(0, CONFIG.XTREAM.RAIL_ITEMS) });
      });
      this.railGroups = groups;
      if (groups.length < railCats.length) {
        log.warn(
          'Catalog rails partially loaded',
          'event=xtream.view.rails.partial',
          `mode=${this.parentalKind}`,
          `kept=${String(groups.length)}`,
          `total=${String(railCats.length)}`,
        );
      }
      this.renderBrowse();
    } catch (err) {
      if (signal.aborted) return;
      log.error(
        'Catalog browse load failed',
        'event=xtream.view.load.failed',
        'operation=browse',
        err,
      );
      if (this.account?.id === account.id) this.renderBrowse();
    }
  }

  // Deep-link entry (from Search): open this item's detail directly. Back returns
  // to the caller via onDetailBack (no browse is loaded underneath).
  async openItem(account: PlaylistEntry, item: I, onDetailBack: () => void): Promise<void> {
    this.beginRequests();
    // Showing this detail; deep-link Back recomputes whether browse is stale.
    this.browseStale = false;
    if (this.account && this.account.id !== account.id
        && this.layers.browse.querySelector('.catalog-view')) {
      this.gridCategory = null;
      this.collection = null;
      this.managing = false;
      this.browseReturn = null;
      this.clearLayer('grid');
      morph(this.layers.browse, this.loadingMarkup());
    }
    this.account = account;
    this.deepLinkBack = onDetailBack;
    await this.openDetail(item);
  }

  // A Search deep link opens over whatever this section last showed. Put that
  // back, so showing the section again never lands on an empty detail layer.
  // A detail the deep link replaced is not restored: Back skips to its grid or
  // browse.
  private restoreBeneathDeepLink(): void {
    if ((this.gridCategory || this.collection) && this.layers.grid.querySelector('.catalog-grid')) {
      this.renderGrid();
      return;
    }
    this.gridCategory = null;
    this.clearLayer('grid');
    if (this.layers.browse.querySelector('.catalog-browse')) {
      this.renderBrowse();
      return;
    }
    // The deep link aborted a browse load (or switched accounts). Reload it
    // only if the section is shown again (ensureLoaded), not behind Search.
    this.browseStale = !!this.layers.browse.querySelector('.catalog-loading');
    this.showLayer('browse');
    // Nothing to land on until browse loads; the detail's key is gone.
    if (parseKey(this.focusScope.focusKey)?.mode !== 'browse') this.focusScope.track(null);
  }

  // For re-showing the section without open(), e.g. when Search closes: reload
  // an interrupted browse, or one left on an account no longer active.
  ensureLoaded(account: PlaylistEntry | null): void {
    if (!account) return;
    if (!this.browseStale && this.account?.id === account.id) return;
    log.debug(
      'Catalog browse reloading',
      'event=xtream.view.reload',
      'operation=browse',
      `mode=${this.parentalKind}`,
      `reason=${this.browseStale ? 'stale' : 'account'}`,
    );
    void this.open(account);
  }

  // Search is closing over this section: drop a deep-linked detail it left
  // here and show what it opened over.
  leaveDeepLink(): void {
    if (!this.deepLinkBack) return;
    this.beginRequests();
    this.deepLinkBack = null;
    this.clearDetail();
    this.restoreBeneathDeepLink();
    this.clearLayer('detail');
  }

  handleAction(action: Action): void {
    this.syncNav();
    if ((isFocusMove(action) || (action === 'select' && this.openSortMenu())) && this.ringHidden()) {
      this.request(this.focusScope.focusKey, 'key');
      return;
    }
    this.pickVia = 'key';
    try {
      this.route(action);
    } finally {
      this.pickVia = null;
    }
  }

  private route(action: Action): void {
    const menu = this.openSortMenu();
    if (menu) {
      if (action === 'back' || action === 'left') this.dismissSort('key');
      else if (action === 'select') this.onSelect();
      else if (action === 'up' || action === 'down') this.nav.move(action);
      return;
    }
    const current = this.current();
    const sortRow = current?.closest<HTMLElement>('.catalog-sort, .catalog-collection-actions');
    const horizontalRegion = sortRow ?? (this.mode !== 'grid'
      ? current?.closest<HTMLElement>('.catalog-rail-track:not(.catalog-category-rail):not(.episode-track), .series-seasons') : null);
    if (horizontalRegion && (action === 'left' || action === 'right')) {
      this.nav.setRestrict(horizontalRegion);
      this.nav.move(action);
      this.nav.setRestrict(this.layers[this.mode]);
      return;
    }
    if (sortRow && action === 'down' && this.mode === 'grid') {
      this.revealGridIndex(this.gridFocusIndex);
      const target = this.layers.grid.querySelector<HTMLElement>(
        `[data-grid-index="${this.gridFocusIndex}"] [data-focusable]`,
      );
      if (target) {
        this.place(target, 'key');
        return;
      }
    }
    if (this.moveExtraFocus(action)) return;
    if (this.mode === 'detail' && (action === 'up' || action === 'down')
        && this.moveDetailLine(action)) return;
    if (this.mode === 'browse' && (action === 'left' || action === 'right')
        && this.moveCategoryFocus(action)) return;
    if (this.mode === 'grid'
        && (action === 'up' || action === 'down' || action === 'left' || action === 'right')) {
      if (this.current()?.closest('.catalog-sort, .catalog-collection-actions')) {
        this.nav.move(action);
        return;
      }
      if (this.moveGridFocus(action)) return;
      if (action === 'up') this.nav.move('up');
      return;
    }
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.nav.move(action);
        return;
      case 'select':
        this.onSelect();
        return;
      case 'back':
        this.onBack();
        return;
      default:
        return;
    }
  }

  private onBack(): void {
    if (this.mode === 'detail') {
      this.clearDetail();
      if (this.deepLinkBack) {
        const back = this.deepLinkBack;
        this.deepLinkBack = null;
        this.restoreBeneathDeepLink();
        this.clearLayer('detail');
        back();
        return;
      }
      this.gridCategory || this.collection ? this.renderGrid() : this.renderBrowse();
      this.clearLayer('detail');
      return;
    }
    if (this.mode === 'grid') {
      if (this.managing) {
        this.setManaging(false);
        return;
      }
      this.gridCategory = null;
      this.collection = null;
      this.renderBrowse();
      this.clearLayer('grid');
      return;
    }
    this.handlers.onBack();
  }

  private onSelect(): void {
    const el = this.current();
    if (!el || !this.account) return;
    if (el.closest('.catalog-sort')) {
      const direction = el.dataset.sortDirection;
      if (direction === 'asc' || direction === 'desc') {
        this.applySort({
          by: this.sort.by,
          direction,
        }, direction);
        return;
      }
      const dd = el.closest<HTMLElement>('.dropdown');
      if (el.hasAttribute('data-dropdown-trigger') && dd) {
        if (this.openSortMenu()) this.dismissSort(this.placementVia());
        else {
          this.nav.setRestrict(dd.querySelector<HTMLElement>('.dropdown-menu'));
          this.pick(this.placementVia(), () => toggleDropdown(this.container, this.nav, dd));
        }
      } else if (isCatalogSort(el.dataset.dropdownValue)) {
        const value = el.dataset.dropdownValue;
        commitDropdownOption(el);
        this.nav.setRestrict(this.layers[this.mode]);
        this.applySort(value === this.sort.by
          ? this.sort : { by: value, direction: defaultSortDirection(value) });
      }
      return;
    }
    if (this.selectCollection(el)) return;
    if (el.dataset.categoryId !== undefined
        && (el.classList.contains('catalog-cat') || el.classList.contains('catalog-see-all'))) {
      void this.openGrid(el.dataset.categoryId);
      return;
    }
    if (el.dataset.action === 'plot') {
      this.openPlot();
      return;
    }
    if (this.selectExtra(el)) return;
    if (el.dataset.itemId !== undefined) {
      const item = this.findItem(el.dataset.categoryId ?? '', el.dataset.itemId);
      if (item) void this.openDetail(item);
    }
  }

  private selectCollection(el: HTMLElement): boolean {
    const manage = el.dataset.collectionManage;
    const seeAll = el.dataset.collectionSeeAll;
    const kind = manage ?? seeAll;
    if (kind === 'continue' || kind === 'watchlist') {
      this.gridCategory = null;
      this.collection = kind;
      this.managing = manage !== undefined;
      this.gridRequest++;
      this.clearLayer('grid');
      this.gridFocusIndex = 0;
      this.gridVirtualizer.setScrollOffset(0);
      this.renderGrid();
      return true;
    }
    const action = el.dataset.collectionAction;
    if (!this.collection || this.mode !== 'grid') return false;
    if (action === 'manage' || action === 'done') {
      this.setManaging(action === 'manage');
      return true;
    }
    if (action === 'clear') {
      this.confirmClear();
      return true;
    }
    const cell = el.closest<HTMLElement>('[data-grid-index]');
    if (this.managing && action === 'remove' && cell) {
      const index = Number(cell.dataset.gridIndex);
      const entries = this.collectionEntries(this.collection);
      const entry = entries[index];
      if (!entry) return true;
      this.removeCollectionEntry(this.collection, entry.id);
      if (entries.length === 1) {
        this.leaveCollection();
        return true;
      }
      this.gridFocusIndex = Math.min(index, entries.length - 2);
      this.renderGrid(false);
      this.revealGridIndex(this.gridFocusIndex);
      this.place(this.layers.grid.querySelector<HTMLElement>(
        `[data-grid-index="${this.gridFocusIndex}"] [data-focusable]`,
      ), this.placementVia());
      return true;
    }
    return false;
  }

  private removeCollectionEntry(kind: CollectionKind, id: string): void {
    const account = this.account;
    if (!account) return;
    if (kind === 'continue') {
      StorageService.clearResume(account.id, this.resumeKind, id);
      this.resume = this.visibleResume(account.id);
    } else {
      StorageService.removeWatchlist(account.id, this.parentalKind, id);
    }
  }

  private setManaging(managing: boolean): void {
    if (!this.collection) return;
    this.managing = managing;
    this.renderGrid(false);
    this.place(this.layers.grid.querySelector<HTMLElement>(managing
      ? `[data-grid-index="${this.gridFocusIndex}"] [data-focusable]`
      : '[data-collection-action="manage"]'), this.placementVia());
  }

  private leaveCollection(): void {
    this.collection = null;
    this.managing = false;
    this.renderBrowse();
    this.clearLayer('grid');
  }

  private confirmClear(): void {
    const kind = this.collection;
    const account = this.account;
    const returnKey = this.focusScope.focusKey;
    if (!kind || !account) return;
    this.clearPrompt.show({
      title: t(kind === 'continue' ? 'catalog.clearContinueWatchingTitle' : 'settings.clearWatchlistTitle'),
      message: t(kind === 'continue' ? 'catalog.clearContinueWatchingMessage' : 'catalog.clearWatchlistMessage', {
        account: account.name, section: this.kicker,
      }),
      confirmLabel: t('common.clearAll'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        if (this.account?.id !== account.id || this.collection !== kind) return;
        // Only the visible list is cleared; concealed titles stay untouched.
        this.collectionEntries(kind).forEach(entry => this.removeCollectionEntry(kind, entry.id));
        this.leaveCollection();
        showToast(t(kind === 'continue' ? 'catalog.continueWatchingCleared' : 'catalog.watchlistCleared'));
      },
      onCancel: () => {
        if (InputMode.current === 'keys') this.request(returnKey, 'back');
      },
    });
  }

  private collectionTitle(kind: CollectionKind): string {
    return t(kind === 'continue' ? 'catalog.continueWatching' : 'common.watchlist');
  }

  private collectionCount(kind: CollectionKind, count: number): string {
    return kind === 'continue' && this.resumeKind === 'episode'
      ? tp('catalog.episodeCount', count) : this.itemCount(count);
  }

  private collectionRail(kind: CollectionKind): Safe | '' {
    const entries = this.collectionEntries(kind);
    if (!entries.length) return '';
    return html`
      <div class="catalog-rail" data-key="rail:${kind}" data-rail-key="${kind}">
        <div class="catalog-rail-head">
          <h2 class="catalog-rail-title">${this.collectionTitle(kind)}</h2>
          <button class="btn catalog-collection-button catalog-collection-manage" type="button"
                  data-self-activate data-focusable data-key="manage:${kind}" data-collection-manage="${kind}">
            <span class="catalog-action-icon">${raw(PENCIL_ICON)}</span>
            <span>${t('parental.manage')}</span>
          </button>
        </div>
        <div class="catalog-rail-track" data-edge-scroll>
          ${entries.slice(0, CONFIG.XTREAM.RAIL_ITEMS).map(entry => entry.tile(false))}
          ${entries.length > CONFIG.XTREAM.RAIL_ITEMS ? html`
            <div class="catalog-tile catalog-see-all" data-self-activate data-focusable
                 data-key="all:${kind}" data-collection-see-all="${kind}">
              <div class="catalog-poster-wrap catalog-see-all-card">
                ${raw(SEE_ALL_ICON)}
                <div class="catalog-see-all-label">${t('catalog.seeAll')}</div>
                <div class="catalog-see-all-count">${this.collectionCount(kind, entries.length)}</div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  protected removeMark(managing: boolean, key: string): Safe | '' {
    return managing ? html`
      <button class="catalog-remove-mark" type="button" data-self-activate data-focusable data-key="${key}"
              data-collection-action="remove" aria-label="${t('common.remove')}">${raw(REMOVE_ICON)}</button>
    ` : '';
  }

  protected progressBar(position: number, duration: number): Safe | '' {
    if (duration <= 0) return '';
    const percent = Math.max(2, Math.min(100, Math.round(position / duration * 100)));
    return html`<div class="catalog-progress"><div class="catalog-progress-fill" style="width:${percent}%"></div></div>`;
  }

  // SpatialNav picked `el`: hand it to the scope, and keep the browse hero
  // (title + backdrop) in sync with the focused item tile. Category tiles and
  // non-browse modes leave the hero unchanged.
  private onFocusChanged(el: HTMLElement | null): void {
    this.request(el ? this.keyFor(el) : null, this.pickVia);
    const gridCell = el?.closest<HTMLElement>('[data-grid-index]');
    if (this.mode === 'grid' && gridCell?.dataset.gridIndex !== undefined) {
      this.gridFocusIndex = parseInt(gridCell.dataset.gridIndex, 10);
      return;
    }
    const categoryCell = el?.closest<HTMLElement>('[data-category-virtual-index]');
    if (this.mode === 'browse' && categoryCell) return;
    if (this.mode !== 'browse' || !el) return;
    const subject = this.heroSubjectFor(el);
    if (subject) this.showHero(subject);
  }

  // A tile flush with the rail's scrollport would clip its focus ring; keep a
  // gutter visible beside it. True when the rail scrolled.
  private revealRailGutter(el: HTMLElement, instant: boolean): boolean {
    const track = el.parentElement;
    if (!track || !track.classList.contains('catalog-rail-track')) return false;
    // The tile's box at rest: the focus lift scales it about its center,
    // mid-transition on a key press, and the track's padding leaves room
    // for it.
    const rect = el.getBoundingClientRect();
    const start = rect.left + (rect.width - el.offsetWidth) / 2
      - track.getBoundingClientRect().left - track.clientLeft + track.scrollLeft;
    const end = start + el.offsetWidth;
    const current = track.scrollLeft;
    // A tile leaving on the left lines up with the rail's keyline, not the
    // screen edge the track bleeds to.
    const style = getComputedStyle(track);
    const lead = Math.max(RAIL_EDGE_GUTTER, parseFloat(style.paddingLeft) || 0);
    const trail = Math.max(RAIL_EDGE_GUTTER, parseFloat(style.paddingRight) || 0);
    let target: number;
    if (start - lead < current) target = Math.max(0, start - lead);
    else if (end + trail > current + track.clientWidth) {
      target = end + trail - track.clientWidth;
    } else return false;
    if (Math.abs(target - current) < 1) return false;
    // A tile already in view only needs an instant nudge; otherwise retarget
    // the running smooth scroll so it moves once.
    if (instant || (start >= current && end <= current + track.clientWidth)) {
      withInstantScroll([track], () => { track.scrollLeft = target; });
    } else {
      track.scrollLeft = target;
    }
    return true;
  }

  // --- browse hero ---

  private heroSubjectFor(el: HTMLElement): HeroSubject<I> | null {
    if (el.dataset.resumeEpisode !== undefined) {
      const entry = this.resume.find(entry => entry.itemId === el.dataset.resumeEpisode);
      return entry ? { key: `r:${entry.itemId}`, name: entry.name, poster: entry.poster, item: null } : null;
    }
    const id = el.dataset.itemId;
    if (id === undefined) return null;
    const item = this.findItem(el.dataset.categoryId ?? '', id);
    return item ? this.itemSubject(item) : null;
  }

  private itemSubject(item: I): HeroSubject<I> {
    return { key: `i:${this.itemId(item)}`, name: this.itemName(item), poster: this.itemPoster(item), item };
  }

  // The first title of the first rail, shown while nothing in the rails is focused.
  private defaultHeroSubject(): HeroSubject<I> | null {
    const first = this.layers.browse.querySelector<HTMLElement>(
      '.catalog-rail .catalog-tile[data-focusable]:not(.catalog-see-all)',
    );
    const subject = first ? this.heroSubjectFor(first) : null;
    if (subject) return subject;
    const fallback = this.railGroups[0]?.items[0] ?? this.heroFallback();
    return fallback ? this.itemSubject(fallback) : null;
  }

  // The hero follows the lit title: the focused one while the rails own the
  // keys, else the one the pointer lights under the owner. With nothing lit
  // in the rails it shows the first title. A lit See all or category tile
  // leaves it as it was.
  private syncHero(): void {
    if (this.mode !== 'browse' || !this.layers.browse.querySelector('.catalog-hero')) return;
    const focused = this.current();
    const el = focused && (Focus.owner() === this.focusScope || isHovered(focused)) ? focused : null;
    let subject = el ? this.heroSubjectFor(el) : null;
    if (!subject && el && this.hero) subject = this.hero;
    subject = subject ?? this.defaultHeroSubject();
    if (subject) this.showHero(subject);
    // The section may have been hidden, unmeasured, when the hero last rendered.
    this.fitHeroText();
  }

  private showHero(subject: HeroSubject<I>): void {
    if (this.hero?.key === subject.key && this.hero.item === subject.item) return;
    this.cancelHeroDetails();
    this.hero = subject;
    this.renderHero();
    this.scheduleHeroDetails(subject);
  }

  // Details wait until focus rests on the title; moving on cancels them.
  private scheduleHeroDetails(subject: HeroSubject<I>): void {
    const item = subject.item;
    if (!item || !this.heroDetailsPending(item)) return;
    this.heroTimer = setTimeout(() => {
      this.heroTimer = null;
      if (this.hero !== subject || this.mode !== 'browse' || !this.shown()) return;
      const controller = new AbortController();
      this.heroController = controller;
      const settle = (): void => {
        if (this.heroController === controller) this.heroController = null;
      };
      this.loadHeroDetails(item, controller.signal).then(() => {
        settle();
        if (!controller.signal.aborted && this.hero === subject) this.renderHero();
      }, settle);
    }, CONFIG.XTREAM.HERO_DETAILS_DELAY_MS);
  }

  private cancelHeroDetails(): void {
    if (this.heroTimer !== null) clearTimeout(this.heroTimer);
    this.heroTimer = null;
    this.heroController?.abort();
    this.heroController = null;
  }

  private shown(): boolean {
    return this.container.isConnected && !this.container.classList.contains('hidden');
  }

  private heroMarkup(): Safe {
    const subject = this.hero;
    if (!subject) return html`<div class="catalog-hero-scrim"></div>`;
    const details = subject.item ? this.heroDetails(subject.item) : {};
    const year = details.year && details.year > 0 ? String(details.year) : '';
    const meta = [details.genre ?? '', year].filter(part => !!part);
    // A backdrop that is only the poster again would crop like one.
    const backdrop = details.backdrop ?? '';
    const wide = !!backdrop && backdrop !== subject.poster;
    // An artwork URL sits inside a CSS url('…') string, where the html
    // escaper's entity encoding is decoded before CSS parses it; percent-encode
    // the characters that could break out of the string.
    const bg = (wide ? backdrop : subject.poster).replace(/["'()\\\s]/g, encodeURIComponent);
    return html`
      ${bg ? html`<div class="catalog-hero-art${wide ? '' : ' catalog-hero-art-soft'}"
                       style="background-image: url('${bg}')"></div>` : ''}
      <div class="catalog-hero-scrim"></div>
      <div class="catalog-hero-body">
        <h1 class="catalog-hero-title">${subject.name}</h1>
        <div class="catalog-hero-meta">${meta.join('  ·  ')}</div>
        ${details.plot ? html`<p class="catalog-hero-plot">${details.plot}</p>` : ''}
      </div>
    `;
  }

  private renderHero(): void {
    const hero = this.layers.browse.querySelector<HTMLElement>('.catalog-hero');
    if (!hero) return;
    morph(hero, this.heroMarkup());
    this.fitHeroText();
  }

  // The title's place depends on the layout alone, never on the title shown,
  // so a plot that lands or changes length never moves it: about a third of
  // the way down, or higher where a large Interface or text size leaves too
  // little room for a two-line title and the meta line beneath. The plot
  // grows down from there and drops lines from its end where room runs out,
  // so no line shows cut in half.
  private fitHeroText(): void {
    const body = this.layers.browse.querySelector<HTMLElement>('.catalog-hero-body');
    const hero = body?.parentElement;
    const title = body?.querySelector<HTMLElement>('.catalog-hero-title');
    const meta = body?.querySelector<HTMLElement>('.catalog-hero-meta');
    if (!body || !hero || !title || !meta || !hero.clientHeight) return;
    const height = hero.clientHeight;
    const pad = parseFloat(getComputedStyle(body).bottom) || 0;
    const line = parseFloat(getComputedStyle(title).lineHeight) || 0;
    const metaBlock = meta.offsetHeight + (parseFloat(getComputedStyle(meta).marginTop) || 0);
    let titleLines = HERO_TITLE_LINES;
    let need = titleLines * line + metaBlock;
    if (need > height - 2 * pad) {
      titleLines = 1;
      need = line + metaBlock;
    }
    const top = Math.max(pad, Math.min(height * HERO_TITLE_ANCHOR, height - pad - need));
    body.style.setProperty('top', `${Math.round(top)}px`);
    if (titleLines < HERO_TITLE_LINES) title.style.setProperty('-webkit-line-clamp', String(titleLines));
    else title.style.removeProperty('-webkit-line-clamp');
    const plot = body.querySelector<HTMLElement>('.catalog-hero-plot');
    if (!plot) return;
    plot.style.removeProperty('display');
    plot.style.removeProperty('-webkit-line-clamp');
    const bottom = body.getBoundingClientRect().bottom;
    let lines = HERO_PLOT_LINES;
    while (lines > 0 && plot.getBoundingClientRect().bottom > bottom + 0.5) {
      lines--;
      if (lines === 0) plot.style.setProperty('display', 'none');
      else plot.style.setProperty('-webkit-line-clamp', String(lines));
    }
  }

  // --- browse rails: one rail at a time under the hero ---

  // Aligns the rail holding `el` with the top of the rail area, so the rails
  // above it are clipped away whole. True when it scrolled.
  private snapRail(el: HTMLElement, instant: boolean): boolean {
    const rails = this.layers[this.mode].querySelector<HTMLElement>('.catalog-rails');
    if (!rails) return false;
    const rail = el.closest<HTMLElement>('.catalog-rail');
    // Focus above the rails (a detail's buttons) shows them from the top.
    if (!rail || !rails.contains(rail)) {
      return this.mode === 'detail' && this.scrollRails(rails, 0, instant);
    }
    this.fitRails(rails);
    return this.scrollRails(rails, this.railOffset(rails, rail), instant);
  }

  // A rail's offset in the scrolled content, which holds mid smooth scroll.
  private railOffset(rails: HTMLElement, rail: HTMLElement): number {
    return Math.round(rails.scrollTop + rail.getBoundingClientRect().top
      - rails.getBoundingClientRect().top - rails.clientTop);
  }

  private scrollRails(rails: HTMLElement, target: number, instant: boolean): boolean {
    const top = Math.max(0, target);
    if (Math.abs(top - rails.scrollTop) < 1) return false;
    if (instant) withInstantScroll([rails], () => { rails.scrollTop = top; });
    else rails.scrollTop = top;
    return true;
  }

  // The rail area takes half the view, or more where one rail needs it (a
  // large Interface or text size), so the focused rail always shows whole.
  private fitRails(rails: HTMLElement): void {
    let tallest = 0;
    Array.from(rails.querySelectorAll<HTMLElement>('.catalog-rail')).forEach((rail) => {
      tallest = Math.max(tallest, rail.offsetHeight);
    });
    const fit = `${tallest}px`;
    const layer = this.layers[this.mode];
    if (tallest <= 0 || layer.style.getPropertyValue('--catalog-rail-fit') === fit) return;
    layer.style.setProperty('--catalog-rail-fit', fit);
    if (this.mode === 'detail') this.fitDetail();
    else this.fitHeroText();
  }

  // The wheel steps the rails as the remote does, without moving focus.
  private onWheel(e: CustomEvent<NavWheelDetail>): void {
    const wheel = e.detail;
    if (this.mode === 'grid' || !wheel || !wheel.deltaY || Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)) return;
    const rails = this.layers[this.mode].querySelector<HTMLElement>('.catalog-rails');
    if (!rails || !(e.target instanceof Node) || !rails.contains(e.target)) return;
    e.preventDefault();
    wheel.preventScroll();
    const deltaY = wheel.deltaY;
    const now = Date.now();
    const since = now - this.lastWheelStepAt;
    if (since < CONFIG.NAVIGATION.RAIL_WHEEL_STEP_MS) return;
    // A smooth step still running counts from where it is headed.
    const from = since < CONFIG.NAVIGATION.REVEAL_SETTLE_MS ? this.wheelTarget : rails.scrollTop;
    this.lastWheelStepAt = now;
    const offsets = Array.from(rails.querySelectorAll<HTMLElement>('.catalog-rail'))
      .map(rail => this.railOffset(rails, rail));
    if (!offsets.length) return;
    let index = 0;
    offsets.forEach((offset, i) => {
      if (Math.abs(offset - from) < Math.abs(offsets[index] - from)) index = i;
    });
    const next = Math.max(0, Math.min(offsets.length - 1, index + (deltaY > 0 ? 1 : -1)));
    this.wheelTarget = offsets[next];
    this.scrollRails(rails, offsets[next], false);
  }

  // Concealed titles are dropped at load, so every rail, grid, and hero built
  // from these lists stays free of them without per-render checks.
  private async loadVisibleItems(
    account: PlaylistEntry,
    categoryId: string,
    signal: AbortSignal,
  ): Promise<I[]> {
    const items = await this.loadItems(account, categoryId, signal);
    if (!ParentalControlService.concealing) return items;
    return items.filter(item => !ParentalControlService.isConcealed(
      catalogParentalRequest(this.parentalKind, {
        accountId: account.id,
        categoryId: this.itemCategoryId(item) || categoryId,
        name: this.itemName(item),
        id: this.itemId(item),
      }),
    ));
  }

  private setCategoryItems(categoryId: string, items: I[]): void {
    this.serverItemsByCategory[categoryId] = items;
    this.itemsByCategory[categoryId] = sortCatalogItems(
      items, this.sort.by, getLocale(), this.sort.direction,
    );
  }

  private openSortMenu(): HTMLElement | null {
    return this.layers[this.mode].querySelector<HTMLElement>('.catalog-sort .dropdown.open');
  }

  private dismissSort(via: Via | null): void {
    const menu = this.openSortMenu();
    if (!menu) return;
    this.nav.setRestrict(this.layers[this.mode]);
    this.pick(via, () => closeDropdown(this.nav, menu));
    if (this.gridWindowStale && this.mode === 'grid') this.renderGrid(false, true);
  }

  private applySort(sort: CatalogSortPreference, direction?: CatalogSortDirection): void {
    const changed = sort.by !== this.sort.by || sort.direction !== this.sort.direction;
    const applied = changed && StorageService.setCatalogSort(this.parentalKind, sort);
    if (applied) {
      this.sort = sort;
      Object.keys(this.serverItemsByCategory).forEach(id => {
        this.itemsByCategory[id] = sortCatalogItems(
          this.serverItemsByCategory[id], sort.by, getLocale(), sort.direction,
        );
      });
      this.railGroups = this.railGroups.map(group => ({
        category: group.category,
        items: this.itemsByCategory[group.category.id].slice(0, CONFIG.XTREAM.RAIL_ITEMS),
      }));
      this.gridFocusIndex = 0;
      this.gridVirtualizer.setScrollOffset(0);
      this.resetBrowseRailOffsets = true;
    }
    if (this.mode === 'grid') this.renderGrid(false);
    else this.renderBrowse(false);
    this.place(this.layer().querySelector<HTMLElement>(direction
      ? `[data-sort-direction="${direction}"]` : '.catalog-sort .dropdown-trigger'), this.placementVia());
  }

  private visibleResume(accountId: string): ResumeEntry[] {
    return StorageService.getResumeList(accountId)
      .filter(entry => entry.kind === this.resumeKind && !isResumeConcealed(entry));
  }

  protected visibleWatchlist(kind: WatchlistKind): WatchlistEntry[] {
    return StorageService.getWatchlist(this.account!.id, kind)
      .filter(entry => !isWatchlistConcealed(entry));
  }

  protected findItem(categoryId: string, id: string): I | null {
    const inCat = this.itemsByCategory[categoryId] ?? [];
    const match = inCat.find((x) => this.itemId(x) === id);
    if (match) return match;
    // A provider's virtual group (such as "recently added") lists titles that
    // keep their own category id, which may never be loaded on its own.
    for (const loaded of Object.keys(this.itemsByCategory)) {
      const found = this.itemsByCategory[loaded].find((x) => this.itemId(x) === id);
      if (found) return found;
    }
    return this.fallbackItem(id);
  }

  private async openGrid(categoryId: string): Promise<void> {
    if (!this.account) return;
    const account = this.account;
    const signal = this.requestSignal;
    if (!signal || signal.aborted) return;
    this.collection = null;
    this.managing = false;
    this.gridCategory = this.categories.find((c) => c.id === categoryId) ?? null;
    const request = ++this.gridRequest;
    this.clearLayer('grid');
    if (!this.itemsByCategory[categoryId]) {
      this.renderLoading('grid');
      try {
        const items = await this.loadVisibleItems(
          account,
          categoryId,
          signal,
        );
        if (signal.aborted || this.account?.id !== account.id) return;
        this.setCategoryItems(categoryId, items);
      } catch (err) {
        if (signal.aborted) return;
        log.error(
          'Catalog category load failed',
          'event=xtream.view.load.failed',
          'operation=category',
          `mode=${this.parentalKind}`,
          err,
        );
      }
      if (signal.aborted || this.account?.id !== account.id) return;
      // Back (or another category) may have superseded this grid meanwhile.
      if (this.mode !== 'grid' || request !== this.gridRequest) {
        log.debug(
          'Catalog category load superseded',
          'event=xtream.view.load.superseded',
          'operation=category',
          `mode=${this.parentalKind}`,
          `reason=${this.mode !== 'grid' ? 'left' : 'replaced'}`,
        );
        return;
      }
      this.clearLayer('grid');
    }
    this.gridFocusIndex = 0;
    this.gridVirtualizer.setScrollOffset(0);
    this.renderGrid();
  }

  // --- detail page ---

  // The detail's hero: backdrop (or the softened poster), title, meta line,
  // description, and actions in fixed boxes, the poster on the right, and
  // the rows below in a rail area that snaps a row at a time.
  protected detailPage(page: DetailPage): Safe {
    this.detailText = page.plot ? { title: page.name, text: page.plot } : null;
    const wide = !!page.backdrop && page.backdrop !== page.poster;
    // Percent-encoded like the browse hero's, for the CSS url('…') string.
    const bg = (wide ? page.backdrop : page.poster).replace(/["'()\\\s]/g, encodeURIComponent);
    const parts: Safe[] = [];
    [page.year, page.runtime, page.genre].forEach((part) => {
      if (part) parts.push(html`<span class="detail-meta-part">${part}</span>`);
    });
    if (page.rating) {
      parts.push(html`<span class="detail-meta-part detail-rating"><span class="detail-star">${raw(STAR_ICON)}</span>${page.rating}</span>`);
    }
    const meta = parts.map((part, i) => (i
      ? html`<span class="detail-meta-dot" aria-hidden="true">·</span>${part}`
      : part));
    return html`
      <div class="catalog-view catalog-detail ${this.scopeName()}-detail" data-key="detail:${page.id}" data-nav-container>
        <div class="detail-backdrop">
          ${bg ? html`<div class="detail-art${wide ? '' : ' detail-art-soft'}"
                           style="background-image: url('${bg}')"></div>` : ''}
          <div class="detail-scrim"></div>
        </div>
        <div class="detail-hero">
          <div class="detail-poster-wrap">${this.posterCell(page.name, page.poster)}</div>
          <div class="detail-body">
            <div class="detail-title-box"><h1 class="detail-title">${page.name}</h1></div>
            <div class="detail-meta">${meta}</div>
            <div class="detail-plot-box" ${raw(page.plot ? 'data-focusable' : '')} data-key="plot" data-action="plot">
              <p class="detail-plot">${page.plot}</p>
            </div>
            <div class="detail-actions">${page.actions}</div>
          </div>
        </div>
        <div class="catalog-rails detail-rails">
          <div class="catalog-rails-body">${page.rows.filter((row): row is Safe => !!row)}</div>
          <div class="catalog-rails-end"></div>
        </div>
      </div>
    `;
  }

  protected detailButton(action: DetailAction): Safe {
    const progress = action.progress !== undefined
      ? Math.max(2, Math.min(100, Math.round(action.progress * 100))) : null;
    return html`
      <button class="detail-btn${action.primary ? ' detail-btn-primary' : ''}" type="button"
              data-focusable data-key="${action.key}" data-action="${action.key}"
              ${raw(action.pressed === undefined ? '' : `aria-pressed="${String(action.pressed)}"`)}>
        <span class="detail-btn-icon">${raw(action.icon)}</span>
        <span class="detail-btn-label">${action.label}</span>
        ${progress !== null ? html`<span class="detail-btn-progress"><span class="detail-btn-progress-fill" style="width:${progress}%"></span></span>` : ''}
      </button>
    `;
  }

  protected watchlistButton(watchlisted: boolean): Safe {
    return this.detailButton({
      key: 'watchlist',
      label: t('common.watchlist'),
      icon: watchlisted ? CHECK_ICON : PLUS_ICON,
      pressed: watchlisted,
    });
  }

  // Up to a dozen people: a photo when TMDB matched the name, else initials
  // on a color of their own. OK on a person does nothing.
  protected castRail(members: CastMember[], photos: Map<string, TmdbPerson>): Safe | '' {
    if (!members.length) return '';
    return this.detailRail('cast', t('catalog.cast'), members.map((member, i) => {
      const match = photos.get(member.name);
      const photo = match ? tmdbProfileUrl(match.p) : '';
      const role = member.director ? t('catalog.director') : match?.r ?? '';
      return html`
        <div class="detail-person" data-focusable data-key="person:${i}">
          <div class="detail-person-face" style="background-image:${photo ? 'none' : castGradient(member.name)}">
            <span class="detail-person-initials">${castInitials(member.name)}</span>${photo
              ? html`<img class="detail-person-photo" src="${photo}" alt="" onerror="this.style.display='none'">`
              : ''}
          </div>
          <div class="detail-person-name">${member.name}</div>
          ${role ? html`<div class="detail-person-role">${role}</div>` : ''}
        </div>
      `;
    }));
  }

  // Titles from the same category that the section already holds, ranked by
  // the genres they share with this one, then by rating.
  protected moreLikeThisRail(categoryId: string, currentId: string, genre: string): Safe | '' {
    const items = this.itemsByCategory[categoryId] ?? [];
    const similar = rankMoreLikeThis(currentId, genreSet(genre), items.map(item => ({
      id: this.itemId(item),
      item,
      genres: genreSet(this.itemGenre(item)),
      rating: item.rating ?? '',
    })));
    if (!similar.length) return '';
    return this.detailRail('similar', t('catalog.moreLikeThis'), similar.map(item => this.tile(item)));
  }

  // A genre the section already knows for a title, without asking for it.
  protected itemGenre(_item: I): string | undefined { return undefined; }

  protected detailRail(key: string, title: string, items: Safe[], head: Safe | '' = '', trackClass = ''): Safe {
    return html`
      <div class="catalog-rail detail-rail" data-key="rail:${key}" data-rail-key="${key}">
        <div class="catalog-rail-head detail-rail-head">
          <h2 class="catalog-rail-title">${title}</h2>${head}
        </div>
        <div class="catalog-rail-track${trackClass ? ` ${trackClass}` : ''}" data-edge-scroll>${items}</div>
      </div>
    `;
  }

  // Loads the one category a detail belongs to when no rail or grid has, so
  // More like this has titles to rank.
  protected async ensureCategoryItems(categoryId: string, signal: AbortSignal): Promise<boolean> {
    const account = this.account;
    if (!account || !categoryId || this.itemsByCategory[categoryId]
        || !this.categories.some(category => category.id === categoryId)) return false;
    try {
      const items = await this.loadVisibleItems(account, categoryId, signal);
      if (signal.aborted || this.account?.id !== account.id) return false;
      this.setCategoryItems(categoryId, items);
      return true;
    } catch {
      return false;
    }
  }

  // Lays the hero out in the room the rails leave it. The title and the
  // description keep their reserved lines unless a large Interface or text
  // size leaves too little room; then they lose lines by the layout alone,
  // never by the text shown, so nothing moves when details arrive.
  protected fitDetail(): void {
    const layer = this.layers.detail;
    const hero = layer.querySelector<HTMLElement>('.detail-hero');
    const body = hero?.querySelector<HTMLElement>('.detail-body');
    const poster = hero?.querySelector<HTMLElement>('.detail-poster-wrap');
    if (!hero || !body || !hero.clientHeight) return;
    const height = hero.clientHeight;
    const pad = uiPx(DETAIL_EDGE_PAD);
    // The poster shrinks to the hero's height and the text column stops short
    // of it; where the actions would reach it (a large Interface or text
    // size, a long translation), the poster gives way.
    const gap = uiPx(DETAIL_COLUMN_GAP);
    body.style.setProperty('width', `${uiPx(DETAIL_BODY_WIDTH)}px`);
    if (poster) {
      poster.style.removeProperty('display');
      const posterHeight = Math.max(0, Math.min(uiPx(DETAIL_POSTER_HEIGHT), height - 2 * pad));
      const posterWidth = Math.round(posterHeight * 2 / 3);
      const posterLeft = hero.clientWidth - uiPx(DETAIL_POSTER_RIGHT) - posterWidth;
      poster.style.setProperty('top', `${Math.max(pad, Math.min(uiPx(DETAIL_POSTER_TOP), height - pad - posterHeight))}px`);
      poster.style.setProperty('height', `${posterHeight}px`);
      poster.style.setProperty('width', `${posterWidth}px`);
      const last = body.querySelector<HTMLElement>('.detail-actions')?.lastElementChild as HTMLElement | null;
      const actionsEnd = last ? last.offsetLeft + last.offsetWidth : 0;
      if (body.offsetLeft + actionsEnd + gap > posterLeft) {
        poster.style.setProperty('display', 'none');
        body.style.setProperty('width', `${Math.max(0, hero.clientWidth - 2 * body.offsetLeft)}px`);
      } else {
        body.style.setProperty('width', `${Math.max(0, Math.min(uiPx(DETAIL_BODY_WIDTH), posterLeft - gap - body.offsetLeft))}px`);
      }
    }
    const plotBox = body.querySelector<HTMLElement>('.detail-plot-box');
    let top = uiPx(DETAIL_BODY_TOP);
    let titleLines = DETAIL_TITLE_LINES;
    let plotLines = DETAIL_PLOT_LINES;
    const apply = (): number => {
      body.style.setProperty('top', `${Math.round(top)}px`);
      body.style.setProperty('--detail-title-lines', String(titleLines));
      body.style.setProperty('--detail-plot-lines', String(Math.max(1, plotLines)));
      if (plotBox) {
        if (plotLines > 0) plotBox.style.removeProperty('display');
        else plotBox.style.setProperty('display', 'none');
      }
      return body.offsetHeight;
    };
    let need = apply();
    while (top + need > height - pad) {
      if (top > pad) top = Math.max(pad, height - pad - need);
      else if (titleLines > 1) titleLines--;
      else if (plotLines > 0) plotLines--;
      else break;
      need = apply();
    }
  }

  // After each detail render: the rails fit their tallest row, the hero the rest.
  protected settleDetailLayout(): void {
    const rails = this.layers.detail.querySelector<HTMLElement>('.detail-rails');
    if (rails && this.mode === 'detail') this.fitRails(rails);
    this.fitDetail();
    // A row that arrives above the focused one (Cast, once details load)
    // would push it down; its row snaps back to the top at once.
    const el = this.current();
    if (rails && el && rails.contains(el)) this.snapRail(el, true);
  }

  // Up and Down on a detail step line by line (description, actions, season
  // tabs, then each row) to the target nearest across, so a row the rails
  // clipped above is never skipped for the actions.
  private moveDetailLine(action: 'up' | 'down'): boolean {
    const current = this.current();
    if (!current) return false;
    const lines = Array.from(this.layers.detail.querySelectorAll<HTMLElement>(
      '.detail-plot-box[data-focusable], .detail-actions, .series-seasons, .detail-rails .catalog-rail-track',
    )).map(line => ({
      line,
      targets: line.hasAttribute('data-focusable')
        ? [line]
        : Array.from(line.querySelectorAll<HTMLElement>('[data-focusable]')),
    })).filter(entry => entry.targets.length > 0 && getComputedStyle(entry.line).display !== 'none');
    const index = lines.findIndex(entry => entry.line === current || entry.line.contains(current));
    if (index < 0) return false;
    const next = lines[index + (action === 'up' ? -1 : 1)];
    if (!next) return true;
    const box = current.getBoundingClientRect();
    const x = box.left + box.width / 2;
    let best = next.targets[0];
    let bestDistance = Infinity;
    // The full-width description hands back to the first action.
    if (!current.classList.contains('detail-plot-box')) next.targets.forEach((target) => {
      const r = target.getBoundingClientRect();
      const distance = Math.abs(r.left + r.width / 2 - x);
      if (distance < bestDistance) {
        best = target;
        bestDistance = distance;
      }
    });
    this.place(best, 'key');
    return true;
  }

  private openPlot(): void {
    const text = this.detailText;
    if (!text || this.mode !== 'detail') return;
    this.plotOverlay.show(text.title, text.text, () => {
      if (this.mode === 'detail' && Focus.owner() === this.focusScope) {
        this.request(this.focusScope.focusKey, this.placementVia());
      }
    });
  }

  protected posterCell(name: string, poster: string): Safe {
    return poster
      ? html`<img class="catalog-poster" src="${poster}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : html`<div class="catalog-poster catalog-poster-empty">${name.charAt(0)}</div>`;
  }

  protected itemLockBadge(categoryId: string, id: string): Safe {
    return raw(lockBadge(ParentalControlService.lockState(
      catalogParentalRequest(this.parentalKind, {
        accountId: this.account?.id ?? '',
        categoryId,
        name: '',
        id,
      }),
    )));
  }

  // Lock badges follow the unlock session without changing what is listed.
  refreshLocks(): void {
    if (!this.layer().querySelector('.catalog-view')) return;
    if (this.mode === 'browse') this.renderBrowse(false);
    else if (this.mode === 'grid') this.renderGrid(false);
  }

  protected tile(item: I, overlay: Safe | '' = '', managing = false): Safe {
    const id = this.itemId(item);
    const cat = this.itemCategoryId(item);
    return html`
      <div class="catalog-tile" ${raw(managing ? '' : 'data-focusable')} data-key="i:${cat}:${id}"
           data-item-id="${id}" data-category-id="${cat}">
        <div class="catalog-poster-wrap">${this.posterCell(this.itemName(item), this.itemPoster(item))}${
          this.itemLockBadge(cat, id)}${overlay}</div>
        <div class="catalog-tile-name">${this.itemName(item)}</div>
      </div>
    `;
  }

  // A rail shows the first RAIL_ITEMS titles; a trailing tile opens the full grid.
  private categoryRail(group: { category: C; items: I[] }): Safe {
    const id = group.category.id;
    const total = this.itemsByCategory[id]?.length ?? group.items.length;
    const tiles = group.items.map((it) => this.tile(it));
    if (total > group.items.length) {
      tiles.push(html`
        <div class="catalog-tile catalog-see-all" data-focusable data-key="all:${id}"
             data-category-id="${id}">
          <div class="catalog-poster-wrap catalog-see-all-card">
            ${raw(categoryLockBadge(this.parentalKind, this.account!.id, id))}
            ${raw(SEE_ALL_ICON)}
            <div class="catalog-see-all-label">${t('catalog.seeAll')}</div>
            <div class="catalog-see-all-count">${this.itemCount(total)}</div>
          </div>
        </div>
      `);
    }
    return this.rail(`cat:${id}`, group.category.name, tiles);
  }

  protected rail(key: string, title: string, items: Safe[]): Safe {
    return html`
      <div class="catalog-rail" data-key="rail:${key}" data-rail-key="${key}">
        <h2 class="catalog-rail-title">${title}</h2>
        <div class="catalog-rail-track" data-edge-scroll>${items}</div>
      </div>
    `;
  }

  private loadingMarkup(): Safe {
    return html`
      <div class="catalog-view catalog-loading" data-nav-container>
        <p class="catalog-hint">${t('common.loading')}</p>
      </div>
    `;
  }

  private renderLoading(mode: Mode): void {
    this.showLayer(mode);
    // Drop focus from the hidden layer so OK can't reselect it meanwhile.
    this.place(null, this.placementVia());
    morph(this.layers[mode], this.loadingMarkup());
  }

  private sortControls(): Safe {
    const by = this.sort.by;
    return html`
      <div class="catalog-sort" data-nav-container data-self-activate>
        <span class="catalog-sort-label">${t('catalog.sortBy')}</span>
        ${dropdown(`${this.scopeName()}-${this.mode}-sort`, [
          { value: 'default', label: t('catalog.sortDefault') },
          { value: 'name', label: t('settings.name') },
          { value: 'added', label: t('catalog.sortAdded') },
          { value: 'rating', label: t('catalog.sortRating') },
          { value: 'year', label: t('catalog.sortYear') },
        ], by)}
        ${by !== 'default' ? html`
          <div class="toggle-group" role="radiogroup"
               aria-label="${sortDirections(by).map(direction => sortDirectionLabel(by, direction)).join(' / ')}">
            ${sortDirections(by).map(direction => html`
              <button class="toggle-option catalog-sort-direction${direction === this.sort.direction ? ' active' : ''}"
                      type="button" role="radio" aria-checked="${direction === this.sort.direction}"
                      data-focusable data-key="sort-direction:${direction}" data-sort-direction="${direction}">
                <span class="catalog-sort-direction-icon">${raw(direction === 'asc'
                  ? SORT_ASCENDING_ICON : SORT_DESCENDING_ICON)}</span>
                <span>${sortDirectionLabel(by, direction)}</span>
              </button>
            `)}
          </div>
        ` : ''}
      </div>
    `;
  }

  protected renderBrowse(restoreFocus = true): void {
    this.dismissSort(null);
    this.showLayer('browse');
    const browse = this.layers.browse;
    this.resume = this.visibleResume(this.account!.id);
    const continueRail = this.collectionRail('continue');
    const watchlistRail = this.collectionRail('watchlist');
    const hasContent = this.categories.length > 0 || !!continueRail || !!watchlistRail;
    // Once some categories have no rail, "All Categories" lists every category,
    // rails included, so it is the one complete index of the catalog.
    const moreCats = this.categories.length > this.railGroups.length ? this.categories : [];
    const previousCategoryRail = browse.querySelector<HTMLElement>('.catalog-category-rail');
    if (restoreFocus && previousCategoryRail) {
      this.categoryVirtualizer.setScrollOffset(previousCategoryRail.scrollLeft);
    }
    const categoryViewport = previousCategoryRail?.clientWidth || CATEGORY_RAIL_VIEWPORT;
    const categoryRange = this.categoryVirtualizer.getRange(moreCats.length, categoryViewport);
    this.categoryWindow = `${String(moreCats.length)}:${String(categoryRange.start)}:${String(categoryRange.end)}`;

    morph(browse, html`
      <div class="catalog-view catalog-browse" data-nav-container>
        ${!hasContent
          ? html`<p class="catalog-hint catalog-empty">${this.emptyMessage}</p>`
          : html`
            <div class="catalog-hero">${this.heroMarkup()}</div>
            <div class="catalog-rails">
              <div class="catalog-rails-body">
                ${continueRail}
                ${watchlistRail}
                ${this.railGroups.map((r) => this.categoryRail(r))}
                ${moreCats.length ? html`
                  <div class="catalog-rail" data-key="rail:all-categories"
                       data-rail-key="all-categories">
                    <h2 class="catalog-rail-title">${t('catalog.allCategories')}</h2>
                    <div class="catalog-rail-track catalog-category-rail" data-edge-scroll>
                      <div class="catalog-category-rail-spacer"
                           style="width:${this.categoryVirtualizer.getTotalSize(moreCats.length)}px">
                        ${moreCats.slice(categoryRange.start, categoryRange.end)
                          .map((c, offset) => {
                            const index = categoryRange.start + offset;
                            return html`
                              <div class="catalog-category-rail-cell"
                                   data-key="category-cell:${c.id}"
                                   data-category-virtual-index="${index}"
                                   style="left:${this.categoryVirtualizer.getItemOffset(index)}px">
                                <div class="catalog-cat" data-focusable
                                     data-key="c:${c.id}" data-category-id="${c.id}">${
                                  raw(categoryLockBadge(this.parentalKind, this.account!.id, c.id))
                                }${c.name}</div>
                              </div>
                            `;
                          })}
                      </div>
                    </div>
                  </div>
                ` : ''}
              </div>
              <div class="catalog-rails-end"></div>
            </div>
          `}
      </div>
    `);
    const rails = browse.querySelector<HTMLElement>('.catalog-rails');
    if (rails) this.fitRails(rails);
    this.fitHeroText();
    const categoryRail = browse.querySelector<HTMLElement>('.catalog-category-rail');
    if (categoryRail) {
      this.scrollGuard.syncOffset(
        categoryRail,
        'horizontal',
        this.categoryVirtualizer.scrollOffset,
      );
    }
    if (this.resetBrowseRailOffsets) {
      browse.querySelectorAll<HTMLElement>(
        '[data-rail-key^="cat:"] .catalog-rail-track',
      ).forEach(track => this.scrollGuard.syncOffset(track, 'horizontal', 0));
      this.resetBrowseRailOffsets = false;
    }
    if (restoreFocus) this.restoreBrowseFocus();
    this.syncHero();
  }

  private collectionActions(width: number): Safe {
    return html`
      <div class="catalog-collection-actions" style="width:${width}px" data-nav-container data-self-activate>
        ${this.managing ? html`
          <button class="btn btn-primary catalog-collection-button" type="button" data-focusable
                  data-key="collection:done" data-collection-action="done">
            <span class="catalog-action-icon">${raw(CHECK_ICON)}</span>
            <span>${t('channel.editDone')}</span>
          </button>
          <button class="btn catalog-collection-button catalog-collection-clear" type="button" data-focusable
                  data-key="collection:clear" data-collection-action="clear">
            <span class="catalog-action-icon">${raw(TRASH_ICON)}</span>
            <span>${t('common.clearAll')}</span>
          </button>
        ` : html`
          <button class="btn catalog-collection-button catalog-collection-manage" type="button" data-focusable
                  data-key="collection:manage" data-collection-action="manage">
            <span class="catalog-action-icon">${raw(PENCIL_ICON)}</span>
            <span>${t('parental.manage')}</span>
          </button>
        `}
      </div>
    `;
  }

  // `followView`: the window follows a user scroll, whose offset stays as is;
  // above the first row the window's offset is 0 while the view's is not.
  protected renderGrid(restoreFocus = true, followView = false): void {
    this.gridWindowStale = false;
    this.dismissSort(null);
    this.showLayer('grid');
    const gridLayer = this.layers.grid;
    const cat = this.gridCategory;
    const kind = this.collection;
    if (kind && this.account) this.resume = this.visibleResume(this.account.id);
    const source = this.gridSource();
    const count = source.count;
    if (kind && count === 0) {
      this.leaveCollection();
      return;
    }
    if (restoreFocus) {
      const focused = parseKey(this.focusScope.focusKey);
      const key = this.gridReturnKey ?? (focused?.mode === 'grid' ? focused.key : null);
      if (kind && key) {
        const index = this.gridIndexOf(key);
        if (index >= 0) this.gridFocusIndex = index;
      }
      this.gridReturnKey = null;
    }
    this.gridFocusIndex = Math.max(0, Math.min(this.gridFocusIndex, count - 1));
    const previousView = gridLayer.querySelector<HTMLElement>('.catalog-grid');
    const previousTrack = gridLayer.querySelector<HTMLElement>('.catalog-grid-track');
    if (restoreFocus && previousView) {
      this.gridVirtualizer.setScrollOffset(
        Math.max(0, previousView.scrollTop - this.gridTrackStart(previousView, previousTrack)),
      );
    }
    const viewportWidth = previousTrack?.clientWidth || CATALOG_GRID_VIEWPORT_WIDTH;
    const viewportHeight = previousView?.clientHeight || CATALOG_GRID_VIEWPORT_HEIGHT;
    if (restoreFocus && count) {
      this.gridVirtualizer.ensureVisible(this.gridFocusIndex, viewportWidth, viewportHeight);
    }
    const range = this.gridVirtualizer.getRange(count, viewportWidth, viewportHeight);
    const actionWidth = this.gridVirtualizer.getItemPosition(range.columns - 1, range.columns).left
      + uiPx(CATALOG_GRID_POSTER_WIDTH);
    // Whole columns rarely fill the track; center them, and the heading with them.
    const inset = Math.max(0, Math.floor((viewportWidth - actionWidth) / 2));
    const cells: Safe[] = [];
    for (let index = range.start; index < range.end; index++) {
      const position = this.gridVirtualizer.getItemPosition(index, range.columns);
      cells.push(html`
        <div class="catalog-grid-cell" data-key="grid:${source.keyAt(index)}" data-grid-index="${index}"
             style="left:${position.left + inset}px;top:${position.top}px">${source.render(index)}</div>
      `);
    }
    const managing = !!kind && this.managing;
    morph(gridLayer, html`
      <div class="catalog-view catalog-grid${managing ? ' catalog-managing' : ''}" data-nav-container>
        <div class="catalog-grid-head" style="padding-left:${inset}px;padding-right:${inset}px">
          <h1 class="catalog-grid-title">${kind ? html`
            ${this.collectionTitle(kind)} <span class="catalog-grid-count">${this.collectionCount(kind, count)}</span>
          ` : cat ? cat.name : this.kicker}</h1>
          ${kind ? this.collectionActions(actionWidth) : this.sortControls()}
        </div>
        ${count === 0
          ? html`<p class="catalog-hint">${kind
            ? t(kind === 'continue' ? 'catalog.continueWatchingEmpty' : 'catalog.watchlistEmpty')
            : this.gridEmptyMessage}</p>`
          : html`
            <div class="catalog-grid-track"
                 style="height:${this.gridVirtualizer.getTotalSize(count, viewportWidth)}px">${cells}
            </div>
          `}
      </div>
      ${managing ? html`
        <div class="edit-hints catalog-manage-hints">
          ${okHint(t('common.remove'))}
          <span class="edit-hint">${backKey()}<span>${t('channel.editDone')}</span></span>
        </div>
      ` : ''}
    `);
    const view = gridLayer.querySelector<HTMLElement>('.catalog-grid');
    const track = gridLayer.querySelector<HTMLElement>('.catalog-grid-track');
    const viewOffset = this.gridVirtualizer.scrollOffset === 0
      ? 0
      : this.gridVirtualizer.scrollOffset + this.gridTrackStart(view, track);
    // A view already showing the window's offset keeps its own: above the
    // first row every position maps to 0, and an update in place must not
    // move it.
    if (view && !followView) {
      const shown = Math.max(0, view.scrollTop - this.gridTrackStart(view, track));
      this.scrollGuard.syncOffset(
        view,
        'vertical',
        !restoreFocus && shown === this.gridVirtualizer.scrollOffset ? view.scrollTop : viewOffset,
      );
    }
    if (restoreFocus) {
      const focused = gridLayer.querySelector<HTMLElement>(
        `[data-grid-index="${this.gridFocusIndex}"] [data-focusable]`,
      );
      this.place(focused ?? gridLayer.querySelector<HTMLElement>('[data-focusable]'), this.placementVia());
    }
  }

  private moveGridFocus(direction: Action & ('up' | 'down' | 'left' | 'right')): boolean {
    const count = this.gridSource().count;
    if (!count) return false;
    const track = this.layers.grid.querySelector<HTMLElement>('.catalog-grid-track');
    const view = this.layers.grid.querySelector<HTMLElement>('.catalog-grid');
    const viewportWidth = track?.clientWidth || CATALOG_GRID_VIEWPORT_WIDTH;
    const next = this.gridVirtualizer.getAdjacentIndex(
      this.gridFocusIndex,
      direction,
      count,
      viewportWidth,
    );
    if (next === this.gridFocusIndex) return false;
    this.gridFocusIndex = next;
    const viewportHeight = view?.clientHeight || CATALOG_GRID_VIEWPORT_HEIGHT;
    // Measured against the window's recorded offset, as revealGridIndex is,
    // which a smooth scroll still moves once the guard's frames pass.
    const scrolled = this.gridVirtualizer.ensureVisible(next, viewportWidth, viewportHeight);
    if (!scrolled && this.gridScrollFrame === null) {
      const cell = this.layers.grid.querySelector<HTMLElement>(
        `[data-grid-index="${next}"] [data-focusable]`,
      );
      // Same window and same offset: renderGrid() would morph byte-identical
      // markup, since tiles carry no focus state - the scope owns the class.
      // The channel list already moves focus this way (moveVirtualFocus).
      if (cell) {
        this.place(cell, 'key');
        return true;
      }
    }
    this.renderGrid(false);
    this.place(
      this.layers.grid.querySelector<HTMLElement>(`[data-grid-index="${next}"] [data-focusable]`),
      'key',
    );
    return true;
  }

  private categoryWindowFor(viewport: number): string {
    const count = this.categories.length > this.railGroups.length ? this.categories.length : 0;
    const range = this.categoryVirtualizer.getRange(count, viewport || CATEGORY_RAIL_VIEWPORT);
    return `${String(count)}:${String(range.start)}:${String(range.end)}`;
  }

  // The cells sit inside the rail's padding, which bleeds under the margin.
  private categoryRailContentWidth(rail: HTMLElement | null): number {
    if (!rail?.clientWidth) return CATEGORY_RAIL_VIEWPORT;
    const style = getComputedStyle(rail);
    return rail.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  }

  private moveCategoryFocus(direction: 'left' | 'right'): boolean {
    const parsed = parseKey(this.focusScope.focusKey);
    if (!parsed || parsed.mode !== 'browse' || parsed.rail !== 'all-categories') return false;
    const categories = this.categories;
    const current = this.categoryIndexOf(parsed.key);
    if (current < 0) return false;
    const next = current + (direction === 'left' ? -1 : 1);
    // At either end, stay put: SpatialNav would jump to another rail's tile.
    if (next < 0 || next >= categories.length) return true;
    const rail = this.layers.browse.querySelector<HTMLElement>('.catalog-category-rail');
    this.categoryVirtualizer.ensureVisible(next, this.categoryRailContentWidth(rail));
    this.renderBrowse(false);
    this.place(
      this.layers.browse.querySelector<HTMLElement>(
        `[data-category-virtual-index="${next}"] [data-focusable]`,
      ),
      'key',
    );
    return true;
  }

  private gridTrackStart(
    view: HTMLElement | null,
    track: HTMLElement | null,
  ): number {
    if (!view || !track) return 0;
    return Math.max(
      0,
      track.getBoundingClientRect().top
        - view.getBoundingClientRect().top
        + view.scrollTop,
    );
  }
}
