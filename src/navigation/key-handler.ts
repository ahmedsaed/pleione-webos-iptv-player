import { CONFIG } from '../config';
import { StorageService } from '../services/storage-service';
import { createLogger } from '../utils/logger';
import type { Action, NumberEvent } from '../types';

type ActionHandler = (action: Action, event?: NumberEvent) => void;

const log = createLogger('Key');
const K = CONFIG.KEYS;
const WHEEL_SCROLL_WINDOW_MS = 1000;
const HOVER_SYNC_DELAY_MS = 60;

const ACTION_MAP: Record<number, Action> = {
  [K.UP]: 'up',
  [K.DOWN]: 'down',
  [K.LEFT]: 'left',
  [K.RIGHT]: 'right',
  [K.ENTER]: 'select',
  [K.BACK]: 'back',
  [K.ESC]: 'back', // Escape key for desktop
  [K.RED]: 'red',
  [K.GREEN]: 'green',
  [K.YELLOW]: 'yellow',
  [K.BLUE]: 'blue',
  [K.CH_UP]: 'channel_up',
  [K.CH_DOWN]: 'channel_down',
  [K.PLAY]: 'play',
  [K.PAUSE]: 'pause',
  [K.STOP]: 'stop',
  [K.REWIND]: 'rewind',
  [K.FORWARD]: 'fast_forward',
};

// Remote-control keys that must still reach the app even when a text input has
// focus. Text-editing keys are deliberately excluded so the input keeps them:
// digits are typed into the query, Left/Right/Up move the caret, and the
// channel-list's own listener handles Enter/ArrowDown/Escape to leave the box.
// Without this, pressing these dedicated buttons while the search box is focused
// (its blinking caret) did nothing — Back couldn't exit, Red/Blue couldn't open
// EPG/Settings, etc.
const INPUT_PASSTHROUGH_KEYS = new Set<number>([
  K.BACK, K.RED, K.GREEN, K.YELLOW, K.BLUE,
  K.CH_UP, K.CH_DOWN, K.PLAY, K.PAUSE, K.STOP, K.REWIND, K.FORWARD,
]);

let activeHandler: ActionHandler | null = null;
let numberBuffer = '';
let numberTimer: ReturnType<typeof setTimeout> | null = null;
let channelCount: (() => number) | null = null;
let wheelWarmedUp = true;
let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;
let dispatchingWheel = false;

function hasScrollableAncestor(el: Element | null): boolean {
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return true;
  }
  return false;
}

// A number can never exceed the highest channel there is, so 350 channels cap
// entry at three digits — and the buffer can no longer grow without bound.
function maxNumberDigits(): number {
  const count = channelCount?.() ?? 0;
  if (count <= 0) return CONFIG.PLAYER.CHANNEL_NUMBER_MAX_DIGITS;
  return String(count).length;
}

function flushNumber(): void {
  if (numberTimer) clearTimeout(numberTimer);
  numberTimer = null;
  if (!numberBuffer) return;
  const num = parseInt(numberBuffer, 10);
  numberBuffer = '';
  log.debug('Number entry', 'event=key.number', `number=${num}`,
    `handler=${activeHandler ? 'set' : 'none'}`);
  if (activeHandler) activeHandler('number', { number: num });
}

// Any other key abandons a half-typed number. Without this the digits merge
// across the interruption: Up pressed between "2" and "1" still tuned 21.
function cancelNumber(): void {
  if (!numberBuffer) return;
  if (numberTimer) clearTimeout(numberTimer);
  numberTimer = null;
  const length = numberBuffer.length;
  numberBuffer = '';
  log.debug('Number entry cancelled', 'event=key.number.cancelled', `digits=${length}`);
  if (activeHandler) activeHandler('number_cancel');
}

function handleNumber(digit: number): void {
  // At the cap the number still waits out the debounce: tuning on the keypress
  // itself gave no chance to read back what was typed.
  if (numberBuffer.length >= maxNumberDigits()) {
    log.debug('Number entry at cap', 'event=key.number.capped',
      `digits=${numberBuffer.length}`);
    return;
  }
  numberBuffer += digit;
  if (numberTimer) clearTimeout(numberTimer);
  numberTimer = null;
  // Echo each digit immediately: the flush is a second away, and without this
  // the TV shows nothing at all while a multi-digit number is being typed.
  const digits = numberBuffer;
  if (activeHandler) activeHandler('number_input', { number: parseInt(digits, 10), digits });
  numberTimer = setTimeout(flushNumber, StorageService.getNumberEntryOsdTimeoutMs());
}

