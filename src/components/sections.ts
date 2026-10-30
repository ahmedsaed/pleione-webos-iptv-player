// The single source of truth for the sections: order, label, the view each maps
// to, and whether it needs an Xtream account. The Guide is a mode of Live.
export const SECTIONS = [
  { id: 'home', labelKey: 'nav.home', view: 'home', xtreamOnly: false },
  { id: 'live', labelKey: 'nav.live', view: 'channels', xtreamOnly: false },
  { id: 'movies', labelKey: 'nav.movies', view: 'movies', xtreamOnly: true },
  { id: 'series', labelKey: 'nav.series', view: 'series', xtreamOnly: true },
  { id: 'search', labelKey: 'nav.search', view: 'search', xtreamOnly: false },
  { id: 'settings', labelKey: 'nav.settings', view: 'settings', xtreamOnly: false },
] as const;

export type Section = typeof SECTIONS[number]['id'];
export type SectionDef = typeof SECTIONS[number];

// Xtream accounts get the full set; M3U-only accounts have no VOD/series catalog.
export function navSections(hasXtream: boolean): readonly SectionDef[] {
  return SECTIONS.filter((s) => hasXtream || !s.xtreamOnly);
}

// The section a view belongs to (null for the player, loading, and the
// Settings sub-pages).
export function sectionForView(view: string): Section | null {
  return SECTIONS.find((s) => s.view === view)?.id ?? null;
}
