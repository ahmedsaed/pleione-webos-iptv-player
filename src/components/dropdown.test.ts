// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { morph } from '../utils/morph';
import { dropdown, placeDropdownMenu } from './dropdown';

// jsdom has no layout, so each box is stubbed: a pane clipped at 100..700,
// a 54px trigger and a 340px menu 6px below it.
function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top } as DOMRect;
}

describe('placeDropdownMenu', () => {
  let pane: HTMLElement;
  let dd: HTMLElement;

  const layout = (triggerTop: number): void => {
    const trigger = dd.querySelector<HTMLElement>('.dropdown-trigger')!;
    const menu = dd.querySelector<HTMLElement>('.dropdown-menu')!;
    const scrolled = () => triggerTop - pane.scrollTop;
    trigger.getBoundingClientRect = () => rect(scrolled(), 54);
    menu.getBoundingClientRect = () => dd.classList.contains('drop-up')
      ? rect(scrolled() - 346, 340)
      : rect(scrolled() + 60, 340);
  };

  beforeEach(() => {
    pane = document.createElement('div');
    pane.style.overflowY = 'auto';
    pane.getBoundingClientRect = () => rect(100, 600);
    Object.defineProperty(pane, 'clientHeight', { value: 600 });
    morph(pane, dropdown('dd', [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'a'));
    document.body.appendChild(pane);
    dd = pane.querySelector<HTMLElement>('.dropdown')!;
    dd.classList.add('open');
  });

  afterEach(() => pane.remove());

  it('opens below when the menu fits under the trigger', () => {
    layout(120);
    placeDropdownMenu(dd);
    expect(dd.classList.contains('drop-up')).toBe(false);
    expect(pane.scrollTop).toBe(0);
  });

  it('opens above when only the space above the trigger holds it', () => {
    layout(600);
    placeDropdownMenu(dd);
    expect(dd.classList.contains('drop-up')).toBe(true);
    expect(pane.scrollTop).toBe(0);
  });

  it('scrolls the pane to show the whole menu when neither side holds it', () => {
    layout(330);
    let scrollTop = 0;
    Object.defineProperty(pane, 'scrollTop', { get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
    placeDropdownMenu(dd);
    expect(dd.classList.contains('drop-up')).toBe(false);
    // The menu ends 30px below the pane, and 230px of the pane sit above it.
    expect(scrollTop).toBe(30);
  });
});
