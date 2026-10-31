import { createLogger } from './logger';

const log = createLogger('App');

// Back on Home closes the app and returns to the previous input, like the
// TV's streaming apps. platformBack would only raise the launcher bar on
// webOS 4 and leave the app in the background.
export function closeApp(): void {
  log.info('Closing the app', 'event=app.exit', 'method=close');
  window.close();
}
