import type { Action, PlaylistEntry } from '../types';
import { html, raw, type Safe } from '../utils/dom';
import { morph } from '../utils/morph';
import { t } from '../i18n';
import { createLogger } from '../utils/logger';
import { Focus, Tier, type FocusScope } from '../navigation/focus-scope';
import { InputMode } from '../navigation/input-mode';
import { AccountSwitcher } from './account-switcher';
import { navSections, type Section, type SectionDef } from './sections';
import {
  GUIDE_ICON,
  HOME_ICON,
  LIVE_ICON,
  MOVIES_ICON,
  SEARCH_STROKE_ICON,
  SERIES_ICON,
  SETTINGS_ICON,
  UNLOCK_ICON,
} from './icons';

const log = createLogger('NavMenu');

// The pointer at the far-left edge of a section reveals the menu.
export const NAV_MENU_REVEAL_EDGE = 8;
// The pointer must come to the edge and rest there this long, so a sweep
// past it, or a cursor parked in a corner, opens nothing.
export const NAV_MENU_REVEAL_DWELL_MS = 400;

export const SECTION_ICONS: Record<Section, string> = {
  home: HOME_ICON,
  live: LIVE_ICON,
  epg: GUIDE_ICON,
  movies: MOVIES_ICON,
  series: SERIES_ICON,
  search: SEARCH_STROKE_ICON,
  settings: SETTINGS_ICON,
};

function scrollsLeftAt(x: number, y: number): boolean {
  const track = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-edge-scroll]');
  return !!track && track.scrollLeft > 0;
}

export type NavMenuCloseReason = 'key' | 'pointer' | 'select' | 'host';

export interface NavMenuHandlers {
  // A section was picked; the menu has already closed.
  onSelect: (section: Section, via: 'key' | 'pointer') => void;
  // Back in the open menu.
  onBack: () => void;
  // Right closed the menu: the keys go back to where they were.
  onDismiss: () => void;
  onLockNow: () => void;
  onSelectAccount: (accountId: string) => void;
  // Whether the pointer at the left edge may reveal the menu now.
  canReveal: () => boolean;
  // The section shown under the menu, which it marks.
  current: () => Section | null;
}

