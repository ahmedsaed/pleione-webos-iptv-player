import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { HOME_DESCRIPTION, HOME_TITLE, pageMeta, REPO, SITE_NAME, SITE_URL } from '@/lib/meta';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: HOME_TITLE, template: `%s · ${SITE_NAME}` },
  applicationName: SITE_NAME,
  authors: [{ name: 'Merope', url: 'https://merope.dev' }],
  creator: 'Merope',
  icons: { icon: '/logo.svg', apple: '/icon.png' },
  // Every page sets its own through pageMeta(); this covers any that forgets.
  ...pageMeta({ description: HOME_DESCRIPTION, path: '/', card: 'home' }),
};

export const viewport: Viewport = {
  themeColor: '#0b0d2e',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand" aria-label="Pleione, home">
              <img src="/logo.svg" alt="" width={32} height={32} />
              <span className="wordmark">Pleione</span>
            </Link>
            <nav className="site-nav" aria-label="Site">
              <Link href="/#features" className="optional">
                Features
              </Link>
              <Link href="/setup/">Setup</Link>
              <Link href="/privacy/">Privacy</Link>
              <Link href="/support/" className="optional">
                Support
              </Link>
            </nav>
          </div>
        </header>

        <main>{children}</main>

        <footer className="site-footer">
          <div className="wrap">
            <span>
              Pleione is made by <a href="https://merope.dev">Merope</a>. Free software under the Apache-2.0 license.
              It ships no channels or content.
            </span>
            <nav aria-label="Footer">
              <Link href="/setup/">Setup guide</Link>
              <Link href="/privacy/">Privacy policy</Link>
              <Link href="/terms/">Terms of use</Link>
              <Link href="/support/">Support</Link>
              <Link href="/open-source/">Open source</Link>
              <a href={REPO}>Source code</a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
