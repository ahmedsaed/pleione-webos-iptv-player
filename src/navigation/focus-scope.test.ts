// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Focus, Tier, type FocusScope, type ScopeSpec } from './focus-scope';
import { FocusRing, hasRing, ringsIn, setRing } from './focus-ring';
import { setInputMode } from './input-mode';
import { morph } from '../utils/morph';
import { html } from '../utils/dom';

let view: HTMLElement;
let prompt: HTMLElement;
let logs: string[];

function list(parent: HTMLElement, keys: string[]): void {
  morph(parent, html`${keys.map((k) => html`<div class="row" data-focusable data-key="${k}"></div>`)}`);
}

const row = (parent: HTMLElement, key: string) => parent.querySelector<HTMLElement>(`[data-key="${key}"]`)!;
const shown = () => Array.from(document.querySelectorAll('.focused')).map((el) => el.getAttribute('data-key'));
const repairs = () => logs.filter((l) => l.includes('event=nav.focus.repaired'));

function logical(id: string, root: HTMLElement, extra: Partial<ScopeSpec> = {}): FocusScope {
  return Focus.register({ id, root, defaultKey: () => root.querySelector('[data-key]')?.getAttribute('data-key') ?? null, ...extra });
}

function installRing(): void {
  FocusRing.install(() => {
    const owner = Focus.owner();
    return { root: owner?.root() ?? null, modal: !!owner?.modal, id: owner?.id };
  });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '';
  view = document.createElement('div');
  prompt = document.createElement('div');
  document.body.append(view, prompt);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
});

afterEach(() => {
  Focus.uninstall();
  FocusRing.uninstall();
  setInputMode('pointer');
  vi.restoreAllMocks();
});

describe('Focus owner stack', () => {
  it('puts pushed scopes above active layers, and layers above the base', () => {
    const base = Focus.register({ id: 'view.a', root: view });
    let tabBar = false;
    let menu = false;
    const bar = Focus.register({ id: 'tabbar', root: view, tier: Tier.bar });
    const dropdown = Focus.register({ id: 'menu', root: view, restrict: 'self-only', tier: Tier.overlay });
    Focus.layer(bar, () => tabBar);
    Focus.layer(dropdown, () => menu);
    Focus.setBase(() => base);
    expect(Focus.owner()).toBe(base);

    menu = true;
    expect(Focus.owner()).toBe(dropdown);
    tabBar = true;
    expect(Focus.owner()).toBe(bar);

    const confirm = Focus.register({ id: 'prompt.confirm', root: prompt, restrict: 'self-only' });
    Focus.push(confirm);
    expect(Focus.owner()).toBe(confirm);
    expect(confirm.modal).toBe(true);
    expect(bar.modal).toBe(false);
    Focus.pop(confirm);
    Focus.pop(confirm);
    expect(Focus.owner()).toBe(bar);
  });

  it('keeps a higher tier on top of a later push, such as the PIN over a timed prompt', () => {
    const pin = Focus.register({ id: 'prompt.pin', root: prompt, restrict: 'self-only', tier: Tier.critical });
    const reminder = Focus.register({ id: 'prompt.reminder', root: prompt, restrict: 'self-only' });
    const menu = Focus.register({ id: 'menu', root: view });
    Focus.push(pin);
    Focus.push(reminder);
    Focus.push(menu);
    expect(Focus.owner()).toBe(pin);
    Focus.pop(pin);
    expect(Focus.owner()).toBe(reminder);
  });

  it('ranks layers by tier before registration order', () => {
    const history = Focus.register({ id: 'search.history', root: view, restrict: 'self-only', tier: Tier.overlay });
    const bar = Focus.register({ id: 'tabbar', root: view, tier: Tier.bar });
    Focus.layer(history, () => true);
    Focus.layer(bar, () => true);
    expect(Focus.owner()).toBe(bar);
    const confirm = Focus.register({ id: 'prompt.confirm', root: prompt, restrict: 'self-only' });
    Focus.push(confirm);
    expect(Focus.owner()).toBe(confirm);
    const overlay = Focus.register({ id: 'player.menu', root: prompt });
    Focus.push(overlay);
    expect(Focus.owner()).toBe(confirm);
  });

  it('skips a pushed scope while its view is not shown, and restores it after', () => {
    let shownView = 'player';
    const base = Focus.register({ id: 'view.a', root: view });
    Focus.setBase(() => base);
    const menu = Focus.register({ id: 'player.menu', root: prompt, when: () => shownView === 'player' });
    Focus.push(menu);
    expect(Focus.owner()).toBe(menu);
    shownView = 'channels';
    expect(Focus.owner()).toBe(base);
    shownView = 'player';
    expect(Focus.owner()).toBe(menu);
  });

  it('returns to the scope below when the top one pops', () => {
    const a = Focus.register({ id: 'a', root: view });
    const b = Focus.register({ id: 'b', root: prompt });
    Focus.push(a);
    Focus.push(b);
    Focus.push(a);
    expect(Focus.owner()).toBe(a);
    Focus.pop(a);
    expect(Focus.owner()).toBe(b);
    b.dispose();
    expect(Focus.owner()).toBeNull();
  });

  it('routes keys to the owner only when it has a handler', () => {
    const onAction = vi.fn();
    const withHandler = Focus.register({ id: 'prompt.pin', root: prompt, onAction });
    const without = Focus.register({ id: 'view.a', root: view });
    expect(withHandler.handle('select')).toBe(true);
    expect(onAction).toHaveBeenCalledWith('select', undefined);
    expect(without.handle('select')).toBe(false);
  });

  it('rejects a second scope with the same id', () => {
    Focus.register({ id: 'a', root: view });
    expect(() => Focus.register({ id: 'a', root: prompt })).toThrow(/already registered/);
  });

  it('marks the owner root with its scope id for FocusRing', () => {
    const a = Focus.register({ id: 'view.a', root: view });
    const p = Focus.register({ id: 'prompt.confirm', root: prompt, restrict: 'self-only' });
    Focus.setBase(() => a);
    installRing();
    expect(view.getAttribute('data-focus-scope')).toBe('view.a');
    Focus.push(p);
    FocusRing.sync();
    expect(view.hasAttribute('data-focus-scope')).toBe(false);
    expect(prompt.getAttribute('data-focus-scope')).toBe('prompt.confirm');
    expect(prompt.getAttribute('data-ring-owner')).toBe('modal');
  });
});

