import type { CatchupInfo, Channel, ChannelScope, Programme } from '../types';
import { channelKey, legacyChannelKey } from '../utils/channel';
import { EpgService } from '../services/epg-service';
import { StorageService } from '../services/storage-service';
import { ReminderService } from '../services/reminder-service';
import { XtreamArchiveService } from '../services/xtream-archive';
import type { CatchupResumePrompt } from './catchup-resume-prompt';
import { showToast } from './toast';
import { t } from '../i18n';

// What OK does on a program, shared by both guides: a future program sets or
// clears its reminder, a live one plays, and a past one plays its catch-up
// when the channel has it (resuming a partly watched one on request).

/** The catch-up a past program plays, or undefined to play the channel live. */
export function catchupInfoFor(
  channel: Channel, prog: Programme, resumeSecs?: number,
): CatchupInfo | undefined {
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(prog.start.getTime() / 1000);
  const end = Math.floor(prog.stop.getTime() / 1000);
  if (end > now || !XtreamArchiveService.isAvailable(channel, prog.start.getTime())) return undefined;
  return {
    start,
    end,
    title: prog.title,
    description: prog.description || '',
    icon: prog.icon || '',
    epgSourceUrl: EpgService.getSourceUrl(channel) ?? undefined,
    resumeSecs,
  };
}

/** Set or clear the reminder on a future program, with its toast. */
export function toggleProgramReminder(channel: Channel, prog: Programme): void {
  const key = channelKey(channel);
  const startMs = prog.start.getTime();
  if (ReminderService.has(key, startMs)) {
    ReminderService.remove(key, startMs);
    showToast(t('epg.reminderRemoved'));
    return;
  }
  ReminderService.add({
    channelKey: key,
    channelName: channel.name,
    playlistIds: channel.playlistIds.slice(),
    epgSourceUrl: EpgService.getSourceUrl(channel) ?? undefined,
    title: prog.title,
    startMs,
    stopMs: prog.stop.getTime(),
  });
  showToast(t('epg.reminderSet'));
}

export interface ProgramActivation {
  channel: Channel;
  index: number;
  prog: Programme;
  scope: ChannelScope;
  play: (index: number, catchup?: CatchupInfo, scope?: ChannelScope) => void;
  prompt: CatchupResumePrompt;
  // The channel list may change while an archive loads.
  stillCurrent: () => boolean;
  rerender: () => void;
}

export async function activateProgram(a: ProgramActivation): Promise<void> {
  const { channel, prog } = a;
  if (prog.start.getTime() > Date.now()) {
    toggleProgramReminder(channel, prog);
    a.rerender();
    return;
  }
  const isPast = prog.stop.getTime() <= Date.now();
  if (isPast && channel.catchupAccountId && channel.catchupStreamId) {
    await XtreamArchiveService.load(channel);
    if (!a.stillCurrent()) return;
    a.rerender();
  }
  if (isPast && channel.catchupSource
      && !XtreamArchiveService.isAvailable(channel, prog.start.getTime())) {
    showToast(t('epg.catchupUnavailable'));
    return;
  }
  const play = (resumeSecs?: number) =>
    a.play(a.index, catchupInfoFor(channel, prog, resumeSecs), a.scope);
  if (isPast && channel.catchupSource) {
    const key = channelKey(channel);
    const startMs = prog.start.getTime();
    const entry = StorageService.getCatchupProgressList(key, undefined, legacyChannelKey(channel))
      .find(item => item.progStart === startMs);
    if (entry && !entry.completed) {
      a.prompt.show(prog.title, entry.position, {
        onResume: () => play(entry.position),
        onStartOver: () => {
          StorageService.clearCatchupProgress(key, startMs);
          play();
        },
        onCancel: () => { /* leave the guide unchanged */ },
      });
      return;
    }
  }
  play();
}
