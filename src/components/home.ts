import type { Action, NumberEvent, PlaylistEntry } from '../types';
import { SpatialNav } from '../navigation/spatial-nav';
import { Focus, type FocusScope } from '../navigation/focus-scope';
import { html, raw, type Safe } from '../utils/dom';
import { morph } from '../utils/morph';
import { t, tp } from '../i18n';
import { CONFIG } from '../config';
import { formatTime } from '../utils/time';
import { PlaylistService } from '../services/playlist-service';
import { ParentalControlService } from '../services/parental-control';
import { knownCatalogCount } from '../services/xtream-catalog';
import { AccountSwitcher } from './account-switcher';
import { SECTION_ICONS } from './nav-menu';
import { navSections, type Section } from './sections';
import { UNLOCK_ICON } from './icons';
import { createLogger } from '../utils/logger';

const log = createLogger('Home');

export interface HomeHandlers {
  onOpenSection: (section: Section, via: 'key' | 'pointer') => void;
  onPlayNumber: (number: number) => void;
  onSelectAccount: (accountId: string) => void;
  onLockNow: () => void;
  // Left at the left edge: the side menu.
  onLeaveLeft: () => void;
  onBack: () => void;
}

type Card = Exclude<Section, 'home'>;

// The cards right of Live, in rows: one column for two cards, two for three
// or four (an odd last card spans the row), three for five.
export function bentoRows(cards: readonly Card[]): Card[][] {
  const columns = cards.length <= 2 ? 1 : cards.length <= 4 ? 2 : 3;
  const rows: Card[][] = [[], []];
  cards.forEach((card, i) => rows[i < columns ? 0 : 1].push(card));
  // A short last row stretches its last card across the gap.
  while (rows[1].length && rows[1].length < columns) rows[1].push(rows[1][rows[1].length - 1]);
  return rows;
}