export const KeyHandler = {
  init(): void {
    // Capture phase, and logging only: components with their own keydown
    // listeners stop propagation, so a bubble-phase log never sees those
    // presses — and a button that "does nothing" must still leave a trace.
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const code = e.keyCode;
      const tag = (e.target as HTMLElement).tagName;
      const inText = tag === 'INPUT' || tag === 'TEXTAREA';
      const mapped = ACTION_MAP[code];
      const isDigit = code >= K.NUM_0 && code <= K.NUM_9;
      const remoteButton = mapped !== undefined || INPUT_PASSTHROUGH_KEYS.has(code);
      // Character keys typed into a text field keep their code out of the log:
      // it would spell out the search query into a shareable diag report.
      const codeField = inText && !remoteButton ? 'code=hidden' : `code=${code}`;
      log.debug('Key down', 'event=key.down', codeField,
        `action=${mapped ?? (isDigit ? 'number' : 'unmapped')}`,
        `target=${inText ? 'text_input' : 'app'}`);
    }, true);

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // Let input fields handle their own text-editing keys, but dedicated
      // remote-control buttons (Back, colored, channel, media) must still reach
      // the app — see INPUT_PASSTHROUGH_KEYS.
      const tag = (e.target as HTMLElement).tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && !INPUT_PASSTHROUGH_KEYS.has(e.keyCode)) {
        // No code here on purpose: it would spell out what is being typed.
        log.debug('Key ignored', 'event=key.ignored', 'reason=text_input');
        return;
      }

      const keyCode = e.keyCode;

      if (keyCode >= K.NUM_0 && keyCode <= K.NUM_9) {
        e.preventDefault();
        handleNumber(keyCode - K.NUM_0);
        return;
      }

      const action = ACTION_MAP[keyCode];
      cancelNumber();
      if (action) {
        e.preventDefault();
        if (activeHandler) activeHandler(action);
      }
    });

    // `:hover` outlives a switch to the D-pad while the pointer sits still, so
    // CSS scopes pointer-hover looks to `html:not(.keyboard-nav)`. Compare
    // coordinates: Chromium fires a synthetic mousemove when content moves
    // under a resting cursor, and the first one only seeds the position.
    const root = document.documentElement;
    let pointerX: number | null = null;
    let pointerY: number | null = null;

    // Mouse support for desktop preview. Skip re-dispatching when the focusable hasn't changed.
    let lastHover: HTMLElement | null = null;
    let suppressedHovers = 0;
    let rehoverPending = false;
    const setHoverTarget = (target: HTMLElement | null): void => {
      rehoverPending = false;
      if (target === lastHover) return;
      lastHover?.dispatchEvent(new CustomEvent('nav:unhover', { bubbles: true }));
      lastHover = target;
      target?.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
    };
    // `data-hover-target`: an item a view lights on hover by itself (the
    // guide's programmes), so it gets no click-to-select from here.
    const focusableAt = (e: MouseEvent): HTMLElement | null => e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-focusable], [data-hover-target]') : null;

    const resumePointer = (e: MouseEvent, via: string): void => {
      if (!root.classList.contains('keyboard-nav')) return;
      root.classList.remove('keyboard-nav');
      if (suppressedHovers > 0) {
        log.debug('Hover resumed', 'event=nav.hover.resumed', `via=${via}`,
          `suppressed=${suppressedHovers}`);
        suppressedHovers = 0;
      }
      const target = focusableAt(e);
      // The D-pad moved focus away, so hovering the same element again must
      // still re-dispatch nav:hover to pull focus back under the pointer.
      if (rehoverPending && target && target === lastHover) {
        rehoverPending = false;
        target.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
      } else {
        setHoverTarget(target);
      }
    };

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // webOS reports its cursor appearing or hiding as a key press; neither
      // is the D-pad taking over.
      if (e.keyCode === K.CURSOR_SHOW || e.keyCode === K.CURSOR_HIDE) return;
      root.classList.add('keyboard-nav');
      rehoverPending = true;
    }, true);
    let pointerClientX = 0;
    let pointerClientY = 0;
    document.addEventListener('mousemove', (e: MouseEvent) => {
      const moved = pointerX !== null && (e.screenX !== pointerX || e.screenY !== pointerY);
      pointerX = e.screenX;
      pointerY = e.screenY;
      pointerClientX = e.clientX;
      pointerClientY = e.clientY;
      if (moved) resumePointer(e, 'move');
    }, true);
    // Scrolling content with the wheel is pointer use even with the cursor at
    // rest; the hovers it causes must follow the pointer again. A wheel that
    // only steps channels moves nothing under the pointer.
    let wheelScrollUntil = 0;
    document.addEventListener('wheel', (e: WheelEvent) => {
      // An SVG icon under the pointer still sits in the scrolled list.
      if (e.target instanceof Element && hasScrollableAncestor(e.target)) {
        pointerClientX = e.clientX;
        pointerClientY = e.clientY;
        wheelScrollUntil = Date.now() + WHEEL_SCROLL_WINDOW_MS;
        resumePointer(e, 'wheel');
      }
    }, true);
    // webOS fires no mouseover as wheel-scrolled content slides under a resting
    // cursor, so hover what lands under it once the scroll (and any virtual
    // list re-render) settles.
    let hoverSyncTimer: ReturnType<typeof setTimeout> | null = null;
    document.addEventListener('scroll', () => {
      if (Date.now() > wheelScrollUntil) return;
      if (hoverSyncTimer !== null) clearTimeout(hoverSyncTimer);
      hoverSyncTimer = setTimeout(() => {
        hoverSyncTimer = null;
        if (root.classList.contains('keyboard-nav')) return;
        const hit = document.elementFromPoint(pointerClientX, pointerClientY);
        if (!hit) return;
        log.debug('Hover synced after scroll', 'event=nav.hover.synced', 'via=wheel');
        // A real mouseover, so views with their own hover handling follow too.
        hit.dispatchEvent(new MouseEvent('mouseover', {
          bubbles: true,
          clientX: pointerClientX,
          clientY: pointerClientY,
          screenX: pointerX ?? 0,
          screenY: pointerY ?? 0,
        }));
      }, HOVER_SYNC_DELAY_MS);
    }, true);
    // While the D-pad drives, rows scrolling under a resting cursor fire
    // mouseover too; following them would pull focus back under the pointer.
    // Capture phase, so components with their own mouseover never see them.
    document.addEventListener('mouseover', (e: MouseEvent) => {
      if (root.classList.contains('keyboard-nav')
          && e.screenX === pointerX && e.screenY === pointerY) {
        suppressedHovers++;
        e.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('mouseover', (e: MouseEvent) => setHoverTarget(focusableAt(e)));
    // Cursor left the window: forget the last hover so returning to the same
    // element re-dispatches nav:hover (re-showing a cleared highlight).
    document.documentElement.addEventListener('mouseleave', () => setHoverTarget(null));

    // Magic Remote scroll wheel / desktop mouse wheel
    // Let any scrollable ancestor scroll natively — otherwise mouseover-driven
    // focus would snap back to the cursor as content scrolls underneath it.
    // First scroll after pointer was hidden just reactivates the cursor.
    document.addEventListener('wheel', (e: WheelEvent) => {
      if (hasScrollableAncestor(e.target as Element)) return;
      e.preventDefault();

      // Reset idle timer — if no scroll for 5s, next scroll is swallowed
      if (wheelIdleTimer) clearTimeout(wheelIdleTimer);
      wheelIdleTimer = setTimeout(() => { wheelWarmedUp = false; }, 5000);

      if (!wheelWarmedUp) {
        wheelWarmedUp = true;
        return;
      }

      if (!activeHandler || e.deltaY === 0) return;
      dispatchingWheel = true;
      try {
        activeHandler(e.deltaY < 0 ? 'channel_up' : 'channel_down');
      } finally {
        dispatchingWheel = false;
      }
    }, { passive: false });

    document.addEventListener('click', (e: MouseEvent) => {
      // Components that self-activate on click (their own click handler is the
      // "OK" action) mark their root subtree with `data-self-activate` so this
      // global handler skips them — otherwise the deferred select below fires a
      // second time (e.g. on the view we just navigated to). This replaces an
      // older hardcoded class list; new self-handling components opt in by adding
      // the attribute, with no edit here.
      //
      // A detached target means a handler that ran earlier in this same click
      // already consumed it by removing the element (e.g. settings "Remove"
      // deletes its row) — skip it so we don't fire a spurious select.
      const t = e.target as HTMLElement;
      if (!t.isConnected || t.closest('[data-self-activate]')) return;
      const target = t.closest<HTMLElement>('[data-focusable]');
      if (target && activeHandler) {
        target.dispatchEvent(new CustomEvent('nav:hover', { bubbles: true }));
        // Small delay to let focus settle before firing select
        setTimeout(() => activeHandler!('select'), 0);
      }
    });
  },

  // Whether the action being handled is a wheel step rather than a key.
  isWheelAction(): boolean {
    return dispatchingWheel;
  },

  setHandler(handler: ActionHandler): void {
    activeHandler = handler;
  },

  // Direct entry is capped at the width of the highest channel number, which
  // changes with the playlist — read it live rather than pushing it on reload.
  setChannelCount(count: () => number): void {
    channelCount = count;
  },
};
