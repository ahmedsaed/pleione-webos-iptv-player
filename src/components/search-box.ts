import type { Action } from '../types';
import { t } from '../i18n';
import { Focus, Tier, type FocusScope } from '../navigation/focus-scope';
import { SEARCH_ICON } from './icons';

export interface SearchBoxHandlers {
  // The query changed (typed / cleared).
  onQuery: (query: string) => void;
  // Enter / Down: hand the keys to the results or recent searches below;
  // false when there is nothing to take them.
  onLeave: () => boolean;
  // Back / Escape in the box: the Search section's top level.
  onBack: () => void;
}

// The Search section's query box, at the top of the Search view. While its
// caret is in the input, its scope owns the keys and draws no ring (the caret
// marks where they go); Down or Enter hands them to the results below.
export class SearchBox {
  private readonly input: HTMLInputElement;
  private readonly box: HTMLElement;
  private readonly scope: FocusScope;
  private active = false;
  // The keys are here, but not the caret: the on-screen keyboard stays shut.
  private holding = false;

  constructor(private readonly host: HTMLElement, private readonly handlers: SearchBoxHandlers) {
    const box = document.createElement('div');
    box.className = 'search-box';
    const icon = document.createElement('span');
    icon.className = 'search-box-icon';
    icon.innerHTML = SEARCH_ICON; // trusted constant
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'search-box-input';
    this.input.setAttribute('aria-label', t('common.search'));
    box.appendChild(icon);
    box.appendChild(this.input);
    host.appendChild(box);
    this.box = box;
    this.scope = Focus.register({
      id: 'search.box',
      root: box,
      tier: Tier.bar,
      when: () => this.host.getClientRects().length > 0,
      onAction: (action) => this.handleAction(action),
      // Another surface took the keys (a prompt): its caret
      // must not keep the arrow keys.
      onRelease: () => {
        this.input.blur();
        this.box.classList.remove('active');
      },
      onAcquire: () => {
        if (!this.active) return;
        if (this.holding) this.box.classList.add('active');
        else this.input.focus();
      },
    });
    this.bind();
  }

  get focused(): boolean { return this.active; }
  get held(): boolean { return this.active && this.holding; }
  get query(): string { return this.input.value; }

  setPlaceholder(hasXtream: boolean): void {
    this.input.placeholder = t(hasXtream ? 'search.all' : 'search.channels');
    this.input.setAttribute('aria-label', t('common.search'));
  }

  setQuery(query: string): void {
    this.input.value = query;
  }

  // Take the keys and put the caret in the box.
  focus(): void {
    this.holding = false;
    if (!this.active) {
      this.active = true;
      Focus.push(this.scope);
    }
    this.input.focus();
  }

  // Take the keys without the caret, so the on-screen keyboard closes; OK
  // puts the caret back.
  hold(): void {
    this.holding = true;
    this.input.blur();
    this.box.classList.add('active');
    if (this.active) return;
    this.active = true;
    Focus.push(this.scope);
  }

  // Give the keys back to the view below.
  release(): void {
    this.holding = false;
    this.input.blur();
    this.box.classList.remove('active');
    if (!this.active) return;
    this.active = false;
    Focus.pop(this.scope);
  }

  private handleAction(action: Action): void {
    // Reached only when the input lost DOM focus (e.g. to a pointer click),
    // since the global handler leaves keys typed into it alone.
    if (action === 'back') this.handlers.onBack();
    else if (action === 'select' && this.holding) this.focus();
    else if (action === 'down' || action === 'select') this.leave();
    else this.focus();
  }

  private leave(): void {
    this.release();
    if (!this.handlers.onLeave()) this.focus();
  }

  private bind(): void {
    this.input.addEventListener('input', () => this.handlers.onQuery(this.input.value));
    this.input.addEventListener('blur', () => {
      if (!this.holding) this.box.classList.remove('active');
    });
    // A pointer click into the box takes the keys too.
    this.input.addEventListener('focus', () => {
      this.holding = false;
      this.box.classList.add('active');
      if (this.active) return;
      this.active = true;
      Focus.push(this.scope);
    });
    // The global key handler ignores INPUT keydowns, so the box owns Enter /
    // Down (hand off to the results) and Escape (as Back).
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.leave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.handlers.onBack();
      }
    });
  }
}
