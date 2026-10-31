import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { HOME_DESCRIPTION, pageMeta, RELEASES, REPO, SITE_URL } from '@/lib/meta';

export const metadata: Metadata = pageMeta({ description: HOME_DESCRIPTION, path: '/', card: 'home' });

// What a search engine reads as "this page is about an app". Price 0 because
// it is free; no rating, because there are no reviews yet.
const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Pleione',
  description: HOME_DESCRIPTION,
  url: SITE_URL,
  image: `${SITE_URL}/og/home.png`,
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'webOS',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  license: 'https://www.apache.org/licenses/LICENSE-2.0',
  author: { '@type': 'Organization', name: 'Merope', url: 'https://merope.dev' },
};

const LANGUAGES = [
  'English',
  'العربية',
  'Deutsch',
  'Español',
  'Français',
  'Italiano',
  'Polski',
  'Português (Brasil)',
  'Русский',
  'Türkçe',
  'Українська',
  '简体中文',
];

function Screen({ name, alt, eager }: { name: string; alt: string; eager?: boolean }) {
  return (
    <div className="tv">
      <img
        src={`/screenshots/${name}.png`}
        alt={alt}
        width={1920}
        height={1080}
        loading={eager ? undefined : 'lazy'}
      />
    </div>
  );
}

