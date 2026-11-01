import type { Action, AudioTrackOption, SubtitleTrackOption } from '../types';
import { CONFIG } from '../config';
import { $, html, inShownView, onceTransitionEnd, type Safe, withInstantScroll } from '../utils/dom';
import { morph } from '../utils/morph';
import { isRtl } from '../utils/direction';
import { t } from '../i18n';
import { Focus, type FocusScope, type Via } from '../navigation/focus-scope';

const AUTO_HIDE_MS = 5000;
// Space between the picker and the controls it opens from.
const ANCHOR_GAP = 16;
// The picker never reaches closer than this to the top of the screen.
const TOP_MARGIN = 80;

// data-menu-action values of the picker rows.
const PICK_AUDIO = '__audio_track__';
const PICK_SUB = '__subs_track__';
const OPEN_OFFSET = '__subs_offset__';
const OPEN_SEARCH = '__subs_search__';

type PlayerMenuKind = 'audio' | 'subtitles';

interface PlayerMenuOptions {
  getAudioTracks: () => AudioTrackOption[];
  selectAudioTrack: (index: number) => void;
  getSubtitleTracks: () => SubtitleTrackOption[];
  selectSubtitleTrack: (index: number) => void;
  getSubtitleOffsetState: () => { available: boolean; label: string };
  openSubtitleOffset: () => void;
  subtitleSearchAvailable: () => boolean;
  openSubtitleSearch: () => void;
  /** The control the picker opened from, which it sits above. */
  anchor: (kind: PlayerMenuKind) => HTMLElement | null;
  onClose: () => void;
}

/**
 * The audio and subtitle pickers that the player controls open: a compact list
 * above the controls, closed by Back, Left/Right, a pick, or its own auto-hide.
 * Owns its visibility, timer, and focus index; delegated listeners are bound
 * once in the constructor.
 */
export class PlayerMenu {
  private el: HTMLElement | null;
  private lastReveal: { key: string; at: number; hidden: number } | null = null;
  // Opening swaps the content; it lands on its row without a glide.
  private instantReveal = false;
  private isVisible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private focusIdx = 0;
  private kind: PlayerMenuKind = 'audio';
  private cancelHide: (() => void) | null = null;
  // Registered on the first open; focusIdx stays the model, the scope paints it.
  private scope: FocusScope | null = null;

  constructor(container: HTMLElement, private options: PlayerMenuOptions) {
    this.el = $('#player-menu', container);
    this.bindEvents();
  }

  get visible(): boolean {
    return this.isVisible;
  }

  get openKind(): PlayerMenuKind | null {
    return this.isVisible ? this.kind : null;
  }

