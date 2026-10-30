import { createLogger } from './logger';

const log = createLogger('App');

interface PlatformBack {
  platformBack?: () => void;
}

export type ExitMethod = 'platformBack' | 'close';

// Back on the entry page shows the TV's Home screen. LG's webOSTV.js
// `webOS.platformBack()` does that, leaving the app in the background, and
// forwards to `PalmSystem.platformBack()`, which the TV injects even without
// the library; elsewhere the window just closes.
export function leaveToTvHome(): ExitMethod {
  const w = window as unknown as { webOS?: PlatformBack; PalmSystem?: PlatformBack };
  const host = [w.webOS, w.PalmSystem].filter((o) => typeof o?.platformBack === 'function')[0];
  const method: ExitMethod = host ? 'platformBack' : 'close';
  log.info('Leaving to the TV Home', 'event=app.exit', `method=${method}`);
  if (host) host.platformBack!();
  else window.close();
  return method;
}
