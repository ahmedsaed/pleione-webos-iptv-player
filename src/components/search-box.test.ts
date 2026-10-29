// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SearchBox } from './search-box';
import { Focus, Tier } from '../navigation/focus-scope';

let host: HTMLElement;
let box: SearchBox;
let handlers: { onQuery: ReturnType<typeof vi.fn>; onLeave: ReturnType<typeof vi.fn>; onBack: ReturnType<typeof vi.fn> };

const input = () => host.querySelector<HTMLInputElement>('.search-box-input')!;
const key = (k: string) => input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host')!;
  // jsdom lays nothing out; the box counts as shown.
  host.getClientRects = () => [{}] as unknown as DOMRectList;
  handlers = { onQuery: vi.fn(), onLeave: vi.fn(() => true), onBack: vi.fn() };
  box = new SearchBox(host, handlers);
  Focus.install();
});

afterEach(() => Focus.uninstall());

describe('SearchBox', () => {
  it('takes the keys with the caret and draws no ring', () => {
    box.focus();
    expect(document.activeElement).toBe(input());
    expect(Focus.owner()?.id).toBe('search.box');
    expect(Focus.owner()?.logical).toBe(false);
    expect(host.querySelector('.search-box.active')).not.toBeNull();
  });

  it('reports typing', () => {
    box.focus();
    input().value = 'ab';
    input().dispatchEvent(new Event('input'));
    expect(handlers.onQuery).toHaveBeenCalledWith('ab');
  });

  it('Down and Enter hand the keys to what is below', () => {
    box.focus();
    key('ArrowDown');
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
    expect(Focus.owner()).toBeNull();
    expect(document.activeElement).not.toBe(input());
    box.focus();
    key('Enter');
    expect(handlers.onLeave).toHaveBeenCalledTimes(2);
  });

  it('keeps the caret when nothing below takes the keys', () => {
    handlers.onLeave.mockReturnValue(false);
    box.focus();
    key('ArrowDown');
    expect(Focus.owner()?.id).toBe('search.box');
    expect(document.activeElement).toBe(input());
  });

  it('Escape and Back are the host\'s Back', () => {
    box.focus();
    key('Escape');
    expect(handlers.onBack).toHaveBeenCalledTimes(1);
    box.release();
    box.focus();
    input().blur();
    Focus.owner()?.handle('back');
    expect(handlers.onBack).toHaveBeenCalledTimes(2);
  });

  it('gives its caret up under a scope above and takes it back after', () => {
    box.focus();
    Focus.owner();
    const menuRoot = document.createElement('div');
    document.body.appendChild(menuRoot);
    const menu = Focus.register({ id: 'test.menu', root: menuRoot, tier: Tier.menu, restrict: 'self-only' });
    Focus.push(menu);
    expect(Focus.owner()?.id).toBe('test.menu');
    expect(document.activeElement).not.toBe(input());
    Focus.pop(menu);
    expect(Focus.owner()?.id).toBe('search.box');
    expect(document.activeElement).toBe(input());
  });

  it('a click into the box takes the keys', () => {
    input().focus();
    expect(Focus.owner()?.id).toBe('search.box');
    expect(box.focused).toBe(true);
  });

  it('names what it searches', () => {
    box.setPlaceholder(true);
    const all = input().placeholder;
    box.setPlaceholder(false);
    expect(input().placeholder).not.toBe(all);
    expect(input().placeholder).not.toBe('');
  });
});
