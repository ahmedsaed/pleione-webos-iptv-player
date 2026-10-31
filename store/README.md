# LG Content Store listing

Everything LG Seller Lounge asks for, kept next to the code so it changes in the same pull
request as the app it describes.

| What | Where |
|---|---|
| Name, descriptions, category, keywords, languages, URLs | [`listing.md`](listing.md) |
| App icon (400 × 400), launcher background, 6 screenshots (1920 × 1080) | built by the website: `https://pleione.merope.dev/store/<file>` |
| Full-resolution captures the graphics come from | [`screenshots/`](screenshots) — written by `npm run screenshots:store` |
| The UX scenario LG's testers follow | [`ux-scenario.md`](ux-scenario.md) |
| Self-checklist answers, row by row | [`self-checklist.md`](self-checklist.md) |
| Privacy policy, terms, support pages | [`site/content/`](../site/content) |

## Regenerating

1. Start the demo Xtream server, which serves a synthetic catalog and ffmpeg-made test media
   (`docs/xtream-demo-server.md`):

   ```bash
   npm run xtream:demo
   ```

2. In another terminal, capture the app:

   ```bash
   npm run screenshots:store
   ```

   `scripts/generate-store-screenshots.mjs` builds the app, drives it in headless Chromium at
   1920 × 1080 against `http://127.0.0.1:8090` (override with `XTREAM_DEMO_URL`,
   `XTREAM_DEMO_USERNAME`, `XTREAM_DEMO_PASSWORD`), and writes `home`, `live`, `guide`,
   `player`, `movies`, `movie-detail`, `series`, `series-detail`, `search`, `settings` and
   `appearance` here. The phone-setup QR in `settings.png` uses a faked LAN service with a
   private example address; nothing on screen is a real channel, title or brand.

3. Build the site (`cd site && npm ci && npm run build`). The store graphics land in
   `site/out/store/`, and a merge to `pleione` publishes them. `/store/` on the site is a page
   with every file and its size, for saving down into Seller Lounge.

The graphics are generated, never edited by hand: the screenshot order is `STORE_SHOTS` in
`site/lib/store-graphics.tsx`, the icon is drawn from `assets/icon.svg`, and the launcher
background from the same logo on the logo's own night sky. The background carries no text, since
LG lays the app's title and buttons over it.

## What is left for a human

1. **Seller Lounge account.** Register Merope as a seller at
   [seller.lgappstv.com](https://seller.lgappstv.com), with the support email from
   `site/content/privacy.md`, and create the app with id `com.merope.pleione`.
2. **The reviewers' test account.** Host the demo Xtream server
   (`scripts/xtream-demo-server.mjs`; its content is synthetic, ffmpeg-generated media) on a
   server LG's testers can reach, with its own username and password, and give them in Seller
   Lounge for `[DEMO XTREAM URL]`, `[DEMO USERNAME]` and `[DEMO PASSWORD]` in `ux-scenario.md`.
   Never commit the real address or credentials to this repository. **It must
   stay up for the whole review**, including any re-review after a rejection, and for later
   update reviews; if LG's testers cannot reach it, the app fails review as "does not work".
   Check from outside your network that `player_api.php` answers before submitting.
3. **The self-checklist.** [`self-checklist.md`](self-checklist.md) holds the answers for every
   row of LG's self-checklist v5.0, with evidence. Download the current template from Seller
   Lounge, copy the answers in, finish the rows still marked "pending TV check", and upload it
   with the package.
4. **Paste and upload.** Copy `listing.md` into Seller Lounge, save down the files from
   `https://pleione.merope.dev/store/`, and upload the `.ipk` from the GitHub release.

Before submitting, read the UX scenario against the build you upload: button names in it come
from `src/i18n/en.ts`, and a renamed button makes a tester's step fail.
