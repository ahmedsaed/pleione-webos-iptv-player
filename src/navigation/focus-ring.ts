// One rule for every focus ring, however a component draws it: only the
// surface that receives the next key shows one. A ring outside that surface is
// parked (its class swapped for a style-less twin) and comes back unchanged
// when the keys return, so no view has to know which surface sits above it.

const FOCUSED = 'focused';
const PARKED = 'focused-parked';

// `modal`: a prompt over everything, where even the pointer's hover stays dark.
export interface RingOwner { root: Element | null; modal?: boolean }
type OwnerResolver = () => RingOwner;

// Elements a SpatialNav holds focus on: morph() must not strip their ring.
const held = new WeakSet<Element>();

// Marks the owner root so tests and on-device inspection can see who has the keys.
const OWNER_ATTR = 'data-ring-owner';
const HOVER_ATTR = 'data-ring-hover';

let resolver: OwnerResolver | null = null;
let marked: Element | null = null;
let observer: MutationObserver | null = null;
let hoverTarget: Element | null = null;
let onHover: ((e: Event) => void) | null = null;
let onUnhover: ((e: Event) => void) | null = null;

function setHoverTarget(el: Element | null): void {
  hoverTarget?.removeAttribute(HOVER_ATTR);
  hoverTarget = el;
  hoverTarget?.setAttribute(HOVER_ATTR, '');
}

export function holdRing(el: Element): void {
  held.add(el);
}

export function releaseRing(el: Element): void {
  held.delete(el);
}

/** Show or remove an element's ring; removal also drops a parked one. */
export function setRing(el: Element, on: boolean): void {
  if (on) {
    el.classList.add(FOCUSED);
    return;
  }
  el.classList.remove(FOCUSED);
  el.classList.remove(PARKED);
}

/** Elements under `scope` matching `selector` (comma list allowed) that carry a ring, shown or parked. */
export function ringsIn(scope: ParentNode, selector = ''): Element[] {
  const parts = selector ? selector.split(',').map((s) => s.trim()) : [''];
  return Array.from(scope.querySelectorAll(
    parts.map((s) => `${s}.${FOCUSED}, ${s}.${PARKED}`).join(', '),
  ));
}

/** Whether `el` carries a ring, shown or parked. */
export function hasRing(el: Element): boolean {
  return el.classList.contains(FOCUSED) || el.classList.contains(PARKED);
}

/** Whether `name` is a marker FocusRing writes, which a template never carries. */
export function isRingAttr(name: string): boolean {
  return name === OWNER_ATTR || name === HOVER_ATTR;
}

/** The template's `class` for a re-rendered node, keeping a held node's ring. */
export function keepRingClass(el: Element, next: string | null): string | null {
  if (!held.has(el)) return next;
  const kept = [FOCUSED, PARKED].filter((name) => el.classList.contains(name));
  if (!kept.length) return next;
  const tokens = (next ?? '').split(/\s+/).filter(Boolean);
  for (const name of kept) if (tokens.indexOf(name) < 0) tokens.push(name);
  return tokens.join(' ');
}

function swap(el: Element, from: string, to: string): void {
  el.classList.remove(from);
  el.classList.add(to);
}

function allowed(el: Element, owner: Element, modal: boolean): boolean {
  if (owner.contains(el)) return true;
  // The pointer may point anywhere; what it hovers stays lit until a key.
  return !modal && !!hoverTarget && hoverTarget.contains(el)
    && !document.documentElement.classList.contains('keyboard-nav');
}

export const FocusRing = {
  /** Gate rings to the root `owner()` returns; a null root leaves every ring alone. */
  install(owner: OwnerResolver): void {
    FocusRing.uninstall();
    resolver = owner;
    observer = new MutationObserver(() => FocusRing.sync());
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    onHover = (e: Event) => { setHoverTarget(e.target as Element); };
    onUnhover = (e: Event) => { if (e.target === hoverTarget) setHoverTarget(null); };
    document.addEventListener('nav:hover', onHover, true);
    document.addEventListener('nav:unhover', onUnhover, true);
    FocusRing.sync();
  },

  uninstall(): void {
    marked?.removeAttribute(OWNER_ATTR);
    marked = null;
    observer?.disconnect();
    observer = null;
    resolver = null;
    setHoverTarget(null);
    if (onHover) document.removeEventListener('nav:hover', onHover, true);
    if (onUnhover) document.removeEventListener('nav:unhover', onUnhover, true);
    onHover = null;
    onUnhover = null;
  },

  sync(): void {
    const resolved = resolver?.();
    const owner = resolved?.root ?? null;
    const modal = !!resolved?.modal;
    if (owner !== marked) {
      marked?.removeAttribute(OWNER_ATTR);
      marked = owner;
    }
    if (!owner) return;
    if (owner.getAttribute(OWNER_ATTR) !== (modal ? 'modal' : '')) {
      owner.setAttribute(OWNER_ATTR, modal ? 'modal' : '');
    }
    const shown = document.getElementsByClassName(FOCUSED);
    for (const el of Array.from(shown)) {
      if (!allowed(el, owner, modal)) swap(el, FOCUSED, PARKED);
    }
    const parked = document.getElementsByClassName(PARKED);
    for (const el of Array.from(parked)) {
      if (el.classList.contains(FOCUSED)) el.classList.remove(PARKED);
      else if (allowed(el, owner, modal)) swap(el, PARKED, FOCUSED);
    }
    // Our own swaps need no second pass.
    observer?.takeRecords();
  },
};
