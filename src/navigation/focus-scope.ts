// Focus scopes and the owner stack: who gets the next key, and, for a scope
// that holds logical focus, which element carries the ring. A scope holds its
// focus as a key, never a node, so a re-render or a recycled row cannot strand
// it; the reconcile pass after each input paints the one ring and keeps it in
// view.
//
// A scope without `defaultKey` is not migrated yet: its component still paints
// its own ring, which FocusRing gates, and reconcile leaves it alone.

import type { Action, NumberEvent } from '../types';
import { createLogger } from '../utils/logger';
import { FocusRing, hasRing, ringShown, ringsIn, setRing, UNRESOLVED_ATTR } from './focus-ring';
import { InputMode } from './input-mode';

const log = createLogger('Focus');

export type Via = 'key' | 'pointer' | 'resume' | 'back';
export type EnterTo = 'last' | 'default';

// Who wins when several scopes want the keys: the higher tier, then within a
// tier the latest push, then layers in registration order.
export const Tier = {
  overlay: 10,  // dropdowns and player overlays
  bar: 20,      // the tab bar
  prompt: 30,   // modal prompts
  critical: 40, // the parental PIN, which must outrank a prompt that a timer raises
} as const;
type RepairReason = 'two_rings' | 'outside_owner' | 'unresolved' | 'clipped';

export interface ScopeSpec {
  id: string;
  root: HTMLElement | (() => HTMLElement | null);
  // `self-only`: a modal that keeps every key and keeps hover outside it dark.
  restrict?: 'self-only' | 'self-first';
  // Defaults to `prompt` for a self-only scope, else `overlay`.
  tier?: number;
  // A pushed or layered scope counts only while this holds, such as while
  // its view is the shown one; it keeps its place on the stack meanwhile.
  when?: () => boolean;
  // Takes the keys while the scope owns them; without it the shown view routes them.
  onAction?: (action: Action, event?: NumberEvent) => void;
  defaultKey?: () => string | null;
  enterTo?: EnterTo | ((via: Via) => EnterTo);
  resolve?: (key: string) => HTMLElement | null;
  reveal?: (key: string) => void;
}

export interface FocusScope {
  readonly id: string;
  readonly modal: boolean;
  readonly logical: boolean;
  readonly focusKey: string | null;
  root(): HTMLElement | null;
  /** Route `action` to the scope; false when it has no handler of its own. */
  handle(action: Action, event?: NumberEvent): boolean;
  /** Request focus on `key`; reconcile paints it. */
  focus(key: string | null, via: Via): void;
  /** Apply the scope's `enterTo` rule. */
  enter(via: Via): void;
  dispose(): void;
}

