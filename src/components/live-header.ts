import type { Action } from '../types';
import { Focus, Tier, type FocusScope } from '../navigation/focus-scope';
import { FocusRing } from '../navigation/focus-ring';
import { html, raw } from '../utils/dom';
import { morph } from '../utils/morph';
import { formatTime } from '../utils/time';
import { t, tp } from '../i18n';
import { GUIDE_ICON, LIST_ICON, PENCIL_ICON } from './icons';

export type LiveMode = 'list' | 'guide';

export interface LiveHeaderHandlers {
  onMode: (mode: LiveMode) => void;
  onEdit: () => void;
  // The keys went back down to the content below.
  onLeave: () => void;
}

const MODE_KEYS: Record<LiveMode, string> = { list: 'live-mode:list', guide: 'live-mode:guide' };
const EDIT_KEY = 'live-edit';

// Pleione's Live header: the section's name and count, the List | Guide
// switch, and the clock. It is shared by the list and the Guide, which it
// moves between. Up from the top of either content reaches it; its scope is
// pushed while it holds the keys, and Down or Back hands them back.
export class LiveHeader {
  private readonly el: HTMLElement;
  private readonly scope: FocusScope;
  private mode: LiveMode = 'list';
  // Null while the channels load: no count, and nothing to edit yet.
  private count: number | null = 0;
  private active = false;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly handlers: LiveHeaderHandlers) {
    this.el = document.createElement('header');
    this.el.className = 'live-header';
    this.el.setAttribute('data-self-activate', '');
    this.scope = Focus.register({
      id: 'live.header',
      root: this.el,
      tier: Tier.overlay,
      defaultKey: () => MODE_KEYS[this.mode],
      onAction: (action) => this.handleAction(action),
    });
    this.el.addEventListener('nav:hover', (e: Event) => {
      const key = (e.target as Element | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key) this.scope.focus(key, 'pointer');
    });
    this.el.addEventListener('click', (e: MouseEvent) => {
      const key = (e.target as Element | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key) this.activate(key, 'pointer');
    });
  }

  get element(): HTMLElement { return this.el; }
  get focusScope(): FocusScope { return this.scope; }
  get isActive(): boolean { return this.active; }
  get currentMode(): LiveMode { return this.mode; }

  /** Show the header at the top of `view`, for `mode`. */
  attach(view: HTMLElement, mode: LiveMode): void {
    this.mode = mode;
    if (this.el.parentElement !== view) view.insertBefore(this.el, view.firstChild);
    this.render();
    this.scheduleClock();
  }

  detach(): void {
    this.leave(false);
    this.el.remove();
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = null;
  }

  setCount(count: number | null): void {
    if (count === this.count) return;
    this.count = count;
    this.render();
  }

  /** Take the keys, on the switch's current mode. */
  enter(): void {
    if (!this.el.parentElement) return;
    this.active = true;
    Focus.push(this.scope);
    this.scope.focus(MODE_KEYS[this.mode], 'key');
  }

  /** Give the keys back; `notify` tells the content below to take them. */
  leave(notify = true): void {
    if (!this.active) return;
    this.active = false;
    Focus.pop(this.scope);
    if (notify) this.handlers.onLeave();
  }

  handleAction(action: Action): void {
    const keys = this.keys();
    const index = Math.max(0, keys.indexOf(this.scope.focusKey ?? ''));
    // Logical actions (src/utils/direction.ts): 'left' is the previous control.
    const step = action === 'left' ? -1 : action === 'right' ? 1 : 0;
    switch (action) {
      case 'left':
      case 'right': {
        const next = keys[index + step];
        if (next) this.scope.focus(next, 'key');
        break;
      }
      case 'select':
        this.activate(keys[index], 'key');
        break;
      case 'down':
      case 'back':
        this.leave();
        break;
      case 'red':
        this.leave(false);
        this.handlers.onMode(this.mode === 'list' ? 'guide' : 'list');
        break;
      default:
        break;
    }
  }

  private keys(): string[] {
    return this.mode === 'list' && this.count !== null
      ? [EDIT_KEY, MODE_KEYS.list, MODE_KEYS.guide]
      : [MODE_KEYS.list, MODE_KEYS.guide];
  }

  private activate(key: string | undefined, via: 'key' | 'pointer'): void {
    if (key === EDIT_KEY) {
      this.leave(false);
      this.handlers.onEdit();
      this.deferContent(via);
      return;
    }
    const mode = key === MODE_KEYS.guide ? 'guide' : key === MODE_KEYS.list ? 'list' : null;
    if (!mode) return;
    if (mode === this.mode) {
      // The mode on show: OK goes back down to it.
      if (via === 'key') this.leave();
      return;
    }
    this.leave(false);
    this.handlers.onMode(mode);
    this.deferContent(via);
  }

  // A click leaves the pointer on the header, which stays lit, so the
  // content's ring waits for a key, as after a pointer tab click.
  private deferContent(via: 'key' | 'pointer'): void {
    if (via === 'pointer') FocusRing.defer('channels');
  }

  private render(): void {
    const other: LiveMode = this.mode === 'list' ? 'guide' : 'list';
    const option = (mode: LiveMode, icon: string, label: string) => html`
      <button type="button" class="toggle-option live-mode-option ${mode === this.mode ? 'active' : ''}"
              data-key="${MODE_KEYS[mode]}" data-focusable data-live-mode="${mode}"
              aria-pressed="${String(mode === this.mode)}">
        <span class="live-mode-icon">${raw(icon)}</span><span>${label}</span>${
          mode === other ? html`<span class="live-red-key" aria-hidden="true"></span>` : ''}
      </button>`;
    morph(this.el, html`
      <div class="live-header-title">${t('nav.live')}</div>
      ${this.count === null ? ''
        : html`<div class="live-header-count">${tp('channel.count', this.count)}</div>`}
      <div class="live-header-spacer"></div>
      ${this.mode === 'list' && this.count !== null ? html`
        <button type="button" class="live-header-edit" data-key="${EDIT_KEY}" data-focusable
                data-edit-channels aria-label="${t('settings.editChannelList')}"
                title="${t('settings.editChannelList')}">${raw(PENCIL_ICON)}</button>` : ''}
      <div class="toggle-group live-mode-toggle" role="group">
        ${option('list', LIST_ICON, t('live.list'))}
        ${option('guide', GUIDE_ICON, t('nav.epg'))}
      </div>
      <time class="live-header-clock">${formatTime(new Date())}</time>
    `);
  }

  private scheduleClock(): void {
    if (this.clockTimer !== null) clearTimeout(this.clockTimer);
    this.clockTimer = setTimeout(() => {
      this.clockTimer = null;
      if (!this.el.parentElement) return;
      const clock = this.el.querySelector('.live-header-clock');
      if (clock) clock.textContent = formatTime(new Date());
      this.scheduleClock();
    }, 60000 - Date.now() % 60000 + 50);
  }
}
