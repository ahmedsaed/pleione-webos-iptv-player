import { clearAllCachedData } from './idb-cache';
import { ReminderService } from './reminder-service';
import { StorageService } from './storage-service';

export async function resetAppData(): Promise<void> {
  // Activity Manager jobs persist outside app storage and carry program and
  // channel names, so cancel them while the reminder list still names them.
  ReminderService.clearAll();
  await clearAllCachedData();
  await StorageService.clearUserData();
  StorageService.clearAll();
}