// jsdom has no CSS.escape; the fallback covers what a quoted string needs.
function cssString(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  return s.replace(/[\0-\x1f\x7f"\\]/g, (c) =>
    (c === '"' || c === '\\' ? `\\${c}` : `\\${c.charCodeAt(0).toString(16)} `));
}

function byKey(root: HTMLElement, key: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-key="${cssString(key)}"]`);
}

// Whether the element sits partly outside the viewport or a clipping
// ancestor; an element larger than its scroller only has to fill it.
function clipped(el: Element): boolean {
  const r = el.getBoundingClientRect();
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const b = n.getBoundingClientRect();
    if (s.overflowX !== 'visible') {
      left = Math.max(left, b.left + n.clientLeft);
      right = Math.min(right, b.left + n.clientLeft + n.clientWidth);
    }
    if (s.overflowY !== 'visible') {
      top = Math.max(top, b.top + n.clientTop);
      bottom = Math.min(bottom, b.top + n.clientTop + n.clientHeight);
    }
    if (s.position === 'fixed') break;
  }
  if (right <= left || bottom <= top) return false;
  const slack = 1;
  const w = Math.min(r.right, right) - Math.max(r.left, left);
  const h = Math.min(r.bottom, bottom) - Math.max(r.top, top);
  return w < Math.min(r.width, right - left) - slack || h < Math.min(r.height, bottom - top) - slack;
}

class Scope implements FocusScope {
  focusKey: string | null = null;
  // The ring reconcile painted, so a ring anyone else left in the root shows.
  painted: Element | null = null;
  // The key the last reconcile settled on, so a clip of unchanged focus shows.
  settledKey: string | null = null;

  constructor(readonly spec: ScopeSpec) {}

  get id(): string { return this.spec.id; }
  get modal(): boolean { return this.spec.restrict === 'self-only'; }
  get tier(): number { return this.spec.tier ?? (this.modal ? Tier.prompt : Tier.overlay); }
  get live(): boolean { return this.spec.when ? this.spec.when() : true; }
  get logical(): boolean { return this.spec.defaultKey !== undefined; }

  root(): HTMLElement | null {
    const r = this.spec.root;
    return typeof r === 'function' ? r() : r;
  }

  element(key: string): HTMLElement | null {
    if (this.spec.resolve) return this.spec.resolve(key);
    const root = this.root();
    return root ? byKey(root, key) : null;
  }

  handle(action: Action, event?: NumberEvent): boolean {
    if (!this.spec.onAction) return false;
    this.spec.onAction(action, event);
    return true;
  }

  focus(key: string | null, via: Via): void {
    this.focusKey = key;
    // A pointer request lights the item where it is; any other may reveal it.
    if (via !== 'pointer') revealWanted = true;
    Focus.reconcile();
  }

  enter(via: Via): void {
    const rule = typeof this.spec.enterTo === 'function'
      ? this.spec.enterTo(via) : this.spec.enterTo ?? 'last';
    const keep = rule === 'last' && this.focusKey !== null && this.element(this.focusKey) !== null;
    this.focus(keep ? this.focusKey : this.spec.defaultKey?.() ?? null, via);
  }

  dispose(): void {
    Focus.pop(this);
    layers = layers.filter((layer) => layer.scope !== this);
    registry.delete(this.id);
    if (this.painted) setRing(this.painted, false);
    this.painted = null;
  }
}

const registry = new Map<string, Scope>();
let stack: Scope[] = [];
let layers: { scope: Scope; active: () => boolean }[] = [];
let base: (() => FocusScope | null) | null = null;
let scheduled = false;
let listening = false;
// Set by an input or a focus request, so only those may scroll the ring into
// view; a pass after a re-render (or mid smooth scroll) never does.
let revealWanted = false;
let lastOwner: string | null = null;

function repaired(reason: RepairReason, scope: Scope): void {
  log.debug('Focus repaired', 'event=nav.focus.repaired', `reason=${reason}`, `scope=${scope.id}`);
}

function run(): void {
  const reveal = revealWanted;
  revealWanted = false;
  const owner = Focus.owner() as Scope | null;
  if (!owner || !owner.logical) return;
  const root = owner.root();
  if (!root) return;

  let key = owner.focusKey;
  let el = key !== null ? owner.element(key) : null;
  let reason: RepairReason | null = null;
  if (el && !root.contains(el)) {
    el = null;
    reason = 'outside_owner';
  } else if (key !== null && !el) {
    reason = 'unresolved';
  }
  if (!el) {
    key = owner.spec.defaultKey!();
    const next = key !== null ? owner.element(key) : null;
    el = next && root.contains(next) ? next : null;
  }
  if (reason) repaired(reason, owner);
  owner.focusKey = key;
  if (key !== null && !el) root.setAttribute(UNRESOLVED_ATTR, '');
  else root.removeAttribute(UNRESOLVED_ATTR);

  let stray = false;
  for (const other of ringsIn(root)) {
    if (other === el) continue;
    if (other !== owner.painted && ringShown(other)) stray = true;
    setRing(other, false);
  }
  if (stray) repaired('two_rings', owner);
  if (el && !hasRing(el)) setRing(el, true);
  owner.painted = el;
  FocusRing.sync();

  const unchanged = key === owner.settledKey;
  owner.settledKey = key;
  if (!reveal || !el || key === null || FocusRing.deferred) return;
  if (InputMode.current !== 'keys' || !clipped(el)) return;
  if (owner.spec.reveal) owner.spec.reveal(key);
  // The polyfill makes this mean `nearest` on Chromium 53 too.
  else el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (unchanged) repaired('clipped', owner);
}

function onInput(): void {
  Focus.input();
}

export const Focus = {
  register(spec: ScopeSpec): FocusScope {
    if (registry.has(spec.id)) throw new Error(`Focus scope ${spec.id} is already registered`);
    const scope = new Scope(spec);
    registry.set(spec.id, scope);
    return scope;
  },

  /** A scope shown above the view: the owner until popped, unless a higher tier is up. */
  push(scope: FocusScope): void {
    const s = scope as Scope;
    stack = stack.filter((entry) => entry !== s);
    stack.push(s);
    Focus.reconcile();
  },

  pop(scope: FocusScope): void {
    const before = stack.length;
    stack = stack.filter((entry) => entry !== scope);
    if (stack.length !== before) Focus.reconcile();
  },

  /**
   * A scope that owns the keys while `active()` holds, below pushed scopes of
   * its tier and below the layers registered before it. For components that
   * do not push and pop themselves yet.
   */
  layer(scope: FocusScope, active: () => boolean): void {
    layers.push({ scope: scope as Scope, active });
  },

  /** The scope that owns the keys when nothing above it does: the shown view. */
  setBase(resolve: () => FocusScope | null): void {
    base = resolve;
  },

  owner(): FocusScope | null {
    let best: Scope | null = null;
    for (let i = stack.length - 1; i >= 0; i--) {
      const s = stack[i];
      if (s.live && (!best || s.tier > best.tier)) best = s;
    }
    for (const layer of layers) {
      const s = layer.scope;
      if ((!best || s.tier > best.tier) && layer.active() && s.live) best = s;
    }
    const owner = best ?? (base ? base() : null);
    // A layer or a `when` can change the owner without a push, a pop, or an
    // input: whoever asks first (FocusRing.sync) triggers the pass.
    const id = owner ? owner.id : null;
    if (id !== lastOwner) {
      lastOwner = id;
      Focus.reconcile();
    }
    return owner;
  },

  /** Note an input (key, hover, click, wheel): the next pass may reveal the ring. */
  input(): void {
    revealWanted = true;
    Focus.reconcile();
  },

  /** Run the reconcile pass once, in a microtask, however often it is asked for. */
  reconcile(): void {
    if (scheduled) return;
    scheduled = true;
    void Promise.resolve().then(() => {
      if (!scheduled) return;
      scheduled = false;
      run();
    });
  },

  /** Run a pending reconcile now. */
  flush(): void {
    if (!scheduled) return;
    scheduled = false;
    run();
  },

  /** Note a morph() into `parent`, which may have replaced the owner's ring. */
  afterMorph(parent: Element): void {
    const owner = Focus.owner();
    if (!owner?.logical) return;
    const root = owner.root();
    if (root && (root.contains(parent) || parent.contains(root))) Focus.reconcile();
  },

  /** Reconcile after the pointer inputs that can move focus; keys come from the host. */
  install(): void {
    if (listening) return;
    listening = true;
    document.addEventListener('nav:hover', onInput);
    document.addEventListener('click', onInput);
    document.addEventListener('wheel', onInput);
  },

  uninstall(): void {
    if (listening) {
      document.removeEventListener('nav:hover', onInput);
      document.removeEventListener('click', onInput);
      document.removeEventListener('wheel', onInput);
    }
    listening = false;
    for (const scope of Array.from(registry.values())) scope.dispose();
    stack = [];
    layers = [];
    base = null;
    scheduled = false;
    revealWanted = false;
    lastOwner = null;
  },
};
