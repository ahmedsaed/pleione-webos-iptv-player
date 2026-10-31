// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { caretAtEdge, caretSideOf, runsRightToLeft } from './caret-edge';

function field(value: string, caret: number, end = caret): HTMLInputElement {
  const input = document.createElement('input');
  input.value = value;
  document.body.appendChild(input);
  input.setSelectionRange(caret, end);
  return input;
}

describe('caretSideOf', () => {
  it('maps the arrow keys by key name or remote key code', () => {
    expect(caretSideOf(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))).toBe('left');
    expect(caretSideOf(new KeyboardEvent('keydown', { keyCode: 39 } as KeyboardEventInit))).toBe('right');
    expect(caretSideOf(new KeyboardEvent('keydown', { key: 'ArrowUp' }))).toBeNull();
  });
});

describe('runsRightToLeft', () => {
  it('follows the first strong character, else the field direction', () => {
    expect(runsRightToLeft('http://host/a', 'rtl')).toBe(false);
    expect(runsRightToLeft('قناة 1', 'ltr')).toBe(true);
    expect(runsRightToLeft('123', 'rtl')).toBe(true);
    expect(runsRightToLeft('', 'ltr')).toBe(false);
  });
});

describe('caretAtEdge', () => {
  it('finds Left at the start and Right at the end of left-to-right text', () => {
    expect(caretAtEdge(field('abc', 0), 'left')).toBe(true);
    expect(caretAtEdge(field('abc', 0), 'right')).toBe(false);
    expect(caretAtEdge(field('abc', 3), 'right')).toBe(true);
    expect(caretAtEdge(field('abc', 1), 'left')).toBe(false);
  });

  it('mirrors the edges for right-to-left text', () => {
    const arabic = 'قناة';
    expect(caretAtEdge(field(arabic, 4), 'left')).toBe(true);
    expect(caretAtEdge(field(arabic, 0), 'right')).toBe(true);
    expect(caretAtEdge(field(arabic, 0), 'left')).toBe(false);
  });

  it('never treats a selection or a caretless field as an edge', () => {
    expect(caretAtEdge(field('abc', 0, 2), 'left')).toBe(false);
    const number = document.createElement('input');
    number.type = 'number';
    expect(caretAtEdge(number, 'left')).toBe(false);
  });
});
