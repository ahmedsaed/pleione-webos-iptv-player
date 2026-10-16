// One rule for every focus ring, however a component draws it: only the
// surface that receives the next key shows one. A ring outside that surface is
// parked (its class swapped for a style-less twin) and comes back unchanged
// when the keys return, so no view has to know which surface sits above it.

import { createLogger } from '../utils/logger';

const log = createLogger('FocusRing');

const FOCUSED = 'focused';
const PARKED = 'focused-parked';

// `modal`: a prompt over everything, where even the pointer's hover stays dark.
export interface RingOwner { root: Element | null; modal?: boolean }
type OwnerResolver = () => RingOwner;

// Elements a SpatialNav holds focus on: morph() must not strip their ring.
const held = new WeakSet<Element>();

// Marks the owner root so tests and on-device inspection can see who has the
// keys: empty, `modal`, or `deferred` while its own ring waits.
const OWNER_ATTR = 'data-ring-owner';
const HOVER_ATTR = 'data-ring-hover';

let resolver: OwnerResolver | null = null;
let marked: Element | null = null;
let observer: MutationObserver | null = null;
let hoverTarget: Element | null = null;
let onHover: ((e: Event) => void) | null = null;
let onUnhover: ((e: Event) => void) | null = null;
let onWheel: (() => void) | null = null;
let onPress: ((e: Event) => void) | null = null;
// An owner entered by the pointer keeps its focus but parks the ring until the
// remote, the wheel, or the pointer on it shows where that focus is.
let deferredRoot: Element | null = null;

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
  if (owner.contains(el)) return owner !== deferredRoot;
  // The pointer may point anywhere; what it hovers stays lit until a key.
  // Hover never moves the keys, except that TabBar releases them to hovered content.
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
    onHover = (e: Event) => {
      setHoverTarget(e.target as Element);
      if (hoverTarget && deferredRoot?.contains(hoverTarget)) FocusRing.reveal('hover');
    };
    onUnhover = (e: Event) => { if (e.target === hoverTarget) setHoverTarget(null); };
    // Before KeyHandler turns the step into an action, so it acts from a shown focus.
    onWheel = () => { if (deferredRoot) FocusRing.reveal('wheel'); };
    // Before the view's click handler, which may focus the item without a hover.
    onPress = (e: Event) => {
      if (e.target instanceof Node && deferredRoot?.contains(e.target)) FocusRing.reveal('pointer');
    };
    document.addEventListener('nav:hover', onHover, true);
    document.addEventListener('nav:unhover', onUnhover, true);
    document.addEventListener('wheel', onWheel, true);
    document.addEventListener('mousedown', onPress, true);
    FocusRing.sync();
  },

  uninstall(): void {
    marked?.removeAttribute(OWNER_ATTR);
    marked = null;
    observer?.disconnect();
    observer = null;
    resolver = null;
    deferredRoot = null;
    setHoverTarget(null);
    if (onHover) document.removeEventListener('nav:hover', onHover, true);
    if (onUnhover) document.removeEventListener('nav:unhover', onUnhover, true);
    if (onWheel) document.removeEventListener('wheel', onWheel, true);
    if (onPress) document.removeEventListener('mousedown', onPress, true);
    onHover = null;
    onUnhover = null;
    onWheel = null;
    onPress = null;
  },

  /** Park the current owner's own ring until a key, the wheel, or the pointer on it; ends with the owner. */
  defer(view: string): void {
    const resolved = resolver?.();
    if (!resolved?.root || resolved.modal) return;
    deferredRoot = resolved.root;
    log.debug('Focus ring deferred', 'event=nav.focus.deferred', `view=${view}`);
    FocusRing.sync();
  },

  get deferred(): boolean {
    return deferredRoot !== null;
  },

  /**
   * End a deferral and show the parked focus. With `consume`, true when there
   * was a ring to show, so the key that showed it should do nothing else.
   */
  reveal(via: 'key' | 'hover' | 'wheel' | 'pointer', action = '', consume = false): boolean {
    if (!deferredRoot) return false;
    // A key that moved the keys elsewhere showed nothing here; the MutationObserver
    // has not run sync() yet.
    if (resolver?.()?.root !== deferredRoot) {
      deferredRoot = null;
      FocusRing.sync();
      return false;
    }
    const hidden = deferredRoot.getElementsByClassName(PARKED).length > 0;
    deferredRoot = null;
    const consumed = consume && hidden;
    const fields = via === 'key' ? [`action=${action}`, `consumed=${consumed ? 'yes' : 'no'}`] : [];
    log.debug('Focus ring shown', 'event=nav.focus.shown', `via=${via}`, ...fields);
    FocusRing.sync();
    return consumed;
  },

  sync(): void {
    const resolved = resolver?.();
    const owner = resolved?.root ?? null;
    const modal = !!resolved?.modal;
    // A deferral belongs to the owner it was made for: a view switch, the
    // player, or an overlay ends it.
    if (deferredRoot && deferredRoot !== owner) deferredRoot = null;
    if (owner !== marked) {
      marked?.removeAttribute(OWNER_ATTR);
      marked = owner;
    }
    if (!owner) return;
    const mark = modal ? 'modal' : owner === deferredRoot ? 'deferred' : '';
    if (owner.getAttribute(OWNER_ATTR) !== mark) owner.setAttribute(OWNER_ATTR, mark);
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
