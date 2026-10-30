import { DEFAULT_INTERFACE_SIZE, isValidInterfaceSize } from '../config/themes';

// The Interface size factor, read from the same `data-interface-size` that
// picks the stylesheet set, so JS layout math always matches the CSS.
export function uiScale(): number {
  if (typeof document === 'undefined') return 1;
  const size = document.documentElement.dataset.interfaceSize;
  return isValidInterfaceSize(size) ? Number(size) / 100 : 1;
}

/** A length designed in 1920x1080 px, at the current Interface size. */
export function uiPx(px: number): number {
  return px * uiScale();
}

// The Text size factor (`--font-scale`), read from the `data-text-size` the
// theme service sets: a box that holds text grows with it.
export function textScale(): number {
  if (typeof document === 'undefined') return 1;
  const size = Number(document.documentElement.dataset.textSize);
  return size > 0 ? size / 100 : 1;
}

/** A text-holding length designed in 1920x1080 px, at the current Interface and Text size. */
export function uiTextPx(px: number): number {
  return px * uiScale() * textScale();
}

const SHEET_RE = /^css\/(?:ui-\d+\/)?([\w.-]+\.css)$/;

/** Points every app stylesheet at the build's copy for `size` (css/ui-<size>/,
 *  or css/ for the default). Each new sheet loads beside the one it replaces,
 *  which is removed only once it has loaded, so a switch never paints
 *  unstyled. */
export function swapInterfaceStylesheets(size: string): void {
  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  for (const link of links) {
    const match = SHEET_RE.exec(link.getAttribute('href') ?? '');
    if (!match || link.dataset.retiring) continue;
    const file = match[1];
    const href = size === DEFAULT_INTERFACE_SIZE ? `css/${file}` : `css/ui-${size}/${file}`;
    if (link.getAttribute('href') === href) continue;
    const next = link.cloneNode() as HTMLLinkElement;
    next.setAttribute('href', href);
    link.dataset.retiring = 'true';
    // A later switch may land first, so retire every older copy of the file.
    const retire = () => {
      document.querySelectorAll<HTMLLinkElement>('link[data-retiring]').forEach((old) => {
        if (SHEET_RE.exec(old.getAttribute('href') ?? '')?.[1] === file) old.remove();
      });
    };
    next.addEventListener('load', retire);
    next.addEventListener('error', retire);
    link.parentNode?.insertBefore(next, link.nextSibling);
  }
}
