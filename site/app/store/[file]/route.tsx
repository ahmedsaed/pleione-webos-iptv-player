import { launcherBackground, STORE_SHOTS, storeIcon, storeShot } from '@/lib/store-graphics';

/**
 * /store/<file>.png — the LG Content Store listing's images, drawn once at
 * build time.
 *
 * Published with the site so they can be downloaded from one place when the
 * listing is edited, and so they are rebuilt whenever the screenshots are.
 * Same reason as `og/[card]` for being a named route rather than Next's image
 * conventions: the file needs a `.png` on it for Pages to serve it as one.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

const FILES: Record<string, () => Response> = {
  'icon-400.png': storeIcon,
  'launcher-background.png': launcherBackground,
  ...Object.fromEntries(STORE_SHOTS.map((_, i) => [`screenshot-${i + 1}.png`, () => storeShot(i)])),
};

export function generateStaticParams() {
  return Object.keys(FILES).map((file) => ({ file }));
}

export function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  return params.then(({ file }) => FILES[file]());
}
