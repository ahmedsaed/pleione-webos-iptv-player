// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeApp } from './platform-exit';

type Host = { PalmSystem?: unknown };

afterEach(() => {
  delete (window as Host).PalmSystem;
  vi.restoreAllMocks();
});

describe('closeApp', () => {
  it('closes the window even where the TV offers platformBack', () => {
    const palm = { platformBack: vi.fn() };
    (window as Host).PalmSystem = palm;
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    closeApp();

    expect(close).toHaveBeenCalledOnce();
    expect(palm.platformBack).not.toHaveBeenCalled();
  });

  it('logs the exit for tv.sh diag', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    vi.spyOn(window, 'close').mockImplementation(() => undefined);

    closeApp();

    expect(lines).toContainEqual(expect.stringMatching(/event=app\.exit method=close\b/));
  });
});
