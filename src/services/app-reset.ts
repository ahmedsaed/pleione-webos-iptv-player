import { clearAllCachedData } from './idb-cache';
import { ReminderService } from './reminder-service';
import { StorageService } from './storage-service';
import { clearFallback } from './user-data-fallback';
import { createLogger } from '../utils/logger';

const log = createLogger('AppReset');

async function step(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    log.error(
      'App reset step failed',
      'event=persistence.reset.step.failed',
      `step=${name}`,
      err,
    );
  }
}

// Every step runs even when one before it fails, so a broken IndexedDB
// never leaves accounts and passwords behind in localStorage.
export async function resetAppData(): Promise<void> {
  // Activity Manager jobs persist outside app storage and carry program and
  // channel names, so cancel them while the reminder list still names them.
  await step('reminders', () => ReminderService.clearAll());
  await step('caches', () => clearAllCachedData());
  await step('user_data', () => StorageService.clearUserData());
  await step('fallback', () => clearFallback());
  await step('local', () => StorageService.clearAll());
}
