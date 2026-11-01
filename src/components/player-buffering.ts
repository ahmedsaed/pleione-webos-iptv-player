import { CONFIG } from '../config';

export interface BufferingProbe {
  currentTime: number;
  paused: boolean;
  seeking: boolean;
}

// A spinner over a movie, episode, or catch-up program while it buffers: from
// a load or a seek until playback moves, on `waiting`, and whenever playing
// video stops advancing. webOS may not fire `waiting` after a seek in an MKV,
// so a frozen clock counts too. It is a cue, never a target.
export class BufferingIndicator {
  private readonly el: HTMLElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  // Waiting for playback to move past `base` (a load, a seek, `waiting`).
  private pending = false;
  private base: number | null = null;
  private lastTime = -1;
  private lastMovedAt = 0;

  constructor(container: HTMLElement, private readonly probe: () => BufferingProbe | null) {
    this.el = document.createElement('div');
    this.el.className = 'player-buffering hidden';
    this.el.setAttribute('aria-hidden', 'true');
    const ring = document.createElement('div');
    ring.className = 'loading-spinner';
    this.el.appendChild(ring);
    container.appendChild(this.el);
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  /** A load, a seek, or `waiting`: show until playback moves. */
  expect(): void {
    this.pending = true;
    this.base = null;
    this.lastMovedAt = Date.now();
    if (this.timer === null) {
      this.timer = setInterval(() => this.tick(), CONFIG.PLAYER.BUFFERING_POLL_MS);
    }
    this.tick();
  }

  /** `playing`: frames are coming. */
  playing(): void {
    this.pending = false;
    this.lastMovedAt = Date.now();
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.pending = false;
    this.base = null;
    this.lastTime = -1;
    this.set(false);
  }

  private tick(): void {
    const p = this.probe();
    if (!p) {
      // Nothing to watch (live, a retry's wait, the end): the next load or
      // seek starts over.
      this.stop();
      return;
    }
    const now = Date.now();
    if (p.currentTime !== this.lastTime) {
      this.lastTime = p.currentTime;
      this.lastMovedAt = now;
    }
    if (this.pending && !p.seeking) {
      // The seek landed: the clock moving past it, or a pause, ends the wait.
      if (this.base === null) this.base = p.currentTime;
      else if (p.currentTime !== this.base) this.pending = false;
      if (p.paused) this.pending = false;
    }
    const frozen = !p.paused && !p.seeking && now - this.lastMovedAt >= CONFIG.PLAYER.BUFFERING_FROZEN_MS;
    this.set(this.pending || frozen);
  }

  private set(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }
}
