import type { Action } from '../types';
import { Focus, type FocusScope } from '../navigation/focus-scope';
import { html } from '../utils/dom';
import { morph } from '../utils/morph';
import { uiPx } from '../utils/ui-scale';

const SCROLL_STEP = 120;

// A title's full description over its detail page. It holds the keys while
// shown and paints no ring: Up and Down scroll a long text, OK and Back close.
export class DetailTextOverlay {
  private el: HTMLElement | null = null;
  private scope: FocusScope | null = null;
  private onClose: (() => void) | null = null;

  constructor(private readonly id: string) {}

  get visible(): boolean {
    return this.el !== null && !this.el.classList.contains('hidden');
  }

  show(title: string, text: string, onClose: () => void): void {
    if (!this.scope) {
      this.scope = Focus.register({
        id: this.id,
        root: () => this.el,
        restrict: 'self-only',
        onAction: (action) => this.handleAction(action),
      });
    }
    this.onClose = onClose;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'detail-text-prompt';
      this.el.setAttribute('data-self-activate', '');
      this.el.addEventListener('click', () => this.hide());
    }
    document.body.appendChild(this.el);
    this.el.classList.remove('hidden');
    morph(this.el, html`
      <div class="detail-text-dialog" role="dialog" aria-label="${title}">
        <h2 class="detail-text-title">${title}</h2>
        <div class="detail-text-body">${text}</div>
      </div>
    `);
    const body = this.el.querySelector<HTMLElement>('.detail-text-body');
    if (body) body.scrollTop = 0;
    Focus.push(this.scope);
  }

  hide(): void {
    if (!this.visible) return;
    this.el?.classList.add('hidden');
    if (this.scope) Focus.pop(this.scope);
    const done = this.onClose;
    this.onClose = null;
    done?.();
  }

  handleAction(action: Action): void {
    if (!this.visible) return;
    const body = this.el?.querySelector<HTMLElement>('.detail-text-body');
    if ((action === 'up' || action === 'down') && body) {
      body.scrollTop += (action === 'up' ? -1 : 1) * uiPx(SCROLL_STEP);
      return;
    }
    if (action === 'select' || action === 'back') this.hide();
  }
}
