// Whether the remote's keys or the pointer drive the UI. The `keyboard-nav`
// class on <html> is the one truth, so CSS and this module never disagree;
// only KeyHandler changes it, through setInputMode().

export type Mode = 'keys' | 'pointer';

const CLASS = 'keyboard-nav';
const listeners = new Set<(mode: Mode) => void>();

function read(): Mode {
  return document.documentElement.classList.contains(CLASS) ? 'keys' : 'pointer';
}

export const InputMode = {
  get current(): Mode {
    return read();
  },

  /** Call `fn` on each switch; returns the unsubscribe. */
  onChange(fn: (mode: Mode) => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};

/** KeyHandler only: switch the mode and tell subscribers when it changed. */
export function setInputMode(mode: Mode): void {
  if (read() === mode) return;
  document.documentElement.classList.toggle(CLASS, mode === 'keys');
  for (const fn of Array.from(listeners)) fn(mode);
}
