import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What every generated image shares: the palette, the font, the logo and a TV.
 *
 * The social cards (`social-card.tsx`) and the LG Content Store graphics
 * (`store-graphics.tsx`) are drawn by Satori at build time from the app's real
 * screenshots. Satori reads TTF/OTF/WOFF but not WOFF2, which is why the font
 * comes from @fontsource's `.woff` files rather than from next/font.
 */

// The logo's night sky and its two gradients (assets/icon.svg), as in globals.css.
export const ground = '#0b0d2e';
export const deep = '#07081c';
export const surface = '#14173f';
export const line = '#262a5c';
export const ink = '#eceefb';
export const muted = '#a3a7cf';
export const blue = '#7cc4ff';
export const indigo = '#5a6cff';
export const violet = '#c06bff';

const site = process.cwd();
const read = (path: string) => readFileSync(join(site, path));

/** A PNG as a data URI. Paths are relative to `site/`. */
export const dataUri = (path: string) => `data:image/png;base64,${read(path).toString('base64')}`;

/** The logo, from the app's own SVG — Satori draws SVG images itself. */
export const logoUri = () => `data:image/svg+xml;base64,${read('public/logo.svg').toString('base64')}`;

const font = (file: string) => read(`node_modules/@fontsource/roboto/files/${file}`);

export const fonts = () => [
  { name: 'Roboto', data: font('roboto-latin-400-normal.woff'), weight: 400 as const },
  { name: 'Roboto', data: font('roboto-latin-700-normal.woff'), weight: 700 as const },
  { name: 'Roboto', data: font('roboto-latin-900-normal.woff'), weight: 900 as const },
];

export const words = (text: string) => text.split(' ').filter(Boolean);

/** The sky behind every card: the logo's navy, lit blue at one corner and violet at the other. */
export const sky = (blueAt: string, violetAt: string) =>
  `radial-gradient(circle at ${blueAt}, #1d2a6e 0%, rgba(11,13,46,0) 55%), radial-gradient(circle at ${violetAt}, #3a1d6e 0%, rgba(11,13,46,0) 55%), linear-gradient(${ground}, ${deep})`;

/**
 * A 16:9 screenshot in a thin TV bezel. `width` is the SCREEN's width; the
 * screenshots are 1920×1080.
 */
export function Tv({ src, width, style }: { src: string; width: number; style?: Record<string, string | number> }) {
  const pad = Math.max(4, Math.round(width * 0.012));
  return (
    <div
      style={{
        display: 'flex',
        position: 'absolute',
        padding: pad,
        borderRadius: Math.round(width * 0.018),
        background: '#05060f',
        border: `${Math.max(1, Math.round(width / 600))}px solid ${line}`,
        boxShadow: `0 ${Math.round(width / 18)}px ${Math.round(width / 8)}px rgba(0, 0, 0, 0.55)`,
        ...style,
      }}
    >
      <img
        src={src}
        width={width}
        height={Math.round((width * 9) / 16)}
        style={{ borderRadius: Math.round(width * 0.008) }}
      />
    </div>
  );
}

/** The wordmark as the app draws it on Home: the icon, then the name in bold. */
export function Wordmark({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.35) }}>
      <img src={logoUri()} width={size} height={size} style={{ borderRadius: Math.round(size * 0.22) }} />
      <span style={{ fontSize: Math.round(size * 0.72), fontWeight: 700, color: ink, letterSpacing: -0.5 }}>
        Pleione
      </span>
    </div>
  );
}
