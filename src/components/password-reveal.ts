import { html, type Safe } from '../utils/dom';
import { CONFIG } from '../config';

// A password field shows the character just typed for a moment, as phones
// do, then masks it. The field stays a real `type="password"` input, so its
// value, caret and the TV keyboard's password mode are never touched: an
// overlay over the field draws the same discs with that one character clear,
// plus a caret, while the field's own glyphs and caret are hidden.

export const PASSWORD_REVEAL_MS = 1000;

export type RevealSegment =
  | { kind: 'masked'; text: string }
  | { kind: 'clear'; text: string }
  | { kind: 'caret' };

/**
 * The index of the one character `next` gained over `previous`, wherever it
 * was typed, or null for any other edit (a deletion, a paste, a replace).
 */
export function insertedIndex(previous: string, next: string): number | null {
  if (next.length !== previous.length + 1) return null;
  let i = 0;
  while (i < previous.length && previous[i] === next[i]) i++;
  return next.slice(i + 1) === previous.slice(i) ? i : null;
}

/** The overlay's runs: discs, the clear character at `index`, and the caret. */
export function revealSegments(value: string, index: number, caret: number): RevealSegment[] {
  const at = Math.max(0, Math.min(caret, value.length));
  const segments: RevealSegment[] = [];
  let run = '';
  const flush = (): void => {
    if (run) segments.push({ kind: 'masked', text: run });
    run = '';
  };
  for (let i = 0; i <= value.length; i++) {
    if (i === at) {
      flush();
      segments.push({ kind: 'caret' });
    }
    if (i === value.length) break;
    if (i === index) {
      flush();
      segments.push({ kind: 'clear', text: value[i] });
    } else {
      run += value[i];
    }
  }
  flush();
  return segments;
}

/** A password input wrapped with the overlay that reveals the last character. */
export function passwordField(input: Safe): Safe {
  return html`<div class="password-field">${input}<div class="password-reveal" aria-hidden="true"></div></div>`;
}

const NAVIGATION_KEYS = new Set<number>([
  CONFIG.KEYS.LEFT, CONFIG.KEYS.RIGHT, CONFIG.KEYS.UP, CONFIG.KEYS.DOWN, 35, 36,
]);

/** Wires every password field under `root`, now and after re-renders. */
export function installPasswordReveal(root: HTMLElement): void {
  const previous = new WeakMap<HTMLInputElement, string>();
  const timers = new WeakMap<HTMLInputElement, ReturnType<typeof setTimeout>>();
  const fieldOf = (target: EventTarget | null): HTMLInputElement | null =>
    target instanceof HTMLInputElement && target.type === 'password'
      && target.parentElement?.classList.contains('password-field') ? target : null;

  const hide = (input: HTMLInputElement): void => {
    const timer = timers.get(input);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(input);
    const wrap = input.parentElement;
    if (!wrap?.classList.contains('revealing')) return;
    wrap.classList.remove('revealing');
    const overlay = wrap.querySelector<HTMLElement>('.password-reveal');
    if (overlay) overlay.textContent = '';
  };

  const show = (input: HTMLInputElement, index: number): void => {
    const wrap = input.parentElement!;
    const overlay = wrap.querySelector<HTMLElement>('.password-reveal');
    if (!overlay) return;
    const style = getComputedStyle(input);
    overlay.style.left = `${parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)}px`;
    overlay.style.right = `${parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)}px`;
    overlay.style.fontSize = style.fontSize;
    overlay.style.fontFamily = style.fontFamily;
    overlay.style.letterSpacing = style.letterSpacing;
    overlay.textContent = '';
    const line = document.createElement('span');
    line.className = 'password-reveal-line';
    const caret = input.selectionStart ?? input.value.length;
    for (const segment of revealSegments(input.value, index, caret)) {
      const span = document.createElement('span');
      span.className = `password-reveal-${segment.kind}`;
      if (segment.kind !== 'caret') span.textContent = segment.text;
      line.appendChild(span);
    }
    overlay.appendChild(line);
    wrap.classList.add('revealing');
    line.style.transform = `translateX(${-input.scrollLeft}px)`;
    const timer = timers.get(input);
    if (timer !== undefined) clearTimeout(timer);
    timers.set(input, setTimeout(() => hide(input), PASSWORD_REVEAL_MS));
  };

  root.addEventListener('focusin', (e) => {
    const input = fieldOf(e.target);
    if (input) previous.set(input, input.value);
  });
  root.addEventListener('input', (e) => {
    const input = fieldOf(e.target);
    if (!input) return;
    const index = insertedIndex(previous.get(input) ?? '', input.value);
    previous.set(input, input.value);
    if (index === null) hide(input);
    else show(input, index);
  });
  // Moving the caret or leaving the field masks at once.
  root.addEventListener('keydown', (e) => {
    const input = fieldOf(e.target);
    if (input && NAVIGATION_KEYS.has(e.keyCode)) hide(input);
  });
  root.addEventListener('mousedown', (e) => {
    const input = fieldOf(e.target);
    if (input) hide(input);
  });
  root.addEventListener('focusout', (e) => {
    const input = fieldOf(e.target);
    if (input) hide(input);
  });
}