// The hidden side menu: a slim panel over the left of any section, opened by
// Back at a section's top level, Left at the content's left edge, or the
// pointer at the screen's left edge. A modal scope above the content keeps the
// keys while open; closing it hands them back to wherever they were.
export class NavMenu {
  private readonly root: HTMLElement;
  private readonly scope: FocusScope;
  private sections: readonly SectionDef[] = navSections(false);
  private current: Section | null = null;
  private accounts: PlaylistEntry[] = [];
  private selectedAccountId = '';
  private lockShown = false;
  private _open = false;
  private switcher: AccountSwitcher | null = null;
  private lastPointerX: number | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly handlers: NavMenuHandlers) {
    this.root = document.createElement('div');
    this.root.className = 'nav-menu';
    this.root.setAttribute('data-self-activate', '');
    document.body.appendChild(this.root);
    this.scope = Focus.register({
      id: 'navmenu',
      root: () => this.root.querySelector<HTMLElement>('.nav-menu-panel'),
      restrict: 'self-only',
      tier: Tier.menu,
      defaultKey: () => this.defaultKey(),
      onAction: (action) => this.handleAction(action),
    });
    this.render();
  }

  get isOpen(): boolean { return this._open; }
  get focusScope(): FocusScope { return this.scope; }
  get accountMenuOpen(): boolean { return !!this.switcher?.menuOpen; }

  init(): void {
    this.root.addEventListener('click', (e: MouseEvent) => this.onClick(e));
    this.root.addEventListener('nav:hover', (e: Event) => {
      if (!this._open || this.switcher?.menuOpen || !(e.target instanceof Element)) return;
      const item = e.target.closest<HTMLElement>('.nav-menu-item');
      if (item?.dataset.key) this.scope.focus(item.dataset.key, 'pointer');
    });
    Focus.onPointer((x) => this.onPointer(x));
    InputMode.onChange((mode) => {
      if (mode === 'keys') this.cancelReveal();
    });
  }

  setSections(hasXtream: boolean): void {
    this.sections = navSections(hasXtream);
    this.refresh();
  }

  setAccounts(accounts: PlaylistEntry[], selectedId: string): void {
    this.accounts = accounts;
    this.selectedAccountId = selectedId;
    this.refresh();
  }

  setParentalSession(active: boolean): void {
    if (this.lockShown === active) return;
    this.lockShown = active;
    this.refresh();
  }

  open(via: 'key' | 'pointer'): void {
    if (this._open) return;
    this._open = true;
    this.cancelReveal();
    this.current = this.handlers.current();
    log.debug('Side menu opened', 'event=nav.menu.opened', `via=${via}`,
      `section=${this.current ?? 'none'}`);
    this.render();
    Focus.push(this.scope);
    this.scope.focus(this.currentKey(), via === 'pointer' ? 'pointer' : 'key');
  }

  close(reason: NavMenuCloseReason = 'host'): void {
    if (!this._open) return;
    this._open = false;
    this.switcher?.closeMenu('host');
    Focus.pop(this.scope);
    this.render();
    log.debug('Side menu closed', 'event=nav.menu.closed', `reason=${reason}`);
  }

  handleAction(action: Action): void {
    if (!this._open) return;
    const keys = this.keys();
    const index = Math.max(0, keys.indexOf(this.scope.focusKey ?? ''));
    switch (action) {
      case 'up':
        if (index > 0) this.scope.focus(keys[index - 1], 'key');
        break;
      case 'down':
        if (index < keys.length - 1) this.scope.focus(keys[index + 1], 'key');
        break;
      case 'select':
        this.activate(keys[index], 'key');
        break;
      case 'right':
        this.close('key');
        this.handlers.onDismiss();
        break;
      case 'back':
        this.handlers.onBack();
        break;
      default:
        break;
    }
  }

  private keys(): string[] {
    const keys: string[] = [];
    if (this.accounts.length) keys.push('account');
    for (const s of this.sections) keys.push(`section:${s.id}`);
    if (this.lockShown) keys.push('lock-now');
    return keys;
  }

  private currentKey(): string {
    return this.current && this.sections.some((s) => s.id === this.current)
      ? `section:${this.current}` : this.defaultKey();
  }

  private defaultKey(): string {
    return `section:${this.sections[0]?.id ?? 'home'}`;
  }

  private activate(key: string | undefined, via: 'key' | 'pointer'): void {
    if (!key) return;
    if (key === 'account') {
      this.switcher?.openMenu(via);
      return;
    }
    if (key === 'lock-now') {
      this.handlers.onLockNow();
      return;
    }
    const section = key.slice('section:'.length) as Section;
    this.close('select');
    this.handlers.onSelect(section, via);
  }

  private onClick(e: MouseEvent): void {
    if (!this._open || this.inSwitcher(e)) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit || !this.root.contains(hit)) return;
    // The switcher answers clicks on its own avatar and rows.
    if (hit.closest('.nav-menu-account-slot')) return;
    if (hit.closest('.nav-menu-scrim')) {
      this.close('pointer');
      return;
    }
    const item = hit.closest<HTMLElement>('.nav-menu-item');
    if (item?.dataset.key) this.activate(item.dataset.key, 'pointer');
  }

  // A click the switcher took: picking a row closes its menu before this
  // listener hit-tests, which would land on the item under the row.
  private inSwitcher(e: Event): boolean {
    const target = e.target;
    const slot = this.root.querySelector('.nav-menu-account-slot');
    return target instanceof Node && (!target.isConnected || !!slot?.contains(target));
  }

  private onPointer(x: number): void {
    const from = this.lastPointerX;
    this.lastPointerX = x;
    // The pointer only opens the menu, once per entry into the edge zone;
    // a Magic Remote drifts, so moving never closes it (a click does).
    if (this._open) return;
    if (x > NAV_MENU_REVEAL_EDGE) this.cancelReveal();
    else if (from !== null && from > NAV_MENU_REVEAL_EDGE && this.revealTimer === null) this.armReveal();
  }

  private armReveal(): void {
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      const at = Focus.pointerPosition();
      if (!at || at.x > NAV_MENU_REVEAL_EDGE || InputMode.current !== 'pointer') return;
      // A rail still scrolling back under the pointer edge-scrolls first; the
      // menu comes once it rests at its start.
      if (scrollsLeftAt(at.x, at.y)) {
        this.armReveal();
        return;
      }
      if (this.handlers.canReveal()) this.open('pointer');
    }, NAV_MENU_REVEAL_DWELL_MS);
  }

  private cancelReveal(): void {
    if (this.revealTimer !== null) clearTimeout(this.revealTimer);
    this.revealTimer = null;
  }

  private refresh(): void {
    const keys = this.keys();
    if (this._open && this.scope.focusKey && keys.indexOf(this.scope.focusKey) < 0) {
      this.scope.track(this.currentKey(), true);
    }
    this.render();
  }

  // Always rendered, so the switcher keeps one slot; hidden without accounts.
  private accountRow(): Safe {
    const active = this.accounts.find((a) => a.id === this.selectedAccountId) ?? this.accounts[0];
    return html`
      <div class="nav-menu-item nav-menu-account ${active ? '' : 'hidden'}" ${raw(active ? 'data-focusable' : '')}
           data-key="account">
        <div class="nav-menu-account-slot" data-morph-preserve></div>
        <span class="nav-menu-label">${active ? active.name : ''}</span>
      </div>
    `;
  }

  private render(): void {
    morph(this.root, html`
      <div class="nav-menu-scrim"></div>
      <nav class="nav-menu-panel" data-nav-container>
        ${this.accountRow()}
        <div class="nav-menu-sections">
          ${this.sections.map((s) => html`
            <div class="nav-menu-item ${s.id === this.current ? 'current' : ''}" data-focusable
                 data-key="section:${s.id}" data-section="${s.id}">
              <span class="nav-menu-icon">${raw(SECTION_ICONS[s.id])}</span>
              <span class="nav-menu-label">${t(s.labelKey)}</span>
            </div>
          `)}
        </div>
        ${this.lockShown ? html`
          <div class="nav-menu-item nav-menu-lock" data-focusable data-key="lock-now" data-lock-now>
            <span class="nav-menu-icon">${raw(UNLOCK_ICON)}</span>
            <span class="nav-menu-label">${t('parental.lockNow')}</span>
          </div>
        ` : ''}
      </nav>
    `);
    this.root.classList.toggle('open', this._open);
    this.mountAccount();
  }

  private mountAccount(): void {
    const slot = this.root.querySelector<HTMLElement>('.nav-menu-account-slot');
    if (!slot) return;
    if (!this.switcher) {
      this.switcher = new AccountSwitcher(slot, {
        onSelect: (id) => this.handlers.onSelectAccount(id),
        onMenuOpen: (mode) => {
          log.debug('Account menu opened', 'event=account.menu.opened', `mode=${mode}`);
          if (this._open) this.scope.focus('account', mode === 'pointer' ? 'pointer' : 'key');
        },
        onMenuClose: (reason) => {
          log.debug('Account menu closed', 'event=account.menu.closed', `reason=${reason}`);
        },
      }, 'navmenu.accounts');
      this.switcher.init();
    }
    this.switcher.setAccounts(this.accounts, this.selectedAccountId);
  }
}
