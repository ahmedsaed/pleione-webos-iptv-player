import type { Metadata } from 'next';

import { cardSize, CARDS, type CardName } from './social-card';

export const SITE_URL = 'https://pleione.merope.dev';
export const SITE_NAME = 'Pleione';

export const REPO = 'https://github.com/ahmedsaed/pleione-webos-iptv-player';
export const RELEASES = `${REPO}/releases/latest`;
export const ISSUES = `${REPO}/issues`;
export const UPSTREAM = 'https://github.com/lennylxx/webos-iptv-player';
export const SUPPORT_EMAIL = 'support@merope.dev';

/**
 * A page's title, description, canonical URL and the Open Graph and Twitter
 * tags that repeat them.
 *
 * Next merges metadata SHALLOWLY: a page that sets `openGraph` replaces the
 * layout's whole object, and a page that does not inherits the layout's — so
 * every page goes through this, or it unfurls with the home page's title. The
 * card is drawn by `app/og/[card]/route.tsx`.
 */
export function pageMeta({
  title,
  description,
  path,
  card,
}: {
  /** Undefined on the home page, which uses the layout's default title. */
  title?: string;
  description: string;
  /** With a trailing slash, as the static export serves it. */
  path: string;
  card: CardName;
}): Metadata {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : HOME_TITLE;
  const image = { url: `/og/${card}.png`, ...cardSize, type: 'image/png', alt: CARDS[card].alt };
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      url: path,
      title: fullTitle,
      description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [image],
    },
  };
}

export const HOME_TITLE = 'Pleione — a free IPTV player for LG webOS TVs';
export const HOME_DESCRIPTION =
  'Pleione plays your own IPTV provider on an LG TV: M3U playlists and Xtream accounts, a program guide with catch-up, movies and series. It ships no channels, and it has no analytics.';
