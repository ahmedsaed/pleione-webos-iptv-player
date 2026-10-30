import type { Action, NumberEvent, PlaylistEntry } from '../types';
import { SpatialNav } from '../navigation/spatial-nav';
import { Focus, type FocusScope } from '../navigation/focus-scope';
import { html, raw, type Safe } from '../utils/dom';
import { morph } from '../utils/morph';
import { t } from '../i18n';
import { CONFIG } from '../config';
import { formatTime } from '../utils/time';
import { AccountSwitcher } from './account-switcher';
import { SECTION_ICONS } from './nav-menu';
import { navSections, type Section } from './sections';
import { LINK_ICON, NO_CONNECTION_ICON, SOURCES_ICON, UNLOCK_ICON } from './icons';
import { firstRunIntro, phoneSetupPanel } from './first-run';
import type { ConnectionIssue } from '../services/connection-check';
import type { ServiceInfo } from '../services/setup-client';
import { createLogger } from '../utils/logger';

const log = createLogger('Home');

export type AddCard = 'xtream' | 'playlist';

export interface HomeHandlers {
  onOpenSection: (section: Section, via: 'key' | 'pointer') => void;
  onPlayNumber: (number: number) => void;
  onSelectAccount: (accountId: string) => void;
  onLockNow: () => void;
  // Left at the left edge: the side menu.
  onLeaveLeft: () => void;
  onBack: () => void;
  onAddSource: (kind: AddCard, via: 'key' | 'pointer') => void;
  onRetryConnection: () => void;
  onEditAccount: (issue: ConnectionIssue, via: 'key' | 'pointer') => void;
  loadSetupInfo: () => Promise<ServiceInfo | null>;
}

type Card = Exclude<Section, 'home'>;

