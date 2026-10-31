import { CONFIG } from '../config';

export type CaretSide = 'left' | 'right';

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ʯͰ-ϿЀ-ԯ぀-鿿가-힯]/;

/** The side Left or Right moves the caret toward, or null for any other key. */
export function caretSideOf(e: KeyboardEvent): CaretSide | null {
  if (e.key === 'ArrowLeft' || e.keyCode === CONFIG.KEYS.LEFT) return 'left';
  if (e.key === 'ArrowRight' || e.keyCode === CONFIG.KEYS.RIGHT) return 'right';
  return null;
}

// A field's text runs right to left when its first strong character is
// right-to-left (Arabic inputs use `unicode-bidi: plaintext`); a field with
// none follows its own direction.
export function runsRightToLeft(value: string, direction: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (RTL_CHAR.test(value[i])) return true;
    if (LTR_CHAR.test(value[i])) return false;
  }
  return direction === 'rtl';
}

/**
 * True when the caret already sits at the field's `side` edge, so the key
 * has nowhere to move it: Left at the start of left-to-right text, or at
 * the end of right-to-left text. A selection or a field without a caret
 * (a number field) is never at an edge.
 */
export function caretAtEdge(input: HTMLInputElement | HTMLTextAreaElement, side: CaretSide): boolean {
  let start: number | null;
  let end: number | null;
  try {
    start = input.selectionStart;
    end = input.selectionEnd;
  } catch {
    return false;
  }
  if (start === null || end === null || start !== end) return false;
  const rtl = runsRightToLeft(input.value, getComputedStyle(input).direction);
  const atStart = start === 0;
  const atEnd = start === input.value.length;
  return side === 'left' ? (rtl ? atEnd : atStart) : (rtl ? atStart : atEnd);
}