describe('Focus reconcile', () => {
  it('leaves an unmigrated owner\'s rings to its component', async () => {
    list(view, ['r1', 'r2']);
    setRing(row(view, 'r1'), true);
    setRing(row(view, 'r2'), true);
    const a = Focus.register({ id: 'view.a', root: view });
    Focus.setBase(() => a);
    Focus.reconcile();
    await Promise.resolve();
    expect(shown()).toEqual(['r1', 'r2']);
    expect(view.hasAttribute('data-focus-unresolved')).toBe(false);
    expect(repairs()).toEqual([]);
  });

  it('paints the ring on the focus key, once per microtask however often asked', async () => {
    list(view, ['r1', 'r2']);
    const resolve = vi.fn((key: string) => row(view, key));
    const a = logical('live.channels', view, { resolve });
    Focus.setBase(() => a);
    a.focus('r2', 'key');
    Focus.reconcile();
    Focus.reconcile();
    expect(shown()).toEqual([]);
    await Promise.resolve();
    expect(shown()).toEqual(['r2']);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('moves the ring with the key without reporting a repair', () => {
    list(view, ['r1', 'r2']);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    a.focus('r1', 'key');
    Focus.flush();
    a.focus('r2', 'key');
    Focus.flush();
    expect(shown()).toEqual(['r2']);
    expect(repairs()).toEqual([]);
  });

  it('keeps the ring on the key across a re-render that replaces the node', () => {
    list(view, ['r1', 'r2']);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    a.focus('r2', 'key');
    Focus.flush();
    view.innerHTML = '';
    list(view, ['r0', 'r1', 'r2']);
    Focus.flush();
    expect(shown()).toEqual(['r2']);
    expect(repairs()).toEqual([]);
  });

  it('falls back to the entry point when the key no longer resolves', () => {
    list(view, ['r1', 'r2']);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    a.focus('r2', 'key');
    Focus.flush();
    list(view, ['r1']);
    Focus.flush();
    expect(a.focusKey).toBe('r1');
    expect(shown()).toEqual(['r1']);
    expect(repairs()).toEqual([expect.stringContaining('reason=unresolved scope=live.channels')]);
  });

  it('marks the owner root when not even the entry point resolves', () => {
    const a = logical('live.channels', view, { defaultKey: () => 'gone' });
    Focus.setBase(() => a);
    a.focus('missing', 'key');
    Focus.flush();
    expect(view.hasAttribute('data-focus-unresolved')).toBe(true);
    list(view, ['gone']);
    Focus.flush();
    expect(view.hasAttribute('data-focus-unresolved')).toBe(false);
    expect(shown()).toEqual(['gone']);
  });

  it('refuses a key that resolves outside the owner root', () => {
    list(view, ['r1']);
    list(prompt, ['p1']);
    const a = logical('live.channels', view, { resolve: (key) => document.querySelector(`[data-key="${key}"]`) });
    Focus.setBase(() => a);
    a.focus('p1', 'key');
    Focus.flush();
    expect(shown()).toEqual(['r1']);
    expect(repairs()).toEqual([expect.stringContaining('reason=outside_owner scope=live.channels')]);
  });

  it('clears a ring another writer left in the owner and reports it', () => {
    list(view, ['r1', 'r2']);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    a.focus('r1', 'key');
    Focus.flush();
    setRing(row(view, 'r2'), true);
    Focus.reconcile();
    Focus.flush();
    expect(shown()).toEqual(['r1']);
    expect(repairs()).toEqual([expect.stringContaining('reason=two_rings scope=live.channels')]);
  });

  it('applies the enter rule for how focus arrives', () => {
    list(view, ['r1', 'r2']);
    const a = logical('guide.grid', view, { enterTo: (via) => (via === 'key' ? 'default' : 'last') });
    Focus.setBase(() => a);
    a.focus('r2', 'key');
    a.enter('back');
    expect(a.focusKey).toBe('r2');
    a.enter('key');
    expect(a.focusKey).toBe('r1');
  });

  it('leaves the ring parked while a pointer entry defers it', () => {
    list(view, ['r1']);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    installRing();
    FocusRing.defer('channels');
    a.focus('r1', 'key');
    Focus.flush();
    expect(shown()).toEqual([]);
    expect(hasRing(row(view, 'r1'))).toBe(true);
    expect(FocusRing.reveal('key', 'down', true)).toBe(true);
    expect(shown()).toEqual(['r1']);
  });

  it('paints when a layer takes the keys without any input', async () => {
    list(view, ['r1']);
    list(prompt, ['p1']);
    const a = Focus.register({ id: 'view.a', root: view });
    const sidebar = logical('player.sidebar', prompt);
    let open = false;
    Focus.layer(sidebar, () => open);
    Focus.setBase(() => a);
    installRing();
    await Promise.resolve();
    open = true;
    // What a class change (the sidebar sliding in) does through the observer.
    FocusRing.sync();
    await Promise.resolve();
    expect(shown()).toEqual(['p1']);
  });

  it('finds a key that needs escaping, such as a quote or a line break', () => {
    const key = 'a"b\\c\nd';
    const el = document.createElement('div');
    el.setAttribute('data-key', key);
    view.appendChild(el);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    a.focus(key, 'key');
    Focus.flush();
    expect(el.classList.contains('focused')).toBe(true);
    expect(repairs()).toEqual([]);
  });

  it('escapes keys with CSS.escape where the engine has it', () => {
    list(view, ['r1']);
    const escape = vi.fn((s: string) => s);
    vi.stubGlobal('CSS', { escape });
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    a.focus('r1', 'key');
    Focus.flush();
    vi.unstubAllGlobals();
    expect(escape).toHaveBeenCalledWith('r1');
  });

  it('re-gates rings at once, so a modal above parks the view\'s ring', () => {
    list(view, ['r1']);
    list(prompt, ['p1']);
    const a = logical('live.channels', view);
    const p = logical('prompt.confirm', prompt, { restrict: 'self-only' });
    Focus.setBase(() => a);
    installRing();
    a.focus('r1', 'key');
    Focus.flush();
    Focus.push(p);
    Focus.flush();
    expect(shown()).toEqual(['p1']);
    expect(ringsIn(view)).toHaveLength(1);
    Focus.pop(p);
    Focus.flush();
    FocusRing.sync();
    expect(shown()).toEqual(['r1']);
  });

  it('reconciles after a morph into the owner root', async () => {
    list(view, ['r1', 'r2']);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    a.focus('r2', 'key');
    Focus.flush();
    view.innerHTML = '';
    morph(view, html`<div data-key="r2"></div>`);
    await Promise.resolve();
    expect(shown()).toEqual(['r2']);
  });

  it('reconciles after a pointer hover once installed', async () => {
    list(view, ['r1', 'r2']);
    const a = logical('live.channels', view);
    Focus.setBase(() => a);
    Focus.install();
    view.addEventListener('nav:hover', (e) => {
      a.focus((e.target as HTMLElement).getAttribute('data-key'), 'pointer');
    });
    row(view, 'r2').dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    await Promise.resolve();
    expect(shown()).toEqual(['r2']);
  });

  describe('keeping the ring in view', () => {
    let scroller: HTMLElement;
    let clip = true;
    beforeEach(() => {
      clip = true;
      scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      view.appendChild(scroller);
      list(scroller, ['r1', 'r2']);
      vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
      Object.defineProperty(scroller, 'clientWidth', { value: 100 });
      Object.defineProperty(scroller, 'clientHeight', { value: 100 });
      for (const el of Array.from(scroller.children)) {
        vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, clip ? 90 : 10, 100, 40));
      }
      Element.prototype.scrollIntoView = vi.fn(() => { clip = false; });
    });

    it('reveals a clipped ring in key mode through the polyfilled call', () => {
      setInputMode('keys');
      const a = logical('live.channels', view);
      Focus.setBase(() => a);
      a.focus('r2', 'key');
      Focus.flush();
      expect(row(scroller, 'r2').scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      // A move onto a clipped key is routine; only a clip of unchanged focus is reported.
      expect(repairs()).toEqual([]);
    });

    it('reports a clip of unchanged focus, such as a key that moved nothing', () => {
      setInputMode('keys');
      const a = logical('live.channels', view);
      Focus.setBase(() => a);
      clip = false;
      a.focus('r2', 'key');
      Focus.flush();
      clip = true;
      a.focus('r2', 'key');
      Focus.flush();
      expect(row(scroller, 'r2').scrollIntoView).toHaveBeenCalledTimes(1);
      expect(repairs()).toEqual([expect.stringContaining('reason=clipped scope=live.channels')]);
    });

    it('uses the scope\'s own reveal when it has one', () => {
      setInputMode('keys');
      const reveal = vi.fn();
      const a = logical('live.channels', view, { reveal });
      Focus.setBase(() => a);
      a.focus('r2', 'key');
      Focus.flush();
      expect(reveal).toHaveBeenCalledWith('r2');
      expect(row(scroller, 'r2').scrollIntoView).not.toHaveBeenCalled();
    });

    it('lets the pointer light a clipped item where it is, and a later key reveal it', () => {
      const a = logical('live.channels', view);
      Focus.setBase(() => a);
      // A hover: KeyHandler switches to the pointer, then the item takes focus.
      setInputMode('pointer');
      a.focus('r2', 'pointer');
      Focus.input();
      Focus.flush();
      expect(row(scroller, 'r2').scrollIntoView).not.toHaveBeenCalled();
      // A key that moves nothing still brings the ring into view.
      setInputMode('keys');
      Focus.input();
      Focus.flush();
      expect(row(scroller, 'r2').scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('does not chase a smooth scroll from re-renders, nor log each frame', () => {
      setInputMode('keys');
      Element.prototype.scrollIntoView = vi.fn();
      const a = logical('live.channels', view);
      Focus.setBase(() => a);
      a.focus('r2', 'key');
      Focus.flush();
      // Still clipped while the scroll animates; each frame may re-render.
      for (let i = 0; i < 3; i++) {
        Focus.afterMorph(scroller);
        Focus.flush();
      }
      expect(row(scroller, 'r2').scrollIntoView).toHaveBeenCalledTimes(1);
      expect(repairs()).toEqual([]);
    });
  });
});
