import type { CatchupInfo, Channel, Programme } from '../types';
import { StorageService } from '../services/storage-service';
import { $, hide, html, inShownView, raw, type Safe, show } from '../utils/dom';
import { inlineStart, isRtl } from '../utils/direction';
import { type DvrState } from '../utils/dvr';
import { morph } from '../utils/morph';
import { formatDuration, formatPosition, formatTime, getProgress } from '../utils/time';
import { t, tp } from '../i18n';
import { Focus, Tier, type FocusScope, type Via } from '../navigation/focus-scope';
import {
  AUDIO_ICON,
  favoriteIcon,
  INFO_ICON,
  NEXT_ICON,
  PAUSE_ICON,
  PLAY_ICON,
  PREVIOUS_ICON,
  RESTART_ICON,
  SUBTITLE_ICON,
} from './icons';

export interface PlayerOsdSnapshot {
  playback: {
    position: number;
    duration: number;
    paused: boolean;
  } | null;
  channel: Channel | null;
  channelNumber: number;
  catchup: CatchupInfo | null;
  vodTitle: string | null;
  upNextSeconds: number;
  dvr: DvrState | null;
  nowPlaying: Programme | null;
  /** The programmes after the current one, soonest first. */
  upcoming: Programme[];
  streamInfo: PlayerOsdStreamInfo | null;
  controls: PlayerOsdControls;
  /** The skip in progress: how far the held or repeated Left/Right moved. */
  seek: { delta: number } | null;
}

/** Which controls the dock offers. */
export interface PlayerOsdControls {
  /** Episode navigation; null for a movie and for live TV. */
  episodes: { previous: boolean; next: boolean } | null;
  /** Restart from the beginning: a movie or a catch-up programme. Episodes use Previous. */
  restart: boolean;
  /** The channel's favorite state; null outside live TV. */
  favorite: boolean | null;
  pausable: boolean;
  /** Whether the stream offers a choice worth a picker. */
  audio: boolean;
  subtitles: boolean;
}

export interface PlayerOsdStreamInfo {
  resolution: {
    tier: string;
    label: string;
  } | null;
  hdr: string;
  drm: string;
  fps: string;
  videoCodec: string;
  audioCodec: string;
  audio: string;
  subtitle: string;
}

export type DockControl =
  | 'seek' | 'restart' | 'previous' | 'playpause' | 'next' | 'favorite' | 'info' | 'audio' | 'subtitles';

export interface PlayerOsdOptions {
  getSnapshot: () => PlayerOsdSnapshot;
  canAutoReveal: () => boolean;
  canSeek: () => boolean;
  /** Whether the controls take the keys whenever they show (VOD) or only once OK asks (live). */
  activeWhenShown: () => boolean;
  /** Whether something opened from the dock (a track picker) keeps it up. */
  heldOpen: () => boolean;
  onSeekFraction: (fraction: number) => void;
  onControl: (control: Exclude<DockControl, 'seek' | 'info'>) => void;
  onGoLive: () => void;
  onPlayNext: () => void;
  onCancelNext: () => void;
}

const KEY_PREFIX = 'dock:';
// Only a channel's details expand; the list stays short enough for the panel.
const EXPANDED_UPCOMING = 3;

function controlOf(key: string | null): DockControl | null {
  return key && key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) as DockControl : null;
}

export class PlayerOsd {
  private visible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private message = false;
  private pointerX: number | null = null;
  private pointerY: number | null = null;
  // Programme-icon URLs that failed to load, so a re-render omits them instead of
  // re-requesting a broken image (which would thrash the OSD layout).
  private failedIcons = new Set<string>();
  // Whether the controls own the keys; their scope sits on the Focus stack meanwhile.
  private active = false;
  private focusKey: DockControl = 'seek';
  // Live channel info shows the full description and more of the schedule.
  private expanded = false;
  // The control the pointer rests on while the controls don't own the keys.
  private scope: FocusScope | null = null;

