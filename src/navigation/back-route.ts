// Where live playback was started from, so Back from the player returns there.
export type PlayedFrom = 'home' | 'channels' | 'search';

export type BackStep = 'exit' | 'home' | 'settings' | PlayedFrom;

// Back once a page has nothing of its own left to close or step out of: one
// level up. Every section sits under Home, and Back on Home leaves the app.
export function backStep(view: string, playedFrom: PlayedFrom): BackStep {
  switch (view) {
    case 'home':
      return 'exit';
    case 'player':
      return playedFrom;
    case 'reminders':
    case 'parental-controls':
      return 'settings';
    default:
      return 'home';
  }
}
