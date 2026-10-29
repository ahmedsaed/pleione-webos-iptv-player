import { t } from '../i18n';
import { HOME_ICON } from './icons';

// A Home button for the Magic Remote, over a section's corner. CSS shows it
// only with the pointer in charge (`html:not(.keyboard-nav)`); the remote's
// keys use Back and the side menu, so it takes no focus and draws no ring.
export class HomeButton {
  private readonly el: HTMLButtonElement;

  constructor(onHome: () => void) {
    this.el = document.createElement('button');
    this.el.type = 'button';
    this.el.className = 'home-button';
    // Its own click is the action: the global click handler skips it.
    this.el.setAttribute('data-self-activate', '');
    this.el.setAttribute('tabindex', '-1');
    this.el.innerHTML = HOME_ICON; // trusted constant
    // A click must not leave DOM focus here, or a later OK would click it again.
    this.el.addEventListener('mousedown', (e: MouseEvent) => e.preventDefault());
    this.el.addEventListener('click', (e: MouseEvent) => {
      e.preventDefault();
      onHome();
    });
    document.body.appendChild(this.el);
    this.refreshLabel();
  }

  get element(): HTMLElement { return this.el; }

  /** Offer it on `view`, or on nothing (Home, the player, a sub-page). */
  showOn(view: string | null): void {
    if (view) this.el.setAttribute('data-view', view);
    else this.el.removeAttribute('data-view');
  }

  refreshLabel(): void {
    this.el.setAttribute('aria-label', t('nav.home'));
  }
}