  constructor(private container: HTMLElement, private callbacks: PlayerOsdOptions) {
    // Activate OSD controls on click by coordinate hit-test (vs e.target) since
    // they sit over the video plane. The persistent container is marked so the
    // global click handler skips this self-activating subtree.
    container.setAttribute('data-self-activate', '');
    // eslint-disable-next-line focus/no-raw-pointer-listener -- OSD auto-hide is an activity signal, not focus
    container.addEventListener('mousemove', (e: MouseEvent) => {
      this.pointerX = e.clientX;
      this.pointerY = e.clientY;
      // An active cursor reveals the OSD (and its controls) so there's
      // something to aim at; keep it up while the cursor keeps moving.
      if (this.visible) this.resetTimer();
      else if (this.callbacks.canAutoReveal()) this.show();
    });
    container.addEventListener('click', (e: MouseEvent) => this.onPointerRelease(e.clientX, e.clientY));
    // The pointer on a control lights it; while the controls own the keys,
    // it moves their focus too.
    container.addEventListener('nav:hover', (e: Event) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('#player-osd [data-key]');
      const control = controlOf(target?.getAttribute('data-key') ?? null);
      if (!control || !this.visible) return;
      this.resetTimer();
      if (this.active) {
        this.focus(control, 'pointer');
        return;
      }
      this.ensureScope()?.focus(`${KEY_PREFIX}${control}`, 'pointer');
    });
    // A broken programme icon: record its URL (capture — `error` doesn't bubble)
    // and re-render so morph drops it and never re-requests it.
    container.addEventListener('error', (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!(target instanceof HTMLImageElement) ||
          !target.classList.contains('osd-programme-icon')) return;
      const src = target.getAttribute('src');
      if (src && !this.failedIcons.has(src)) {
        this.failedIcons.add(src);
        if (this.visible) this.render();
      }
    }, true);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Whether the controls own the keys (the D-pad moves among them). */
  isActive(): boolean {
    return this.active;
  }

  /** The control the keys act on while the dock is active. */
  focused(): DockControl | null {
    return this.active ? this.focusKey : null;
  }

  // A status message (reconnecting, stream error) rather than playback info.
  showsMessage(): boolean {
    return this.visible && this.message;
  }

  pointerPosition(): { x: number | null; y: number | null } {
    return { x: this.pointerX, y: this.pointerY };
  }

  clearPointer(): void {
    this.pointerX = null;
    this.pointerY = null;
  }

  clearFailedIcons(): void {
    this.failedIcons.clear();
  }

  show(): void {
    this.visible = true;
    if (!this.active && this.callbacks.activeWhenShown()) this.setActive(true, 'seek');
    else this.render();
    const osd = $('#player-osd', this.container);
    if (osd) show(osd);
    this.resetTimer();
  }

  hide(): void {
    this.visible = false;
    this.expanded = false;
    this.setActive(false);
    const osd = $('#player-osd', this.container);
    if (osd) hide(osd);
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Show the controls and hand them the keys, on `control` or the first one. */
  activate(control?: DockControl): void {
    if (!this.visible) {
      this.visible = true;
      const osd = $('#player-osd', this.container);
      if (osd) show(osd);
    }
    this.setActive(true, control);
    this.resetTimer();
  }

  /** Leave the controls on screen but give the keys back (a channel change). */
  deactivate(): void {
    if (!this.active) return;
    this.setActive(false);
    if (this.visible) this.render();
  }

  /** Move focus among the controls; false when there is nowhere to go. */
  move(direction: 'up' | 'down' | 'left' | 'right'): boolean {
    if (!this.active) return false;
    this.resetTimer();
    const rows = this.rows();
    const row = rows.findIndex(keys => keys.indexOf(this.focusKey) >= 0);
    if (row < 0) return false;
    const keys = rows[row];
    const at = keys.indexOf(this.focusKey);
    let target: DockControl | undefined;
    if (direction === 'left') target = keys[at - 1];
    else if (direction === 'right') target = keys[at + 1];
    else {
      const next = rows[row + (direction === 'down' ? 1 : -1)];
      target = next && (next.indexOf('playpause') >= 0 ? 'playpause' : next[0]);
    }
    if (!target) return false;
    this.focus(target, 'key');
    return true;
  }

  /** OK on the focused control. */
  activateFocused(): void {
    if (!this.active) return;
    this.resetTimer();
    this.trigger(this.focusKey);
  }

  /** The element of a control, for a panel that opens from it. */
  controlElement(control: DockControl): HTMLElement | null {
    return $(`#player-osd [data-key="${KEY_PREFIX}${control}"]`, this.container) as HTMLElement | null;
  }

  resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Keep the OSD up while paused (live DVR or catch-up): nothing to fall behind.
    if (this.callbacks.getSnapshot().playback?.paused || this.callbacks.heldOpen()) return;
    this.timer = setTimeout(() => this.hide(), StorageService.getPlayerOsdTimeoutMs());
  }

  render(): void {
    const osd = $('#player-osd', this.container);
    if (!osd) return;
    this.message = false;
    const state = this.callbacks.getSnapshot();
    if (state.vodTitle !== null) {
      this.renderVod(osd, state);
      return;
    }
    if (!state.channel) return;

    let programmeHtml: string | Safe = '';
    if (state.catchup) {
      // Catch-up playback: show the selected programme's info. The bar tracks the
      // video's playback position (a seekable VOD), not wall-clock time.
      const catchup = state.catchup;
      const start = new Date(catchup.start * 1000);
      const end = new Date(catchup.end * 1000);
      const playback = state.playback;
      const dur = playback && Number.isFinite(playback.duration) && playback.duration > 0
        ? playback.duration
        : catchup.end - catchup.start;
      const pos = playback ? Math.min(playback.position, dur) : 0;
      programmeHtml = html`
        <div class="osd-programme">
          <div class="osd-now-label">${t('common.catchup')}</div>
          <div class="osd-programme-detail">
            ${this.programmeIcon(catchup.icon)}
            <div class="osd-programme-info">
              <div class="osd-programme-title">${catchup.title}</div>
              <div class="osd-programme-time">
                <span>${formatTime(start)} - ${formatTime(end)}</span>
                <span class="osd-remaining">${formatDuration(end.getTime() - start.getTime())}</span>
              </div>
            </div>
          </div>
          ${this.seekRow(pos, dur, state.seek)}
          ${this.description(catchup.description)}
        </div>
      `;
    } else if (state.nowPlaying || state.dvr) {
      // Live playback. Show EPG programme info, and a DVR timeshift bar when the
      // stream exposes a usable seekable window.
      const nowPlaying = state.nowPlaying;
      const upcoming = state.upcoming.slice(0, this.expanded ? EXPANDED_UPCOMING : 1);
      const next = upcoming.length ? html`
        <div class="osd-next-list">
          ${upcoming.map((programme) => html`
            <div class="osd-next">
              <span class="osd-next-label">${t('player.next')}</span>
              <span class="osd-next-title">${programme.title}
                <span class="osd-next-time">${formatTime(programme.start)}</span>
              </span>
            </div>
          `)}
        </div>
      ` : '';
      const detail = nowPlaying ? html`
        <div class="osd-programme-detail">
          ${this.programmeIcon(nowPlaying.icon)}
          <div class="osd-programme-info">
            <div class="osd-programme-title">${nowPlaying.title}</div>
            <div class="osd-programme-time">
              <span>${formatTime(nowPlaying.start)} - ${formatTime(nowPlaying.stop)}</span>
              <span class="osd-remaining">${t('player.remaining', {
                duration: formatDuration(nowPlaying.stop.getTime() - Date.now()),
              })}</span>
            </div>
          </div>
        </div>
      ` : '';
      const progressRow = state.dvr
        ? this.dvrProgressRow(state.dvr, state.seek)
        : nowPlaying ? html`
          <div class="osd-progress-row">
            <span class="osd-time-current">${formatTime(new Date())}</span>
            <div class="osd-progress">
              <div class="osd-progress-bar"
                style="width: ${getProgress(nowPlaying.start, nowPlaying.stop) * 100}%"></div>
            </div>
            <span class="osd-time-end">${formatTime(nowPlaying.stop)}</span>
          </div>
        ` : '';
      programmeHtml = html`
        <div class="osd-programme">
          <div class="osd-now-label">${t(state.dvr && !state.dvr.atLiveEdge
            ? 'player.timeshift'
            : 'player.now')}</div>
          ${detail}
          ${progressRow}
          ${this.description(nowPlaying?.description ?? '')}
        </div>
        ${next}
      `;
    }

    morph(osd, html`
      <div class="osd-channel">
        <div class="osd-channel-number">${state.channelNumber}</div>
        ${state.channel.logo
          ? html`<img class="osd-channel-logo" src="${state.channel.logo}" alt="">`
          : ''}
        <div class="osd-channel-name">${state.channel.name}</div>
        ${this.renderStreamInfo(state.streamInfo)}
      </div>
      ${programmeHtml}
      ${this.controlsRow(state)}
    `);
  }

  updateMessage(message: string): void {
    const osd = $('#player-osd', this.container);
    if (!osd) return;
    this.setActive(false);
    morph(osd, html`<div class="osd-message">${message}</div>`);
    this.message = true;
    // Keep the OSD visible so metadata can repaint over this once the stream
    // recovers (else "Reconnecting..." sticks) and it auto-hides otherwise.
    this.visible = true;
    show(osd);
    this.resetTimer();
  }

  refreshProgress(): void {
    if (!this.visible || this.message) return;
    const state = this.callbacks.getSnapshot();
    const playback = state.playback;
    if (!playback) return;
    if (state.vodTitle !== null) {
      if (state.upNextSeconds > 0) return;
      const dur = Number.isFinite(playback.duration) ? playback.duration : 0;
      this.setProgress(dur > 0 ? Math.min(playback.position, dur) / dur : 0, playback.position);
      return;
    }
    const hasDvrBar = !!$('[data-golive]', this.container);
    // DVR availability can flip after the OSD is already open (the seekable
    // window fills in a beat after tune-in). When the current layout no longer
    // matches, do a full render so the DVR bar appears/disappears on its own.
    if (!!state.dvr !== hasDvrBar) {
      this.render();
      return;
    }
    if (state.dvr) {
      this.setProgress(state.dvr.fraction, null);
      const behind = $('.osd-dvr-behind', this.container);
      if (behind) {
        behind.textContent = state.dvr.atLiveEdge
          ? t('common.live')
          : `-${formatPosition(state.dvr.behindLive)}`;
      }
      const bubble = $('.osd-seek-time', this.container);
      if (bubble) bubble.textContent = this.dvrBubbleText(state.dvr);
      const live = $('.osd-dvr-live', this.container) as HTMLElement | null;
      if (live) live.classList.toggle('is-live', state.dvr.atLiveEdge);
      return;
    }
    if (!state.catchup || !Number.isFinite(playback.duration) || playback.duration <= 0) return;
    this.setProgress(Math.min(playback.position, playback.duration) / playback.duration, playback.position);
  }

  /** Seek to the bar position under (x, y) when it's over the seek bar; returns
   *  whether it seeked. Used by both pointer clicks and OK over the bar. */
  seekAtPointer(x: number | null, y: number | null): boolean {
    if (x === null || y === null || !this.callbacks.canSeek()) return false;
    const bar = $('[data-seekbar]', this.container) as HTMLElement | null;
    if (!bar) return false;
    // The bar's box is its full-height target around the thin track.
    const rect = bar.getBoundingClientRect();
    const hit = rect.width > 0 && x >= rect.left && x <= rect.right &&
      y >= rect.top && y <= rect.bottom;
    if (!hit) return false;
    // The bar fills from the row's start: its right edge in right to left.
    this.callbacks.onSeekFraction((isRtl() ? rect.right - x : x - rect.left) / rect.width);
    return true;
  }

  // Registered on first use: the dock's own ring, painted by key.
  private ensureScope(): FocusScope | null {
    const osd = $('#player-osd', this.container);
    if (!this.scope && osd) {
      this.scope = Focus.register({
        id: 'player.dock',
        root: osd,
        tier: Tier.dock,
        when: () => this.active && inShownView(osd),
        defaultKey: () => {
          const keys = this.rows().reduce<DockControl[]>((all, row) => all.concat(row), []);
          const key = keys.indexOf(this.focusKey) >= 0 ? this.focusKey : keys[0];
          return key ? `${KEY_PREFIX}${key}` : null;
        },
      });
    }
    return this.scope;
  }

  private setActive(on: boolean, control?: DockControl): void {
    const scope = this.ensureScope();
    this.active = on;
    if (!on) {
      if (scope) Focus.pop(scope);
      return;
    }
    this.render();
    this.focusKey = this.landing(control);
    this.render();
    if (scope) {
      Focus.push(scope);
      scope.focus(`${KEY_PREFIX}${this.focusKey}`, 'key');
    }
  }

  // Where the keys land: the asked-for control if it's there, else the seek
  // bar, else play/pause, else the first control.
  private landing(control?: DockControl): DockControl {
    const keys = this.rows().reduce<DockControl[]>((all, row) => all.concat(row), []);
    if (control && keys.indexOf(control) >= 0) return control;
    if (keys.indexOf('seek') >= 0) return 'seek';
    if (keys.indexOf('playpause') >= 0) return 'playpause';
    return keys[0] ?? 'seek';
  }

  private focus(control: DockControl, via: Via): void {
    this.focusKey = control;
    this.render();
    this.scope?.focus(`${KEY_PREFIX}${control}`, via);
    Focus.flush();
  }

  // The rows of focusable controls, top to bottom, as the dock shows them.
  private rows(): DockControl[][] {
    const osd = $('#player-osd', this.container);
    if (!osd) return [];
    return Array.from(osd.querySelectorAll<HTMLElement>('[data-dock-row]'))
      .map(row => Array.from(row.querySelectorAll<HTMLElement>('[data-focusable][data-key]'))
        .map(el => controlOf(el.getAttribute('data-key')))
        .filter((key): key is DockControl => key !== null))
      .filter(keys => keys.length > 0);
  }

  private trigger(control: DockControl): void {
    if (control === 'seek') return;
    if (control === 'info') {
      this.expanded = !this.expanded;
      this.render();
      return;
    }
    this.callbacks.onControl(control);
  }

  // The VOD OSD reuses the Live markup: an `.osd-channel` header (movie/episode
  // title + shared stream-info) over the shared seekable `.osd-progress-row`.
  private renderVod(osd: HTMLElement, state: PlayerOsdSnapshot): void {
    if (state.upNextSeconds > 0) {
      morph(osd, html`
        <div class="osd-next-episode">
          <div class="osd-next-episode-label">${t('player.upNext')}</div>
          <div class="osd-channel-name">${state.vodTitle ?? ''}</div>
          <div class="osd-next-episode-time">${tp('player.playingIn', state.upNextSeconds)}</div>
          <div class="osd-next-episode-actions">
            <button data-next-play>${t('player.playNow')}</button>
            <button data-next-cancel>${t('common.cancel')}</button>
          </div>
        </div>
      `);
      return;
    }
    const playback = state.playback;
    const dur = playback && Number.isFinite(playback.duration) ? playback.duration : 0;
    const pos = playback ? Math.min(playback.position, dur || Infinity) : 0;
    morph(osd, html`
      <div class="osd-channel">
        <div class="osd-channel-name">${state.vodTitle ?? ''}</div>
        ${this.renderStreamInfo(state.streamInfo)}
      </div>
      ${this.seekRow(pos, dur, state.seek)}
      ${this.controlsRow(state)}
    `);
  }

  private description(text: string): Safe | string {
    if (!text) return '';
    return html`<div class="osd-description ${this.expanded ? 'osd-description--full' : ''}">${text}</div>`;
  }

  /** The programme icon `<img>`, or nothing if it has no URL or that URL already
   *  failed to load. Keyed by URL so morph reuses a loaded icon across re-renders
   *  (no reload/flicker); the delegated error listener drops a broken one. */
  private programmeIcon(url: string): Safe | string {
    if (!url || this.failedIcons.has(url)) return '';
    return html`<img class="osd-programme-icon" data-key="prog-icon:${url}" src="${url}" alt="">`;
  }

  // A seekable position bar (VOD, catch-up): time, bar, duration.
  private seekRow(pos: number, dur: number, seek: PlayerOsdSnapshot['seek']): Safe {
    const fraction = dur > 0 ? pos / dur : 0;
    return html`
      <div class="osd-progress-row" data-dock-row>
        <span class="osd-time-current">${formatPosition(pos)}</span>
        ${this.seekBar(fraction, seek ? formatPosition(pos) : '', seek)}
        <span class="osd-time-end">${dur > 0 ? formatPosition(dur) : ''}</span>
      </div>
    `;
  }

  private seekBar(fraction: number, time: string, seek: PlayerOsdSnapshot['seek']): Safe {
    const percent = Math.max(0, Math.min(1, fraction)) * 100;
    const delta = seek && seek.delta !== 0
      ? `${seek.delta > 0 ? '+' : '-'}${formatPosition(Math.abs(seek.delta))}`
      : '';
    return html`
      <div class="osd-progress" data-seekbar data-focusable data-key="${KEY_PREFIX}seek">
        <div class="osd-progress-bar" style="width: ${percent}%"></div>
        ${seek ? html`
          <div class="osd-seek-bubble" style="${inlineStart()}: ${percent}%">
            <span class="osd-seek-time">${time}</span>
            ${delta ? html`<span class="osd-seek-delta">${delta}</span>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  private dvrBubbleText(state: DvrState): string {
    return state.atLiveEdge ? t('common.live') : `-${formatPosition(state.behindLive)}`;
  }

  private dvrProgressRow(state: DvrState, seek: PlayerOsdSnapshot['seek']): Safe {
    return html`
      <div class="osd-progress-row osd-dvr-row" data-dock-row>
        <span class="osd-time-current osd-dvr-behind">${this.dvrBubbleText(state)}</span>
        ${this.seekBar(state.fraction, this.dvrBubbleText(state), seek)}
        <button class="osd-time-end osd-dvr-live ${state.atLiveEdge ? 'is-live' : ''}"
          data-golive aria-label="${t('player.goLive')}">${t('common.live')}</button>
      </div>
    `;
  }

  // The dock's buttons: the transport (restart or previous, play/pause, next) centered,
  // the channel's own controls on the left, stream choices on the right.
  private controlsRow(state: PlayerOsdSnapshot): Safe {
    const c = state.controls;
    const paused = state.playback?.paused ?? false;
    const start: Safe[] = [];
    if (c.favorite !== null) {
      start.push(this.control('favorite', favoriteIcon(c.favorite), t('player.toggleFavorite'), false,
        c.favorite));
      start.push(this.control('info', INFO_ICON, t('player.channelInfo'), false, this.expanded));
    }
    const center: Safe[] = [];
    if (c.restart) center.push(this.control('restart', RESTART_ICON, t('catalog.playFromStart')));
    if (c.episodes) {
      center.push(this.control('previous', PREVIOUS_ICON, t('player.previousEpisode'), !c.episodes.previous));
    }
    if (c.pausable) {
      center.push(this.control('playpause', paused ? PLAY_ICON : PAUSE_ICON,
        t(paused ? 'player.play' : 'player.pause')));
    }
    if (c.episodes) {
      center.push(this.control('next', NEXT_ICON, t('player.nextEpisode'), !c.episodes.next));
    }
    const end: Safe[] = [];
    if (c.audio) end.push(this.control('audio', AUDIO_ICON, t('player.audioTrack')));
    if (c.subtitles) end.push(this.control('subtitles', SUBTITLE_ICON, t('player.subtitles')));
    return html`
      <div class="osd-controls" data-dock-row>
        <div class="osd-controls-side">
          <div class="osd-controls-group">${start}</div>
        </div>
        <div class="osd-controls-group osd-controls-center">${center}</div>
        <div class="osd-controls-side osd-controls-side--end">
          <div class="osd-controls-group">${end}</div>
        </div>
      </div>
    `;
  }

  private control(name: DockControl, icon: string, label: string, disabled = false,
    pressed: boolean | null = null): Safe {
    return html`
      <button class="osd-control" data-key="${KEY_PREFIX}${name}" data-dock-action="${name}"
        ${raw(disabled ? 'disabled' : 'data-focusable')}
        ${raw(pressed === null ? '' : `aria-pressed="${String(pressed)}"`)}
        aria-label="${label}">${raw(icon)}</button>
    `;
  }

  // The stream-info badges (resolution / HDR / DRM / fps / codecs / audio / subtitle),
  // shared by the Live and VOD OSD.
  private renderStreamInfo(info: PlayerOsdStreamInfo | null): Safe | string {
    if (!info) return '';
    return html`
      <div class="osd-stream-info">
        ${info.resolution
          ? html`<span class="si-badge si-badge--${info.resolution.tier}">${
              info.resolution.label
            }</span>`
          : ''}
        ${info.hdr ? html`<span class="si-badge si-badge--hdr">${info.hdr}</span>` : ''}
        ${info.drm ? html`<span class="si-pill">${info.drm}</span>` : ''}
        ${info.fps ? html`<span class="si-pill">${info.fps}fps</span>` : ''}
        ${info.videoCodec ? html`<span class="si-pill">${info.videoCodec}</span>` : ''}
        ${info.audioCodec ? html`<span class="si-pill">${info.audioCodec}</span>` : ''}
        ${info.audio ? html`
          <span class="si-pill si-pill--icon" aria-label="${t('player.audioTrack')}: ${info.audio}">${
            raw(AUDIO_ICON)}<span>${info.audio}</span></span>` : ''}
        ${info.subtitle ? html`
          <span class="si-pill si-pill--icon" aria-label="${t('player.subtitlesTrack', { name: info.subtitle })}">${
            raw(SUBTITLE_ICON)}<span>${info.subtitle}</span></span>` : ''}
      </div>
    `;
  }

  // Move the bar (and the seek target over it) without a re-render. `position`
  // is null on live DVR, whose labels read time behind live.
  private setProgress(fraction: number, position: number | null): void {
    const percent = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    const bar = $('.osd-progress-bar', this.container) as HTMLElement | null;
    if (bar) bar.style.width = percent;
    const bubble = $('.osd-seek-bubble', this.container) as HTMLElement | null;
    if (bubble) bubble.style.setProperty(inlineStart(), percent);
    if (position === null) return;
    const current = $('.osd-time-current', this.container);
    if (current) current.textContent = formatPosition(position);
    const time = $('.osd-seek-time', this.container);
    if (time) time.textContent = formatPosition(position);
  }

  /** A pointer release: seek if it landed on the bar, else activate the control
   *  under it. Coordinates are used because the OSD controls sit over the video
   *  plane. */
  private onPointerRelease(x: number, y: number): void {
    const state = this.callbacks.getSnapshot();
    if (state.upNextSeconds > 0) {
      if (this.hitsControl('[data-next-play]', x, y)) this.callbacks.onPlayNext();
      else if (this.hitsControl('[data-next-cancel]', x, y)) this.callbacks.onCancelNext();
      return;
    }
    if (this.seekAtPointer(x, y)) return;
    if (this.hitsControl('[data-golive]', x, y)) {
      this.callbacks.onGoLive();
      return;
    }
    const buttons = Array.from(this.container.querySelectorAll<HTMLElement>('#player-osd [data-dock-action]'));
    const hit = buttons.find(el => !el.hasAttribute('disabled') && this.hits(el, x, y));
    const control = hit ? controlOf(hit.getAttribute('data-key')) : null;
    if (!control) return;
    if (this.active) this.focus(control, 'pointer');
    else this.focusKey = control;
    this.resetTimer();
    this.trigger(control);
  }

  private hitsControl(selector: string, x: number, y: number): boolean {
    const element = $(selector, this.container) as HTMLElement | null;
    return !!element && this.hits(element, x, y);
  }

  private hits(element: HTMLElement, x: number, y: number): boolean {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && x >= rect.left && x <= rect.right &&
      y >= rect.top && y <= rect.bottom;
  }
}
