import type { Action } from '../types';
import { Focus, type FocusScope, type Via } from '../navigation/focus-scope';
import { html } from '../utils/dom';
import { morph } from '../utils/morph';
import { t } from '../i18n';

interface TitleMenuOptions {
  title: string;
  actions: { key: string; label: string }[];
  onAction: (key: string) => void;
}

const CANCEL = 'cancel';

// A title's actions in a small modal, opened by holding OK on it: the
// actions in a column, then Cancel. Back cancels too.
export class TitleMenu {
  private el: HTMLElement | null = null;
  private options: TitleMenuOptions | null = null;
  private focus = '';
  private scope: FocusScope | null = null;

  // `id` names the focus scope, registered on the first show.
  constructor(private readonly id: string) {}

  get visible(): boolean {
    return this.el !== null && !this.el.classList.contains('hidden');
  }

  show(options: TitleMenuOptions): void {
    if (!this.scope) {
      this.scope = Focus.register({
        id: this.id,
        root: () => this.el,
        restrict: 'self-only',
        onAction: (action) => this.handleAction(action),
        defaultKey: () => this.focus,
      });
    }
    this.options = options;
    this.focus = options.actions[0]?.key ?? CANCEL;
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'confirmation-prompt title-menu';
      this.el.setAttribute('data-self-activate', '');
      this.bindEvents();
    }
    document.body.appendChild(this.el);
    this.el.classList.remove('hidden');
    this.render();
    Focus.push(this.scope);
    this.moveTo(this.focus, 'key');
  }

  hide(): void {
    this.el?.classList.add('hidden');
    this.options = null;
    if (this.scope) Focus.pop(this.scope);
  }

  handleAction(action: Action): void {
    if (!this.visible) return;
    const keys = this.keys();
    const at = keys.indexOf(this.focus);
    switch (action) {
      case 'up':
        if (at > 0) this.moveTo(keys[at - 1], 'key');
        break;
      case 'down':
        if (at < keys.length - 1) this.moveTo(keys[at + 1], 'key');
        break;
      case 'select':
        this.activate(this.focus);
        break;
      case 'back':
        this.activate(CANCEL);
        break;
    }
  }

  private keys(): string[] {
    return (this.options?.actions ?? []).map(action => action.key).concat(CANCEL);
  }

  private moveTo(key: string, via: Via): void {
    this.focus = key;
    this.scope?.focus(key, via);
    Focus.flush();
  }

  private activate(key: string): void {
    const options = this.options;
    this.hide();
    if (options && key !== CANCEL) options.onAction(key);
  }

  private render(): void {
    if (!this.el || !this.options) return;
    morph(this.el, html`
      <div class="confirmation-dialog title-menu-dialog" role="dialog">
        <h2 class="confirmation-title title-menu-title">${this.options.title}</h2>
        <div class="title-menu-actions">
          ${this.options.actions.map(action => html`
            <button class="confirmation-btn" data-focusable data-key="${action.key}"
                    data-menu-action="${action.key}">${action.label}</button>
          `)}
          <button class="confirmation-btn" data-focusable data-key="${CANCEL}"
                  data-menu-action="${CANCEL}">${t('common.cancel')}</button>
        </div>
      </div>
    `);
  }

  private bindEvents(): void {
    this.el!.addEventListener('nav:hover', (event: Event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');
      if (button) this.moveTo(button.dataset.menuAction ?? CANCEL, 'pointer');
    });
    this.el!.addEventListener('click', (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-menu-action]');
      if (button) this.activate(button.dataset.menuAction ?? CANCEL);
    });
  }
}