function Feature({
  eyebrow,
  title,
  shot,
  alt,
  flip,
  children,
}: {
  eyebrow: string;
  title: string;
  shot: string;
  alt: string;
  flip?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`feature${flip ? ' flip' : ''}`}>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        {children}
      </div>
      <div className="feature-shot">
        <Screen name={shot} alt={alt} />
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <div className="hero-sky">
        <div className="wrap">
          <div className="hero">
            <div>
              <p className="eyebrow">IPTV player for LG webOS TVs</p>
              <h1>
                Your provider, <em>on the big screen.</em>
              </h1>
              <p className="lede">
                Pleione plays the IPTV service you already have: live TV with a program guide and catch-up, movies
                and series, all made for the remote. Free, open source, and nothing on the network but your own
                provider.
              </p>
              <div className="ctas">
                <span className="button soon" aria-disabled="true">
                  Coming soon to the LG Content Store
                </span>
                <Link className="button ghost" href="/setup/#install-pleione">
                  Install it now
                </Link>
              </div>
              <p className="fineprint">For LG TVs with webOS 4.0 (2018) or newer.</p>
            </div>
            <Screen
              name="home"
              eager
              alt="Pleione's Home screen: large tiles for Live, Movies, Series, Search and Settings"
            />
          </div>

          <aside className="notice" aria-label="No content included">
            <strong>Pleione ships no channels, movies or series.</strong> It is a player: you add a playlist or an
            account from a provider of your own, and you are responsible for having the right to watch it. See the{' '}
            <Link href="/terms/">terms of use</Link>.
          </aside>
        </div>
      </div>

      <section id="features">
        <div className="wrap">
          <p className="eyebrow">What it does</p>
          <h2>Everything your provider offers, laid out for a TV.</h2>
          <p className="section-intro">
            Add an M3U playlist or an Xtream account, and Pleione builds the rest: channels by group, a guide, a
            library of movies and series, and one search across all of it.
          </p>

          <Feature
            eyebrow="Live TV"
            title="Channels, a guide, and what you missed."
            shot="guide"
            alt="The Guide inside Live: the groups on the left, and a timeline of every channel's programs with the current time marked"
          >
            <ul>
              <li>M3U and M3U8 playlists, and Xtream Codes accounts — several at once, each switchable on and off.</li>
              <li>
                Live in three panes: groups, channels with what is on now and next, and a preview that plays the
                channel you rest on.
              </li>
              <li>
                The Guide, one press of Red inside Live: a timeline of every channel from XMLTV, found from your
                playlist or added by hand, with per-source time correction.
              </li>
              <li>Catch-up for programs that already aired, and pause and rewind on live streams that allow it.</li>
              <li>Favorites, Recently Watched, reminders that fire even with the app closed, and number-key tuning.</li>
            </ul>
          </Feature>

          <Feature
            eyebrow="Movies and series"
            title="A library, not a list."
            shot="movie-detail"
            alt="A movie's detail page: title, year, length, genre and rating, a Play button, the cast and similar titles"
            flip
          >
            <ul>
              <li>Browse an Xtream account’s movies and series by category, sorted by name, date, rating or year.</li>
              <li>Detail pages with the plot, cast and rating, seasons and episodes, and more like this.</li>
              <li>Continue Watching picks up where you stopped; a Watchlist keeps what is next.</li>
              <li>Episodes play on into the next one.</li>
            </ul>
          </Feature>

          <Feature
            eyebrow="Search"
            title="One box for everything."
            shot="search"
            alt="Search results for a channel name: the channel, then its programs across the week"
          >
            <ul>
              <li>Channels, guide programs, movies and series, ranked in one view.</li>
              <li>
                Arabic-aware matching: spellings that differ only in hamza, final letters, diacritics or digit script
                find each other.
              </li>
              <li>Recent searches one press away, and an index ready as soon as the app is.</li>
            </ul>
          </Feature>

          <Feature
            eyebrow="Playback"
            title="Straight to the TV’s own player."
            shot="player"
            alt="A live channel playing with the controls up: the channel, the program now and next, and a live progress bar"
            flip
          >
            <ul>
              <li>Streams go to the TV’s native decoder, so HDR and Dolby formats pass through untouched.</li>
              <li>Audio and subtitle tracks from the controls, remembered per channel and per title.</li>
              <li>
                Optional online subtitle search for movies and episodes, and cast photos with your own TMDB key.
              </li>
              <li>Recovers stalled streams on its own.</li>
            </ul>
          </Feature>
        </div>
      </section>

      <section id="yours">
        <div className="wrap">
          <p className="eyebrow">Make it yours</p>
          <h2>Readable from the sofa, in your language.</h2>
          <div className="cards">
            <div className="card">
              <h3>12 languages</h3>
              <p>{LANGUAGES.join(' · ')}. Follows the TV’s language, or pick one.</p>
            </div>
            <div className="card">
              <h3>Interface and text size</h3>
              <p>Scale the whole interface from 90% to 130%, or just the text from 80% to 150%.</p>
            </div>
            <div className="card">
              <h3>Themes</h3>
              <p>Light and dark color themes with live previews, and a dark or frosted look over video.</p>
            </div>
            <div className="card">
              <h3>Parental controls</h3>
              <p>Lock groups, categories or single titles behind a PIN, listed with a lock or hidden.</p>
            </div>
          </div>
          <div className="gallery">
            <figure>
              <Screen name="appearance" alt="Settings, Appearance: theme previews, overlay style, interface and text size" />
              <figcaption>Appearance settings</figcaption>
            </figure>
            <figure>
              <Screen name="series-detail" alt="A series detail page with the season picker and its episodes" />
              <figcaption>Seasons and episodes</figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section id="phone">
        <div className="wrap">
          <Feature
            eyebrow="Setup"
            title="Type on your phone, not your remote."
            shot="settings"
            alt="Settings with a QR code, a local network address and a four-digit pairing code for phone setup"
          >
            <p>
              Long addresses and passwords are miserable with a remote. The first time you open Pleione, Home shows
              a QR code beside the Add cards; later it is in Settings. Scan it with your phone, or enter the pairing
              code, and add your accounts, playlists and guides from there — or upload an <code>.m3u</code> file. It
              works on your home network, only while Pleione is open.
            </p>
            <p>
              <Link href="/setup/">Read the setup guide</Link>
            </p>
          </Feature>
        </div>
      </section>

      <section id="privacy">
        <div className="wrap">
          <p className="eyebrow">Privacy</p>
          <h2>No account. No analytics. No server of ours.</h2>
          <p className="section-intro">
            Your accounts, playlists and history are stored on the TV. Pleione talks to your own providers, and to a
            subtitle service or TMDB only when you use them. Exactly what each one receives is in the{' '}
            <Link href="/privacy/">privacy policy</Link>.
          </p>
        </div>
      </section>

      <section id="get">
        <div className="wrap">
          <p className="eyebrow">Get Pleione</p>
          <h2>Two ways onto your TV.</h2>
          <div className="cards">
            <div className="card">
              <h3>LG Content Store</h3>
              <p>Coming soon. Search for Pleione in the store on your TV once it is listed.</p>
            </div>
            <div className="card">
              <h3>Developer Mode</h3>
              <p>
                Sideload the <code>.ipk</code> from the <a href={RELEASES}>GitHub releases</a> with LG’s Developer Mode
                app and a free LG developer account. Sessions must be renewed in that app, or the TV removes the app.{' '}
                <Link href="/setup/#developer-mode">How</Link>
              </p>
            </div>
          </div>
          <p className="fineprint">
            Pleione is free software under the Apache-2.0 license, based on{' '}
            <Link href="/open-source/">webOS IPTV Player by lennylxx</Link>. The <a href={REPO}>source is on GitHub</a>.
          </p>
        </div>
      </section>
    </>
  );
}
