// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leaveToTvHome } from './platform-exit';

type Host = { webOS?: unknown; PalmSystem?: unknown };

afterEach(() => {
  delete (window as Host).webOS;
  delete (window as Host).PalmSystem;
  vi.restoreAllMocks();
});

describe('leaveToTvHome', () => {
  it('prefers webOS.platformBack, called on its object', () => {
    const webOS = { platformBack: vi.fn(function (this: unknown) { return this; }) };
    const palm = { platformBack: vi.fn() };
    Object.assign(window as Host, { webOS, PalmSystem: palm });
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    expect(leaveToTvHome()).toBe('platformBack');
    expect(webOS.platformBack).toHaveBeenCalledOnce();
    expect(webOS.platformBack.mock.results[0].value).toBe(webOS);
    expect(palm.platformBack).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('uses PalmSystem.platformBack without webOSTV.js', () => {
    const palm = { platformBack: vi.fn() };
    (window as Host).PalmSystem = palm;
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    expect(leaveToTvHome()).toBe('platformBack');
    expect(palm.platformBack).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('closes the window when the platform has no platformBack', () => {
    (window as Host).PalmSystem = { launchParams: '{}' };
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    expect(leaveToTvHome()).toBe('close');
    expect(close).toHaveBeenCalledOnce();
  });

  it('logs the method for tv.sh diag', () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    vi.spyOn(window, 'close').mockImplementation(() => undefined);

    leaveToTvHome();

    expect(lines).toContainEqual(expect.stringMatching(/event=app\.exit method=close\b/));
  });
});