const ADD_CARDS: readonly AddCard[] = ['xtream', 'playlist'];
const ALERT_KEYS: readonly string[] = ['alert:retry', 'alert:edit'];

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
// of section cards, Live the big one. It loads and counts nothing. With no
// source yet it shows the first run instead: phone setup beside two Add
// cards. A failed sign-in check puts a banner above the bento.
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
  private firstRun = false;
  private lastAddCard: AddCard = 'xtream';
  // Undefined until the setup service answers.
  private setupInfo: ServiceInfo | null | undefined = undefined;
  private setupRequest: Promise<void> | null = null;
  private issue: ConnectionIssue | null = null;
  private checking = false;
  private lastAlertKey = ALERT_KEYS[0];

  constructor(private readonly container: HTMLElement, private readonly handlers: HomeHandlers) {
    this.focusScope = Focus.register({
      id: 'view.home',
      root: container,
      defaultKey: () => {
        const el = this.nav.focused;
        return el && this.container.contains(el) ? el.dataset.key ?? null : this.entryKey();
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

  // No source at all: the first-run screen replaces the bento.
  setFirstRun(on: boolean): void {
    this.firstRun = on;
  }

  get showsFirstRun(): boolean { return this.firstRun; }

  // The startup sign-in check: a failure shows the banner, and `checking`
  // marks Try again at work. A banner that leaves with the keys hands them
  // back to the bento.
  setConnection(issue: ConnectionIssue | null, checking = false): void {
    const hadKeys = this.alertFocused();
    this.issue = issue;
    this.checking = checking;
    if (!this.container.querySelector('.home-view')) return;
    this.render();
    if (!issue && hadKeys) this.focusKey(`section:${this.lastCard()}`);
  }

  // A banner that appears while Home still rests where it opened takes the
  // keys, so OK tries again.
  focusAlert(): void {
    if (!this.issue || !this.container.querySelector('.home-alert')) return;
    const key = this.focusScope.focusKey;
    if (key !== null && key !== 'section:live') return;
    this.focusKey(this.lastAlertKey);
  }

  // Ask the setup service again: its port arrives after the first render.
  refreshSetupInfo(): Promise<void> {
    const request: Promise<void> = this.handlers.loadSetupInfo()
      .then((info) => {
        if (this.setupRequest !== request) return;
        this.setupInfo = info;
        if (this.firstRun && this.container.querySelector('.home-setup')) this.render();
      })
      .catch((err: unknown) => log.warn('Setup info failed', err));
    this.setupRequest = request;
    return request;
  }

  render(): void {
    if (this.firstRun) {
      this.renderFirstRun();
      return;
    }
    const side = navSections(this.hasXtream)
      .map((s) => s.id)
      .filter((id): id is Card => id !== 'home' && id !== 'live');
    const rows = bentoRows(side);
    this.grid = rows.map((row) => ['live' as Card, ...row]);
    const columns = rows[0].length;
    morph(this.container, html`
      <div class="home-view ${this.issue ? 'home-view-alert' : ''}" data-tint="${this.focusedCard() ?? 'live'}">
        ${this.glows()}
        ${this.header()}
        ${this.issue ? this.alert(columns) : ''}
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

  private renderFirstRun(): void {
    if (this.setupInfo === undefined && !this.setupRequest) void this.refreshSetupInfo();
    const tint = this.focusScope.focusKey === 'add:playlist' ? 'epg' : 'movies';
    morph(this.container, html`
      <div class="home-view home-view-first-run" data-tint="${tint}">
        ${this.glows()}
        ${this.header()}
        <div class="home-first-run">
          ${firstRunIntro()}
          <div class="home-first-run-row">
            ${phoneSetupPanel(this.setupInfo)}
            <div class="home-first-run-cards" data-nav-container>
              ${ADD_CARDS.map((kind) => this.addCard(kind))}
            </div>
          </div>
        </div>
      </div>
    `);
    this.mountAccount();
    this.scheduleClock();
    this.fitLabels();
  }

  private glows(): Safe {
    return html`
      <div class="home-glow home-glow-live"></div>
      <div class="home-glow home-glow-epg"></div>
      <div class="home-glow home-glow-movies"></div>
      <div class="home-glow home-glow-series"></div>
      <div class="home-glow home-glow-search"></div>
      <div class="home-glow home-glow-settings"></div>
    `;
  }

  private header(): Safe {
    return html`
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
    `;
  }

  // The banner spans the bento's width, above it.
  private alert(columns: number): Safe {
    const issue = this.issue!;
    const body = this.checking ? t('settings.checking')
      : t(issue.state === 'rejected' ? 'home.connectionRejected' : 'home.connectionUnreachable');
    return html`
      <div class="home-alert home-alert-cols-${String(columns)}" role="alert" data-nav-container>
        <span class="home-alert-icon">${raw(NO_CONNECTION_ICON)}</span>
        <div class="home-alert-text">
          <div class="home-alert-title">${t('home.connectionFailed', { name: issue.accountName })}</div>
          <div class="home-alert-body">${body}</div>
        </div>
        <button class="btn btn-primary home-alert-action" data-focusable
                data-key="alert:retry">${t('liveCategories.tryAgain')}</button>
        <button class="btn home-alert-action" data-focusable
                data-key="alert:edit">${t('home.editAccount')}</button>
      </div>
    `;
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
    // The setup QR gives up the height its panel lacks, down to half its size.
    const panel = this.container.querySelector<HTMLElement>('.home-setup');
    const qr = panel?.querySelector<HTMLElement>('.home-setup-qr');
    if (panel && qr) {
      qr.style.width = qr.style.height = '';
      const over = panel.scrollHeight - panel.clientHeight;
      if (over > 0) {
        const size = `${String(Math.max(qr.offsetHeight / 2, qr.offsetHeight - over))}px`;
        qr.style.width = qr.style.height = size;
      }
    }
  }

  // Focus a card: the given one, else Live; on the first run, an Add card.
  focusEntry(section: Section | null = null): void {
    if (this.firstRun) {
      this.focusKey(this.entryKey());
      return;
    }
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
  // back to the row Left came from; the banner and then the header row sit
  // above it.
  private move(dir: 'up' | 'down' | 'left' | 'right'): boolean {
    const header = this.headerKeys();
    const key = this.nav.focused && this.container.contains(this.nav.focused)
      ? this.nav.focused.dataset.key ?? '' : this.entryKey();
    const alert = this.issue && !this.firstRun ? ALERT_KEYS : [];
    const headerIndex = header.indexOf(key);
    if (headerIndex >= 0) {
      if (dir === 'left' && headerIndex > 0) return this.focusKey(header[headerIndex - 1]);
      if (dir === 'right' && headerIndex < header.length - 1) return this.focusKey(header[headerIndex + 1]);
      if (dir === 'down') {
        if (this.firstRun) return this.focusKey(`add:${this.lastAddCard}`);
        return this.focusKey(alert.length ? this.lastAlertKey : `section:${this.lastCard()}`);
      }
      return dir === 'up' || dir === 'right';
    }
    if (this.firstRun) return this.moveFirstRun(key, dir, header);
    const alertIndex = alert.indexOf(key);
    if (alertIndex >= 0) {
      // Left off Try again leaves for the side menu, like Left off Live.
      if (dir === 'left') return alertIndex > 0 && this.focusKey(alert[alertIndex - 1]);
      if (dir === 'right') return alertIndex === alert.length - 1 || this.focusKey(alert[alertIndex + 1]);
      if (dir === 'up') return header.length ? this.focusKey(header[header.length - 1]) : true;
      return this.focusKey(`section:${this.lastCard()}`);
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
      if (card === 'live' || row === 0) {
        if (alert.length) return this.focusKey(this.lastAlertKey);
        return header.length ? this.focusKey(header[header.length - 1]) : true;
      }
      return this.focusKey(`section:${this.grid[row - 1][col]}`);
    }
    if (card === 'live' || row === this.grid.length - 1) return true;
    return this.focusKey(`section:${this.grid[row + 1][col]}`);
  }

  // The two Add cards stack; Left leaves for the side menu.
  private moveFirstRun(key: string, dir: 'up' | 'down' | 'left' | 'right', header: string[]): boolean {
    const index = Math.max(0, ADD_CARDS.indexOf(key.slice('add:'.length) as AddCard));
    if (dir === 'left') return false;
    if (dir === 'right') return true;
    if (dir === 'up') {
      if (index > 0) return this.focusKey(`add:${ADD_CARDS[index - 1]}`);
      return header.length ? this.focusKey(header[header.length - 1]) : true;
    }
    return index === ADD_CARDS.length - 1 || this.focusKey(`add:${ADD_CARDS[index + 1]}`);
  }

  private entryKey(): string {
    return this.firstRun ? `add:${this.lastAddCard}` : 'section:live';
  }

  private alertFocused(): boolean {
    return ALERT_KEYS.indexOf(this.focusScope.focusKey ?? '') >= 0;
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
    const key = el?.dataset.key ?? '';
    if (ALERT_KEYS.indexOf(key) >= 0) this.lastAlertKey = key;
    const add = el?.dataset.add as AddCard | undefined;
    if (add) this.lastAddCard = add;
    const section = el?.dataset.section as Card | undefined;
    if (section) this.lastFocusedCard = section;
    const tint = add ? (add === 'xtream' ? 'movies' : 'epg') : section;
    if (tint) this.container.querySelector('.home-view')?.setAttribute('data-tint', tint);
  }

  private activate(el: HTMLElement, via: 'key' | 'pointer'): void {
    const key = el.dataset.key ?? '';
    if (el.dataset.add) {
      this.handlers.onAddSource(el.dataset.add as AddCard, via);
    } else if (key === 'alert:retry') {
      if (!this.checking) this.handlers.onRetryConnection();
    } else if (key === 'alert:edit') {
      if (this.issue) this.handlers.onEditAccount(this.issue, via);
    } else if (key === 'account') {
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

  private addCard(kind: AddCard): Safe {
    const xtream = kind === 'xtream';
    return html`
      <div class="home-card home-card-add home-card-add-${kind}" data-focusable data-key="add:${kind}"
           data-add="${kind}" role="button">
        <span class="home-card-icon">${raw(xtream ? SOURCES_ICON : LINK_ICON)}</span>
        <span class="home-card-label">${t(xtream ? 'home.addXtream' : 'home.addPlaylist')}</span>
        <span class="home-card-sub">${t(xtream ? 'home.addXtreamHint' : 'settings.playlistUrl')}</span>
      </div>
    `;
  }

  private subtitle(card: Card): string {
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
