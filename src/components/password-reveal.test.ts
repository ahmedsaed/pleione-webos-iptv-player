// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { html } from '../utils/dom';
import { morph } from '../utils/morph';
import {
  PASSWORD_REVEAL_MS, insertedIndex, installPasswordReveal, passwordField, revealSegments,
} from './password-reveal';

describe('insertedIndex', () => {
  it('finds the one character typed anywhere in the value', () => {
    expect(insertedIndex('', 'a')).toBe(0);
    expect(insertedIndex('ab', 'abc')).toBe(2);
    expect(insertedIndex('ac', 'abc')).toBe(1);
    expect(insertedIndex('bc', 'abc')).toBe(0);
    expect(insertedIndex('aa', 'aaa')).toBe(2);
  });

  it('ignores deletions, pastes and replacements', () => {
    expect(insertedIndex('abc', 'ab')).toBeNull();
    expect(insertedIndex('a', 'abc')).toBeNull();
    expect(insertedIndex('abc', 'xbcd')).toBeNull();
  });
});

describe('revealSegments', () => {
  it('masks every character but the typed one and places the caret', () => {
    expect(revealSegments('abc', 2, 3)).toEqual([
      { kind: 'masked', text: 'ab' }, { kind: 'clear', text: 'c' }, { kind: 'caret' },
    ]);
    expect(revealSegments('aXbc', 1, 2)).toEqual([
      { kind: 'masked', text: 'a' }, { kind: 'clear', text: 'X' }, { kind: 'caret' },
      { kind: 'masked', text: 'bc' },
    ]);
    expect(revealSegments('a', 0, 0)).toEqual([{ kind: 'caret' }, { kind: 'clear', text: 'a' }]);
  });
});

describe('installPasswordReveal', () => {
  let root: HTMLElement;
  let input: HTMLInputElement;

  const type = (value: string, caret = value.length): void => {
    input.value = value;
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const overlay = () => root.querySelector<HTMLElement>('.password-reveal')!;
  const revealing = () => root.querySelector('.password-field')!.classList.contains('revealing');
  const clear = () => overlay().querySelector('.password-reveal-clear')?.textContent ?? null;

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement('div');
    morph(root, passwordField(html`<input type="password" class="pw">`));
    document.body.appendChild(root);
    installPasswordReveal(root);
    input = root.querySelector<HTMLInputElement>('.pw')!;
    input.focus();
  });

  afterEach(() => {
    root.remove();
    vi.useRealTimers();
  });

  it('shows only the last typed character, then masks it', () => {
    type('a');
    type('ab');
    expect(revealing()).toBe(true);
    expect(clear()).toBe('b');
    expect(overlay().querySelector('.password-reveal-masked')?.textContent).toBe('a');
    vi.advanceTimersByTime(PASSWORD_REVEAL_MS - 1);
    expect(revealing()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(revealing()).toBe(false);
    expect(overlay().textContent).toBe('');
    expect(input.value).toBe('ab');
  });

  it('reveals a character typed mid-value without touching the value or caret', () => {
    type('abc');
    vi.advanceTimersByTime(PASSWORD_REVEAL_MS);
    type('aXbc', 2);
    expect(clear()).toBe('X');
    expect(input.value).toBe('aXbc');
    expect(input.selectionStart).toBe(2);
    const order = Array.from(overlay().querySelectorAll('span span')).map(el => el.className);
    expect(order).toEqual([
      'password-reveal-masked', 'password-reveal-clear', 'password-reveal-caret', 'password-reveal-masked',
    ]);
  });

  it('masks at once on a deletion, a caret move, or leaving the field', () => {
    type('ab');
    type('a');
    expect(revealing()).toBe(false);

    type('ab');
    input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 37, bubbles: true } as KeyboardEventInit));
    expect(revealing()).toBe(false);

    type('abc');
    input.blur();
    expect(revealing()).toBe(false);
  });
});
