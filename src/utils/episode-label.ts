import type { SeriesEpisodeRef } from '../types';
import { allTranslations, t } from '../i18n';

// The composed label carries the episode code (see composeEpisodeLabel), in
// Latin letters or, saved in Arabic, as م and ح. Labels saved before the
// Arabic season letter was corrected carry س instead.
export const RESUME_CODE = /(?:S|م|س)(\d+)(?:E|ح)(\d+)/;
const WHOLE_CODE = new RegExp(`^${RESUME_CODE.source}$`);
// A provider's placeholder title, such as "Episode 6", reads in the UI's
// language instead.
const GENERIC_TITLE = /^(?:episode|ep\.?|e)\s*0*(\d+)$/i;
const SEPARATOR = ' — ';

let savedGenericTitles: RegExp[] | null = null;

export function episodeTitle(title: string): string {
  const trimmed = title.trim();
  const generic = GENERIC_TITLE.exec(trimmed);
  return generic ? t('catalog.episodeNumber', { episode: Number(generic[1]) }) : trimmed;
}

export function composeEpisodeLabel(ref: SeriesEpisodeRef): string {
  const code = t('catalog.episodeCode', { season: ref.season, episode: ref.episode });
  const title = episodeTitle(ref.title);
  if (!title) return `${ref.seriesName}${SEPARATOR}${code}`;
  // Providers often name episodes "Series - S01E02 - Title" already.
  if (title.toLowerCase().indexOf(ref.seriesName.trim().toLowerCase()) === 0) return title;
  return `${ref.seriesName}${SEPARATOR}${code}${SEPARATOR}${title}`;
}

// A placeholder title as any locale composed it, such as "الحلقة 6".
function savedGenericTitle(title: string): number | null {
  if (!savedGenericTitles) {
    savedGenericTitles = allTranslations('catalog.episodeNumber').map(template => new RegExp(
      `^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{episode\\}', '(\\d+)')}$`, 'i'));
  }
  for (const pattern of savedGenericTitles) {
    const match = pattern.exec(title);
    if (match) return Number(match[1]);
  }
  return null;
}

// A label composed in the language active when it was saved, composed again
// in today's. A provider's own title is left as it is.
export function localizeEpisodeLabel(label: string): string {
  const parts = label.split(SEPARATOR);
  for (let i = 1; i < parts.length; i++) {
    const code = WHOLE_CODE.exec(parts[i]);
    if (!code) continue;
    const title = parts.slice(i + 1).join(SEPARATOR);
    const generic = savedGenericTitle(title);
    return composeEpisodeLabel({
      seriesName: parts.slice(0, i).join(SEPARATOR),
      season: Number(code[1]),
      episode: Number(code[2]),
      title: generic === null ? title : `Episode ${generic}`,
    });
  }
  return label;
}

// What a saved episode shows: composed from its place in the series when
// known, else from the label it was saved with.
export function episodeLabelOf(item: { seriesEpisode?: SeriesEpisodeRef }, label: string): string {
  return item.seriesEpisode ? composeEpisodeLabel(item.seriesEpisode) : localizeEpisodeLabel(label);
}

// The season and episode of a saved episode, or null when nothing names them.
export function episodeCodeOf(
  item: { seriesEpisode?: SeriesEpisodeRef },
  label: string,
): { season: number; episode: number } | null {
  if (item.seriesEpisode) return { season: item.seriesEpisode.season, episode: item.seriesEpisode.episode };
  const code = RESUME_CODE.exec(label);
  return code ? { season: Number(code[1]), episode: Number(code[2]) } : null;
}

// The series name a composed label starts with, or '' when it has none.
export function seriesNameOf(item: { seriesEpisode?: SeriesEpisodeRef }, label: string): string {
  if (item.seriesEpisode) return item.seriesEpisode.seriesName;
  const code = RESUME_CODE.exec(label);
  return code ? label.slice(0, code.index).replace(/[\s—–-]+$/, '') : '';
}
