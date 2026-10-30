// Pleione's Live preview has one decoder, so it follows focus lazily: a row
// must hold focus for `delayMs` before the preview retunes to it. A newer
// focus restarts the wait; leaving the rows cancels it.
export class LiveDwell {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: number | null = null;

  constructor(
    private readonly delayMs: number,
    private readonly retune: (index: number) => void,
  ) {}

  /** A channel row took focus; `current` is the channel the preview shows. */
  focus(index: number, current: number | null): void {
    if (index === this.pending) return;
    this.cancel();
    if (index === current) return;
    this.pending = index;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pending = null;
      this.retune(index);
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  get waiting(): number | null {
    return this.pending;
  }
}