  open(kind: PlayerMenuKind): void {
    if (!this.el) return;
    if (!this.scope) {
      const el = this.el;
      this.scope = Focus.register({
        id: 'player.menu',
        hoverOnSettle: true,
        root: el,
        restrict: 'self-first',
        when: () => inShownView(el),
        defaultKey: () => this.keyAt(this.focusIdx),
        reveal: (key) => this.revealRow(key),
      });
    }
    this.kind = kind;
    this.isVisible = true;
    this.cancelHide?.();
    this.cancelHide = null;
    this.render();
    this.place();
    this.el.classList.remove('hidden');
    this.el.offsetHeight;
    this.el.classList.add('visible');
    if (this.scope) Focus.push(this.scope);
    this.openAt(this.activeIndex());
    this.resetTimer();
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    if (this.scope) Focus.pop(this.scope);
    const el = this.el;
    if (el) {
      el.classList.remove('visible');
      this.cancelHide = onceTransitionEnd(el, () => {
        this.cancelHide = null;
        if (!this.isVisible) el.classList.add('hidden');
      });
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.options.onClose();
  }

  // Re-reads the tracks, e.g. after a late track list or a selection.
  refresh(): void {
    if (!this.isVisible || !this.el) return;
    const focusedKey = this.keyAt(this.focusIdx);
    this.render();
    // Keep focus on the same row; if it went away, follow the pointer if it
    // rests on a row, else step to the row above.
    const rows = this.rows();
    const idx = rows.findIndex(row => row.dataset.key === focusedKey);
    const hovered = rows.indexOf(this.el.querySelector<HTMLElement>('.menu-item:hover')!);
    this.focusIdx = idx >= 0 ? idx
      : hovered >= 0 ? hovered
        : Math.max(0, Math.min(this.focusIdx - 1, rows.length - 1));
    this.scope?.track(this.keyAt(this.focusIdx));
    Focus.flush();
  }

  resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.el?.matches(':hover')) {
        this.resetTimer();
        return;
      }
      this.hide();
    }, AUTO_HIDE_MS);
  }

  handleAction(action: Action): void {
    if (action === 'back' || action === 'left' || action === 'right') {
      this.hide();
      return;
    }
    const items = this.rows();
    const len = items.length;
    if (!len) return;
    this.resetTimer();
    if (action === 'up') {
      this.moveTo(Math.max(0, this.focusIdx - 1), 'key');
    } else if (action === 'down') {
      this.moveTo(Math.min(len - 1, this.focusIdx + 1), 'key');
    } else if (action === 'select') {
      const item = items[this.focusIdx];
      if (item) this.selectItem(item);
    }
  }

  // Sit above the controls, end edge on the control it opened from, and
  // never past the dock's own end edge: the right, or the left in RTL.
  private place(): void {
    const el = this.el;
    const dock = $('#player-osd');
    const anchor = this.options.anchor(this.kind);
    if (!el || !dock || dock.classList.contains('hidden')) return;
    const dockRect = dock.getBoundingClientRect();
    if (isRtl()) {
      const left = anchor ? anchor.getBoundingClientRect().left : dockRect.left;
      el.style.removeProperty('right');
      el.style.left = `${Math.max(dockRect.left, left)}px`;
    } else {
      const right = anchor ? anchor.getBoundingClientRect().right : dockRect.right;
      el.style.removeProperty('left');
      el.style.right = `${Math.max(window.innerWidth - dockRect.right, window.innerWidth - right)}px`;
    }
    el.style.bottom = `${window.innerHeight - dockRect.top + ANCHOR_GAP}px`;
    el.style.maxHeight = `${Math.max(0, dockRect.top - ANCHOR_GAP - TOP_MARGIN)}px`;
  }

  private activeIndex(): number {
    if (this.kind === 'audio') {
      const active = this.options.getAudioTracks().findIndex(track => track.active);
      return Math.max(0, active);
    }
    // Rows: Off (0), then tracks. Focus the active track, else Off.
    const active = this.options.getSubtitleTracks().findIndex(track => track.active);
    return active >= 0 ? active + 1 : 0;
  }

  private rows(): HTMLElement[] {
    return this.el ? Array.from(this.el.querySelectorAll<HTMLElement>('.menu-item')) : [];
  }

  private keyAt(idx: number): string | null {
    return this.rows()[idx]?.dataset.key ?? null;
  }

  private moveTo(idx: number, via: Via): void {
    this.focusIdx = idx;
    this.scope?.focus(this.keyAt(idx), via);
    Focus.flush();
  }

  private openAt(idx: number): void {
    this.instantReveal = true;
    try {
      this.moveTo(idx, 'key');
    } finally {
      this.instantReveal = false;
    }
  }

  // Scroll only the picker's list to a row past its viewport, never the page.
  // (Magic-Remote wheel scrolling is native — the wheel handler lets
  // `.menu-items` scroll itself; see key-handler.ts.)
  private revealRow(key: string): boolean | null {
    const list = this.el?.querySelector<HTMLElement>('.menu-items');
    const row = this.rows().find(item => item.dataset.key === key);
    if (!list || !row) return null;

    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    let delta: number;
    if (rowRect.top < listRect.top) {
      delta = rowRect.top - listRect.top;
    } else if (rowRect.bottom > listRect.bottom) {
      delta = rowRect.bottom - listRect.bottom;
    } else {
      return null;
    }
    const now = Date.now();
    const hidden = Math.abs(delta);
    const last = this.lastReveal;
    const age = last ? now - last.at : -1;
    // The same row still sliding in from its own reveal: hidden less each pass.
    if (!this.instantReveal && last && last.key === key && age >= 0
      && age < CONFIG.NAVIGATION.REVEAL_SETTLE_MS && hidden < last.hidden) {
      last.hidden = hidden;
      return null;
    }
    // A held key steps faster than a smooth scroll settles; each step jumps.
    const repeated = !!last && last.key !== key
      && age >= 0 && age <= CONFIG.NAVIGATION.FOCUS_REPEAT_WINDOW_MS;
    this.lastReveal = { key, at: now, hidden };
    const target = list.scrollTop + delta;
    if (repeated || this.instantReveal) withInstantScroll([list], () => { list.scrollTop = target; });
    else list.scrollTop = target;
    return true;
  }

  /** Route a selected/clicked row by its data-menu-action. */
  private selectItem(item: HTMLElement): void {
    const action = item.dataset.menuAction;
    if (action === PICK_AUDIO) {
      const idx = Number(item.dataset.trackIndex);
      this.hide();
      if (!Number.isNaN(idx)) this.options.selectAudioTrack(idx);
    } else if (action === PICK_SUB) {
      const idx = Number(item.dataset.trackIndex);
      this.hide();
      if (!Number.isNaN(idx)) this.options.selectSubtitleTrack(idx);
    } else if (action === OPEN_SEARCH) {
      this.hide();
      this.options.openSubtitleSearch();
    } else if (action === OPEN_OFFSET) {
      this.hide();
      this.options.openSubtitleOffset();
    }
  }

  private render(): void {
    const el = this.el;
    if (!el) return;
    morph(el, html`
      <div class="menu-header">
        <h2>${t(this.kind === 'audio' ? 'player.audioTrack' : 'player.subtitles')}</h2>
      </div>
      <div class="menu-items">
        ${this.kind === 'audio' ? this.audioRows() : this.subtitleRows()}
      </div>
    `);
  }

  private audioRows(): Safe[] {
    return this.options.getAudioTracks().map((track) => html`
      <div class="menu-item ${track.available === false ? 'unavailable' : ''}" data-key="audio:${track.index}"
           data-focusable data-menu-action="${PICK_AUDIO}" data-track-index="${track.index}">
        <span class="menu-check">${track.active ? '✓' : ''}</span>
        <span class="menu-track-label">${track.label}</span>
      </div>
    `);
  }

  private subtitleRows(): Safe[] {
    const tracks = this.options.getSubtitleTracks();
    const anyActive = tracks.some(track => track.active);
    const offset = this.options.getSubtitleOffsetState();
    return [
      html`
        <div class="menu-item" data-key="sub:-1"
             data-focusable data-menu-action="${PICK_SUB}" data-track-index="-1">
          <span class="menu-check">${anyActive ? '' : '✓'}</span>
          <span class="menu-track-label">${t('common.off')}</span>
        </div>
      `,
      ...tracks.map((track) => html`
        <div class="menu-item ${track.available === false ? 'unavailable' : ''}" data-key="sub:${track.index}"
             data-focusable data-menu-action="${PICK_SUB}" data-track-index="${track.index}">
          <span class="menu-check">${track.active ? '✓' : ''}</span>
          <span class="menu-track-label">${track.label}</span>
        </div>
      `),
      this.options.subtitleSearchAvailable() ? html`
        <div class="menu-item" data-key="${OPEN_SEARCH}"
             data-focusable data-menu-action="${OPEN_SEARCH}">
          <span class="menu-check"></span>
          <span class="menu-track-label">${t('player.searchOnline')}</span>
        </div>
      ` : html``,
      offset.available ? html`
        <div class="menu-item" data-key="${OPEN_OFFSET}"
             data-focusable data-menu-action="${OPEN_OFFSET}">
          <span class="menu-check"></span>
          <span class="menu-track-label">${t('player.subtitleSync')}</span>
          <span class="menu-item-value">${offset.label}</span>
        </div>
      ` : html``,
    ];
  }

  private bindEvents(): void {
    const el = this.el;
    if (!el) return;

    // Click selects a row
    el.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');
      if (btn) this.selectItem(btn);
    });

    // Hover moves focus
    el.addEventListener('nav:hover', (e: Event) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
      const idx = btn ? this.rows().indexOf(btn) : -1;
      if (idx < 0) return;
      this.moveTo(idx, 'pointer');
      this.resetTimer();
    });
  }
}
