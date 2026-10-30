export type SearchBusy = 'searching' | 'preparing';

// Search's busy indicator. It appears only once a query has run for
// `delayMs`, so fast results never flash it, and goes as soon as the
// results (or "no matches") render. `onShow` fires when the delay ends,
// for the host to render it.
export class SearchIndicator {
  private busy: SearchBusy | null = null;
  private visible = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onShow: () => void, private readonly delayMs = 200) {}

  // What the indicator shows now: null while idle or still in its delay.
  get shown(): SearchBusy | null {
    return this.visible ? this.busy : null;
  }

  set(busy: SearchBusy | null): void {
    this.busy = busy;
    if (!busy) {
      this.reset();
      return;
    }
    if (this.visible || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.busy) return;
      this.visible = true;
      this.onShow();
    }, this.delayMs);
  }

  reset(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.visible = false;
    this.busy = null;
  }
}
