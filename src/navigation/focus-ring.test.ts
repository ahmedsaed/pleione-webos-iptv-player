// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusRing, holdRing, ringsIn, setRing } from './focus-ring';
import { SpatialNav } from './spatial-nav';
import { morph } from '../utils/morph';
import { html } from '../utils/dom';

let lower: HTMLElement;
let upper: HTMLElement;
let owner: HTMLElement | null;
let modal = false;

function item(parent: HTMLElement, key: string, cls = 'item'): HTMLElement {
  const el = document.createElement('div');
  el.className = cls;
  el.setAttribute('data-focusable', '');
  el.setAttribute('data-key', key);
  parent.appendChild(el);
  return el;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML = '';
  lower = document.createElement('div');
  upper = document.createElement('div');
  document.body.append(lower, upper);
  owner = lower;
  modal = false;
  FocusRing.install(() => ({ root: owner, modal }));
});

afterEach(() => {
  FocusRing.uninstall();
  document.documentElement.classList.remove('keyboard-nav');
});

describe('FocusRing', () => {
  it('marks the hover target it exempts, and clears the mark when the pointer leaves', () => {
    const row = item(lower, 'r1');
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    expect(row.hasAttribute('data-ring-hover')).toBe(true);
    row.dispatchEvent(new CustomEvent('nav:unhover', { bubbles: true }));
    expect(row.hasAttribute('data-ring-hover')).toBe(false);
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    morph(lower, html`<div class="item" data-focusable data-key="r1"></div>`);
    expect(lower.firstElementChild).toBe(row);
    expect(row.hasAttribute('data-ring-hover')).toBe(true);
    FocusRing.uninstall();
    expect(row.hasAttribute('data-ring-hover')).toBe(false);
  });

  it('marks only the current owner root, and whether it is modal', () => {
    FocusRing.sync();
    expect(lower.getAttribute('data-ring-owner')).toBe('');
    owner = upper;
    modal = true;
    FocusRing.sync();
    expect(lower.hasAttribute('data-ring-owner')).toBe(false);
    expect(upper.getAttribute('data-ring-owner')).toBe('modal');
    FocusRing.uninstall();
    expect(upper.hasAttribute('data-ring-owner')).toBe(false);
  });

  it('parks the ring of a surface that lost the keys and restores it when they return', () => {
    const row = item(lower, 'r1');
    setRing(row, true);
    const tile = item(upper, 't1');
    setRing(tile, true);
    owner = upper;
    FocusRing.sync();

    expect(row.className).toBe('item focused-parked');
    expect(tile.classList.contains('focused')).toBe(true);

    owner = lower;
    setRing(tile, false);
    FocusRing.sync();
    expect(row.className).toBe('item focused');
  });

  it('parks on its own as the DOM changes, before anyone paints', async () => {
    const row = item(lower, 'r1');
    setRing(row, true);
    owner = upper;
    upper.className = 'open';
    await flush();
    expect(row.classList.contains('focused')).toBe(false);
  });

  it('re-parks a ring a template re-render draws under another owner', () => {
    lower.innerHTML = '';
    const render = (focused: boolean) => morph(lower, html`
      <div class="item ${focused ? 'focused' : ''}" data-key="r1"></div>`);
    render(true);
    owner = upper;
    FocusRing.sync();
    render(true);
    FocusRing.sync();
    const row = lower.querySelector('[data-key="r1"]')!;
    expect(row.classList.contains('focused')).toBe(false);

    owner = lower;
    FocusRing.sync();
    expect(row.classList.contains('focused')).toBe(true);
  });

  it('does not bring back a parked ring its component moved away from meanwhile', () => {
    const a = item(lower, 'a');
    const b = item(lower, 'b');
    setRing(a, true);
    owner = upper;
    FocusRing.sync();

    ringsIn(lower, '.item').forEach((el) => setRing(el, false));
    setRing(b, true);
    owner = lower;
    FocusRing.sync();

    expect(ringsIn(lower)).toEqual([b]);
    expect(a.className).toBe('item');
  });

  it('drops a parked ring when a template re-render removes its focus', () => {
    const render = (key: string) => morph(lower, html`
      <div class="item ${key === 'a' ? 'focused' : ''}" data-key="a"></div>
      <div class="item ${key === 'b' ? 'focused' : ''}" data-key="b"></div>`);
    render('a');
    owner = upper;
    FocusRing.sync();
    render('b');
    owner = lower;
    FocusRing.sync();

    expect(ringsIn(lower).map((el) => el.getAttribute('data-key'))).toEqual(['b']);
  });

  it('keeps a SpatialNav ring parked through a morph re-render', () => {
    morph(lower, html`<div class="item" data-focusable data-key="a"></div>`);
    const nav = new SpatialNav(lower);
    const a = lower.querySelector<HTMLElement>('[data-key="a"]')!;
    nav.focus(a);
    owner = upper;
    FocusRing.sync();

    morph(lower, html`<div class="item" data-focusable data-key="a"></div>`);
    expect(a.className).toBe('item focused-parked');

    owner = lower;
    FocusRing.sync();
    expect(a.className).toBe('item focused');
  });

  it('lights what the pointer hovers outside the owner until a key is pressed', () => {
    const tile = item(upper, 't1');
    tile.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    setRing(tile, true);
    FocusRing.sync();
    expect(tile.classList.contains('focused')).toBe(true);

    document.documentElement.classList.add('keyboard-nav');
    FocusRing.sync();
    expect(tile.classList.contains('focused')).toBe(false);
  });

  it('keeps the hover dark behind a modal prompt', () => {
    const row = item(lower, 'r1');
    row.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    setRing(row, true);
    owner = upper;
    modal = true;
    FocusRing.sync();
    expect(row.classList.contains('focused')).toBe(false);
  });

  it('lights a ring the hovered element hands to its child', () => {
    const slot = item(upper, 'slot');
    const avatar = item(slot, 'avatar');
    slot.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    setRing(slot, true);
    setRing(avatar, true);
    FocusRing.sync();
    expect(avatar.classList.contains('focused')).toBe(true);
  });

  it('leaves every ring alone without an owner', () => {
    const tile = item(upper, 't1');
    holdRing(tile);
    setRing(tile, true);
    owner = null;
    FocusRing.sync();
    expect(tile.classList.contains('focused')).toBe(true);
  });
});
