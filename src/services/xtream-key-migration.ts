import type { Channel } from '../types';
import { channelKey, streamUrlKey } from '../utils/channel';
import { createLogger } from '../utils/logger';
import { xtreamLiveUrlVariants, type XtreamCredentials } from '../utils/xtream-url';
import { ChannelCustomizationService } from './channel-customization';
import { ParentalControlService } from './parental-control';
import { StorageService } from './storage-service';
import { createXtreamClient } from './xtream-client';

const log = createLogger('Playlist');

export interface XtreamApiSource {
  credentials: XtreamCredentials;
  channels: Channel[];
}

// Per-channel data is keyed by stream URL. A standard panel's get.php gives
// the same URL the Player API path builds, but some spell it differently:
// the panel's own host, no `/live/` or extension, or raw credentials. Data
// saved under such a get.php URL moves to the same stream's new key. Only
// keys that no loaded channel answers to are moved, so a plain M3U listing
// the same stream keeps its own; the panel's host is known once a sign-in
// has arrived, and a later load catches what this one could not.
export function migrateXtreamChannelKeys(
  sources: readonly XtreamApiSource[],
  loaded: readonly Channel[],
): number {
  const stored = StorageService.channelDataKeys();
  ParentalControlService.liveChannelKeys().forEach(key => stored.add(key));
  if (!stored.size) return 0;
  const loadedKeys = new Set(loaded.map(channelKey));
  const orphans = new Set(Array.from(stored).filter(key => !loadedKeys.has(key)));
  if (!orphans.size) return 0;

  // null marks an old key two streams could claim.
  const claims = new Map<string, string | null>();
  for (const source of sources) {
    const origin = createXtreamClient(source.credentials).signedInInfo()?.serverOrigin;
    for (const channel of source.channels) {
      const streamId = channel.catchupStreamId;
      if (!streamId) continue;
      const key = channelKey(channel);
      for (const url of xtreamLiveUrlVariants(source.credentials, streamId, origin ? [origin] : [])) {
        const old = streamUrlKey(url);
        if (old === key || !orphans.has(old)) continue;
        const claimed = claims.get(old);
        claims.set(old, claimed === undefined || claimed === key ? key : null);
      }
    }
  }
  const aliases = new Map<string, string>();
  claims.forEach((key, old) => { if (key) aliases.set(old, key); });
  if (!aliases.size) return 0;

  const moved = StorageService.renameChannelKeys(aliases)
    + ParentalControlService.renameChannelKeys(aliases);
  ChannelCustomizationService.reload();
  log.info(
    'Channel data moved to Player API stream keys',
    'event=xtream.channel_keys.migrated',
    `keys=${String(aliases.size)}`,
    `records=${String(moved)}`,
  );
  return moved;
}