// The first screen: the app's name, the clock, and the account over a bento
// of section cards, Live the big one. It reads only counts already loaded.
export class Home {
  readonly focusScope: FocusScope;
  private readonly nav: SpatialNav;
  private hasXtream = false;
  private account: PlaylistEntry | null = null;
  private accounts: PlaylistEntry[] = [];
  private lockShown = false;
  private switcher: AccountSwitcher | null = null;
  // Live, then the side rows as a grid that repeats a spanning card.
  private grid: Card[][] = [];
  // The row Right from Live lands in: the one Left left it from.
  private liveRow = 0;
  private lastFocusedCard: Card | null = null;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly container: HTMLElement, private readonly handlers: HomeHandlers) {
    this.focusScope = Focus.register({
      id: 'view.home',
      root: container,
      defaultKey: () => {
        const el = this.nav.focused;
        return el && this.container.contains(el) ? el.dataset.key ?? null : 'section:live';
      },
    });
    this.nav = new SpatialNav(container, (el) => this.tint(el), { scope: this.focusScope });
    this.container.setAttribute('data-self-activate', '');
    this.container.addEventListener('click', (e: MouseEvent) => {
      // A pick in the account menu closes it before this hit-test, which
      // would land on the card under the row.
      const target = e.target;
      if (target instanceof Node && (!target.isConnected
        || this.container.querySelector('.home-account-slot')?.contains(target))) return;
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      // The switcher answers clicks on its own avatar and rows.
      if (!hit || hit.closest('.home-account-slot')) return;
      const el = hit.closest<HTMLElement>('[data-focusable]');
      if (!el || !this.container.contains(el)) return;
      this.nav.focus(el, 'pointer');
      this.activate(el, 'pointer');
    });
  }

  get accountMenuOpen(): boolean { return !!this.switcher?.menuOpen; }

  setSources(hasXtream: boolean, accounts: PlaylistEntry[], account: PlaylistEntry | null): void {
    this.hasXtream = hasXtream;
    this.accounts = accounts;
    this.account = account;
  }

  setParentalSession(active: boolean): void {
    this.lockShown = active;
  }

  render(): void {
    const side = navSections(this.hasXtream)
      .map((s) => s.id)
      .filter((id): id is Card => id !== 'home' && id !== 'live');
    const rows = bentoRows(side);
    this.grid = rows.map((row) => ['live' as Card, ...row]);
    const columns = rows[0].length;
    morph(this.container, html`
      <div class="home-view" data-tint="${this.focusedCard() ?? 'live'}">
        <div class="home-glow home-glow-live"></div>
        <div class="home-glow home-glow-epg"></div>
        <div class="home-glow home-glow-movies"></div>
        <div class="home-glow home-glow-series"></div>
        <div class="home-glow home-glow-search"></div>
        <div class="home-glow home-glow-settings"></div>
        <header class="home-header" data-nav-container>
          <span class="home-brand">
            <img class="home-logo" src="largeIcon.png" alt="">
            <span class="home-title">${CONFIG.APP_NAME}</span>
          </span>
          ${this.lockShown ? html`
            <button class="home-lock" data-focusable data-key="lock-now" data-lock-now>
              ${raw(UNLOCK_ICON)}<span>${t('parental.lockNow')}</span>
            </button>
          ` : ''}
          <span class="home-clock" data-key="clock">${formatTime(new Date())}</span>
          <div class="home-account ${this.accounts.length ? '' : 'hidden'}"
               ${raw(this.accounts.length ? 'data-focusable' : '')} data-key="account"
               aria-label="${t('nav.switchAccount')}">
            <div class="home-account-slot" data-morph-preserve></div>
          </div>
        </header>
        <div class="home-bento home-bento-cols-${String(columns)}" data-nav-container>
          ${this.card('live')}
          <div class="home-bento-side">
            ${rows.map((row, r) => html`
              <div class="home-bento-row" data-key="row:${String(r)}">
                ${row.filter((card, i) => row.indexOf(card) === i).map((card) =>
                  this.card(card, row.filter((c) => c === card).length))}
              </div>
            `)}
          </div>
        </div>
      </div>
    `);
    this.mountAccount();
    this.scheduleClock();
    this.fitLabels();
  }

  // A label too wide for its card at a large text or Interface size shrinks
  // until it fits, down to two thirds of its size.
  fitLabels(): void {
    // An icon the text squeezes below most of its size goes, rather than
    // shrinking to a speck.
    for (const icon of Array.from(this.container.querySelectorAll<HTMLElement>('.home-card-icon'))) {
      icon.classList.remove('home-card-icon-hidden');
      const svg = icon.querySelector('svg');
      const full = svg ? parseFloat(getComputedStyle(svg).width) : 0;
      if (full && icon.getBoundingClientRect().height < full * 0.75) icon.classList.add('home-card-icon-hidden');
    }
    for (const label of Array.from(this.container.querySelectorAll<HTMLElement>('.home-card-label'))) {
      label.style.fontSize = '';
      const width = label.clientWidth;
      if (!width || label.scrollWidth <= width) continue;
      const size = parseFloat(getComputedStyle(label).fontSize);
      label.style.fontSize = `${Math.max(size * 2 / 3, Math.floor(size * width / label.scrollWidth))}px`;
    }
  }

  // Focus a card: the given one, else Live.
  focusEntry(section: Section | null = null): void {
    const target = this.container.querySelector<HTMLElement>(`[data-key="section:${section ?? 'live'}"]`)
      ?? this.container.querySelector<HTMLElement>('[data-key="section:live"]');
    if (target) this.nav.focus(target);
  }

  resumeFocus(): void {
    this.focusScope.enter('resume');
  }

  // Home is hidden: the clock stops.
  hidden(): void {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = null;
  }

  handleAction(action: Action, event?: NumberEvent): void {
    if (this.nav.showConcealed() && (action === 'up' || action === 'down' || action === 'left' || action === 'right')) {
      return;
    }
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        if (!this.move(action) && action === 'left') this.handlers.onLeaveLeft();
        return;
      case 'select':
        if (this.nav.focused && this.container.contains(this.nav.focused)) {
          this.activate(this.nav.focused, 'key');
        }
        return;
      case 'back':
        this.handlers.onBack();
        return;
      case 'number':
        if (event) this.handlers.onPlayNumber(event.number);
        return;
      default:
        return;
    }
  }

  // The bento moves by its grid, so Live, which spans both rows, sends Right
  // back to the row Left came from; the header row sits above it.
  private move(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const header = this.headerKeys();
    const key = this.nav.focused && this.container.contains(this.nav.focused)
      ? this.nav.focused.dataset.key ?? '' : 'section:live';
    const headerIndex = header.indexOf(key);
    if (headerIndex >= 0) {
      if (dir === 'left' && headerIndex > 0) return this.focusKey(header[headerIndex - 1]);
      if (dir === 'right' && headerIndex < header.length - 1) return this.focusKey(header[headerIndex + 1]);
      if (dir === 'down') return this.focusKey(`section:${this.lastCard()}`);
      return dir === 'up' || dir === 'right';
    }
    const card = key.slice('section:'.length) as Card;
    let row = Math.max(0, this.grid.findIndex((r) => r.indexOf(card) >= 0));
    if (card === 'live') row = this.liveRow;
    const cols = this.grid[row] ?? [];
    const col = card === 'live' ? 0 : cols.indexOf(card);
    if (dir === 'left' || dir === 'right') {
      const step = dir === 'left' ? -1 : 1;
      let next = col + step;
      while (next >= 0 && next < cols.length && cols[next] === card) next += step;
      if (next < 0 || next >= cols.length) return dir === 'right';
      if (cols[next] === 'live') this.liveRow = row;
      return this.focusKey(`section:${cols[next]}`);
    }
    if (dir === 'up') {
      if (card === 'live' || row === 0) return header.length ? this.focusKey(header[header.length - 1]) : true;
      return this.focusKey(`section:${this.grid[row - 1][col]}`);
    }
    if (card === 'live' || row === this.grid.length - 1) return true;
    return this.focusKey(`section:${this.grid[row + 1][col]}`);
  }

  private headerKeys(): string[] {
    const keys: string[] = [];
    if (this.lockShown) keys.push('lock-now');
    if (this.accounts.length) keys.push('account');
    return keys;
  }

  private lastCard(): Card {
    return this.lastFocusedCard ?? 'live';
  }

  private focusKey(key: string): boolean {
    const el = this.container.querySelector<HTMLElement>(`[data-key="${key}"]`);
    if (!el) return false;
    this.nav.focus(el);
    return true;
  }

  private focusedCard(): Card | null {
    const key = this.focusScope.focusKey ?? '';
    return key.indexOf('section:') === 0 ? key.slice('section:'.length) as Card : null;
  }

  // The background glow leans toward the focused card's color.
  private tint(el: HTMLElement | null): void {
    const section = el?.dataset.section as Card | undefined;
    if (!section) return;
    this.lastFocusedCard = section;
    this.container.querySelector('.home-view')?.setAttribute('data-tint', section);
  }

  private activate(el: HTMLElement, via: 'key' | 'pointer'): void {
    const key = el.dataset.key ?? '';
    if (key === 'account') {
      this.switcher?.openMenu(via);
    } else if (key === 'lock-now') {
      this.handlers.onLockNow();
    } else if (el.dataset.section) {
      this.handlers.onOpenSection(el.dataset.section as Section, via);
    }
  }

  private card(card: Card, span = 1): Safe {
    const label = navSections(true).find((s) => s.id === card)?.labelKey ?? 'nav.live';
    const sub = this.subtitle(card);
    return html`
      <div class="home-card home-card-${card}" data-focusable data-key="section:${card}"
           data-section="${card}" role="button" style="flex-grow:${String(span)}">
        <span class="home-card-icon">${raw(SECTION_ICONS[card])}</span>
        <span class="home-card-label">${t(label)}</span>
        ${sub ? html`<span class="home-card-sub">${sub}</span>` : ''}
      </div>
    `;
  }

  // Only counts something already loaded; Home itself loads nothing.
  private subtitle(card: Card): string {
    if (card === 'live') {
      const count = PlaylistService.channels.length;
      return count ? tp('channel.count', count) : '';
    }
    if (card === 'movies' || card === 'series') {
      // A count would tell how much parental controls hide.
      if (!this.account || ParentalControlService.configured) return '';
      const count = knownCatalogCount(this.account.id, card === 'movies' ? 'vod' : 'series');
      if (!count) return '';
      return tp(card === 'movies' ? 'catalog.movieCount' : 'catalog.seriesCount', count);
    }
    if (card === 'search') return t(this.hasXtream ? 'home.searchHint' : 'home.searchHintChannels');
    if (card === 'settings') return t('home.settingsHint');
    return '';
  }

  // The clock ticks on the minute while Home is shown.
  private scheduleClock(): void {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    const now = new Date();
    this.clockTimer = setTimeout(() => {
      this.clockTimer = null;
      const clock = this.container.querySelector('.home-clock');
      if (!clock || !this.container.getClientRects().length) return;
      clock.textContent = formatTime(new Date());
      this.scheduleClock();
    }, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
  }

  private mountAccount(): void {
    const slot = this.container.querySelector<HTMLElement>('.home-account-slot');
    if (!slot) return;
    if (!this.switcher) {
      this.switcher = new AccountSwitcher(slot, {
        onSelect: (id) => this.handlers.onSelectAccount(id),
        onMenuOpen: (mode) => {
          log.debug('Account menu opened', 'event=account.menu.opened', `mode=${mode}`);
          const avatar = this.container.querySelector<HTMLElement>('[data-key="account"]');
          if (avatar && this.nav.focused !== avatar) this.nav.focus(avatar, mode);
        },
        onMenuClose: (reason) => {
          log.debug('Account menu closed', 'event=account.menu.closed', `reason=${reason}`);
          // Back from the menu shows the avatar it hangs from.
          if (reason === 'key') this.focusScope.focus('account', 'key');
        },
      }, 'home.accounts');
      this.switcher.init();
    }
    this.switcher.setAccounts(this.accounts, this.account?.id ?? '');
  }
}
