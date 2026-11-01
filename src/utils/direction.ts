// Layout direction. A right-to-left locale sets <html dir="rtl"> and loads the
// build's mirrored stylesheets (css/rtl/); see docs/rtl-layout.md.
//
// Left and Right reach the app as *logical* actions: in right-to-left the
// Left key arrives as 'right' (toward the end of a row) and Right as 'left'
// (toward its start), so index-based handlers (prev/next, seek, the edge a
// panel opens from) need no direction checks. Geometric code (SpatialNav)
// turns them back into screen sides with `screenSide`.

import type { Action } from '../types';

export type HorizontalSide = 'left' | 'right';

export function isRtl(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
}

function swap<T extends string>(side: T): T {
  if (side === 'left') return 'right' as T;
  if (side === 'right') return 'left' as T;
  return side;
}

/** The action a pressed key means in the current direction. */
export function logicalAction(action: Action): Action {
  return isRtl() ? swap(action) : action;
}

/** The screen side a logical 'left' or 'right' points at (or the reverse). */
export function screenSide<T extends string>(direction: T): T {
  return isRtl() ? swap(direction) : direction;
}

/** The physical CSS side rows start from: `left` in LTR, `right` in RTL. */
export function inlineStart(): HorizontalSide {
  return isRtl() ? 'right' : 'left';
}

// Horizontal scroll offsets. Chromium 85+ reports a right-to-left scroller's
// scrollLeft as 0 at its start (the right edge) going negative; older
// engines (webOS 4-6) report the distance from the left edge, scrollWidth -
// clientWidth at the start. src/engine-quirks.ts measures which one runs
// and sets `q-rtl-scroll-default` for the old model. Read and write a
// horizontal offset only through these helpers; a relative `scrollLeft +=`
// moves the view right in both models and needs none.

let defaultModel: boolean | null = null;

function usesDefaultModel(): boolean {
  if (defaultModel === null) {
    if (typeof document === 'undefined') return false;
    defaultModel = document.documentElement.classList.contains('q-rtl-scroll-default');
  }
  return defaultModel;
}

/** For tests: forget the cached scroll model. */
export function resetScrollModel(): void {
  defaultModel = null;
}

function maxScroll(el: Element): number {
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

function elementIsRtl(el: Element): boolean {
  return isRtl() && getComputedStyle(el).direction === 'rtl';
}

/** How far `el` is scrolled from its inline start: 0 at the start, up to
 *  scrollWidth - clientWidth at its end, in either direction. */
export function scrollStart(el: Element): number {
  if (!elementIsRtl(el)) return el.scrollLeft;
  return usesDefaultModel() ? maxScroll(el) - el.scrollLeft : 0 - el.scrollLeft;
}

export function setScrollStart(el: Element, offset: number): void {
  if (!elementIsRtl(el)) {
    el.scrollLeft = offset;
    return;
  }
  el.scrollLeft = usesDefaultModel() ? maxScroll(el) - offset : 0 - offset;
}

/** How far `el` is scrolled from its left edge (0 = the left end is shown),
 *  in either direction. */
export function scrollFromLeft(el: Element): number {
  if (!elementIsRtl(el)) return el.scrollLeft;
  return usesDefaultModel() ? el.scrollLeft : maxScroll(el) + el.scrollLeft;
}

export function setScrollFromLeft(el: Element, offset: number): void {
  if (!elementIsRtl(el)) {
    el.scrollLeft = offset;
    return;
  }
  el.scrollLeft = usesDefaultModel() ? offset : offset - maxScroll(el);
}
