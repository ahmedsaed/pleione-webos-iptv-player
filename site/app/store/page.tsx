import type { Metadata } from 'next';

import { pageMeta, REPO } from '@/lib/meta';
import { STORE_SHOTS } from '@/lib/store-graphics';

export const metadata: Metadata = {
  ...pageMeta({
    title: 'Store graphics',
    description: 'The icon, launcher background and screenshots of the Pleione listing on the LG Content Store.',
    path: '/store/',
    card: 'home',
  }),
  // A working page for whoever edits the listing, not something to land on
  // from a search.
  robots: { index: false },
};

/**
 * Everything Seller Lounge asks for, in the order it asks — so the folder these
 * files live in is a page rather than a 404, and editing the listing is a
 * matter of saving down this page. The files are drawn at build time by
 * `store/[file]/route.tsx`.
 */
function Asset({ file, label, size, wide }: { file: string; label: string; size: string; wide?: boolean }) {
  return (
    <figure className={`store-asset${wide ? ' wide' : ''}`}>
      <a href={`/store/${file}`} download>
        <img src={`/store/${file}`} alt={label} loading="lazy" />
      </a>
      <figcaption>
        <strong>{label}</strong>
        <span>
          {size} ·{' '}
          <a href={`/store/${file}`} download>
            Download
          </a>
        </span>
      </figcaption>
    </figure>
  );
}

export default function Store() {
  return (
    <div className="wrap">
      <article className="prose store-intro">
        <h1>Store graphics</h1>
        <p>
          The LG Content Store listing’s images, rebuilt with this site from the app’s own screens, so they always show
          the app as it is. The listing’s text lives in{' '}
          <a href={`${REPO}/blob/pleione/store/listing.md`}>store/listing.md</a>.
        </p>
      </article>

      <div className="store-grid">
        <Asset file="icon-400.png" label="App icon" size="400 × 400" />
        <Asset file="launcher-background.png" label="Launcher background" size="1920 × 1080" wide />
      </div>

      <h2 className="store-heading">Screenshots, in listing order</h2>
      <div className="store-grid shots">
        {STORE_SHOTS.map((shot, i) => (
          <Asset
            key={shot.shot}
            file={`screenshot-${i + 1}.png`}
            label={`${i + 1}. ${shot.label}${i === 0 ? ' (primary)' : ''}`}
            size="1920 × 1080"
          />
        ))}
      </div>
    </div>
  );
}
