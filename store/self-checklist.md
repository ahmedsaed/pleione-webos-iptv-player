# Pleione 2.0.0 — LG self-checklist (v5.0)

The 53 rows of LG's Content Store self-checklist v5.0, filled in for Pleione 2.0.0
(`com.merope.pleione`). The row titles are short labels for LG's check items; the template
itself is downloaded from Seller Lounge and filled in from this page.

- **Pass**: checked, with the evidence named.
- **Pass (pending TV check: …)**: the code and tests cover it, and it still needs one look on a
  TV before submitting.
- **N/A**: the app has no such feature.
- "Verified on TV 2026-10-30" means checked by hand on an LG 55UK6300 (webOS 4.4, the oldest
  supported engine). The steps are in [`ux-scenario.md`](ux-scenario.md).

Summary: 37 Pass (8 of them verified on TV), 9 Pass pending a TV check, 7 N/A.

## 1.1 Execution

| No. | Item | Result | Evidence |
|---|---|---|---|
| 1 | Launching the app | Pass | Launches to Home, or to the first-run screen with no source. `e2e/onboarding.spec.ts`, `e2e/home-nav.spec.ts` ("Home is the first screen…", "first run shows the welcome, phone setup, and the two Add cards…"). |
| 2 | Main page layout and screens | Pass | Every view fills the 1920 × 1080 canvas at every Interface size: `e2e/interface-size.spec.ts`, `e2e/home-nav.spec.ts`; webOS 4 layout parity in `e2e/legacy-layout-parity.spec.ts`. |
| 3 | Reboot behavior | Pass | Verified on TV 2026-10-30: the app relaunches after a TV restart with its sources, favorites and progress. When the TV's IndexedDB refuses writes, user data is kept in localStorage instead (also verified on TV 2026-10-30): `src/services/idb-user-data.ts`, `e2e/storage-readonly.spec.ts`. |

## 1.2 Advertisement

| No. | Item | Result | Evidence |
|---|---|---|---|
| 4 | Returning to the app after an ad | N/A | The app shows no advertising. |

## 1.3 Display

| No. | Item | Result | Evidence |
|---|---|---|---|
| 5 | Resolution and aspect ratio | Pass | Fixed 1920 × 1080 canvas (`index.html` viewport, `appinfo.json`); video keeps its aspect ratio (`#video-player` `object-fit: contain`, `css/main.css`). `e2e/interface-size.spec.ts`, `e2e/legacy-layout-parity.spec.ts`. |
| 6 | Text accuracy and truncation | Pass | All 12 locales cover every key (`src/i18n/index.test.ts`); long names ellipsize (`e2e/live-panes.spec.ts` "a long channel name ellipsizes…"); the longest translations fit at text size 150 (`e2e/pseudo-locale.spec.ts`). |
| 7 | Focus and mouse-over effects | Pass | One focus ring at a time, on the surface that owns the keys; every E2E test fails if a key press leaves two rings (`e2e/helpers.ts`, `e2e/focus-owner.spec.ts`, `src/navigation/focus-ring.test.ts`). |
| 8 | Flickering | Pass (pending TV check: no flicker moving through Live, the Guide and the catalogs) | Re-renders patch the DOM in place (`src/utils/morph.ts`); an idle preview lays out at most twice in 10 s (`e2e/live-preview.spec.ts`). |
| 9 | Full-size video output | Pass (pending TV check: full-screen playback fills the screen) | Full screen covers the canvas: `e2e/live-panes.spec.ts` "OK watches full screen…", `e2e/home-nav.spec.ts` "the … destination opens full screen". |

## 1.4 Function

| No. | Item | Result | Evidence |
|---|---|---|---|
| 10 | UI buttons | Pass | Every button works by D-pad and pointer: `e2e/home-nav.spec.ts`, `e2e/catalog-detail.spec.ts`, `e2e/settings.spec.ts`, `e2e/player.spec.ts`. |
| 11 | BACK button (UI and remote) | Pass (pending TV check: Back on Home closes the app) | Back goes up one level and closes the app from Home in one press: `e2e/back-chain.spec.ts`, `e2e/home-nav.spec.ts` "Back on Home leaves the app in one press…", `src/navigation/back-route.test.ts`. |
| 12 | EXIT button (UI) | Pass | The app has no on-screen Exit button; Back on Home and the remote's EXIT key close it (rows 11, 38). |
| 13 | Lockup or latchup | Pass | Verified on TV 2026-10-30. Long-session budget: `e2e/long-session.spec.ts`. |
| 14 | Abnormal termination | Pass | Verified on TV 2026-10-30. Load and playback errors are caught and shown as messages (`e2e/provider-retry.spec.ts`, `e2e/live-preview.spec.ts` "a dead previewed channel…"). |
| 15 | Keyboard text and number input | Pass | Verified on TV 2026-10-30 with the TV's on-screen keyboard (account fields, Search, PIN). The TV check found the caret wrapping around at a field's ends; fixed since (it now stops at the edge, and Left/Right leave the field), covered by `src/navigation/caret-edge.test.ts`. |
| 16 | Keyboard special characters | Pass | Verified on TV 2026-10-30 (`:`, `/`, `.`, `@` in server addresses and passwords). |
| 17 | Keyboard linkage to TV functions | Pass | Verified on TV 2026-10-30: the TV keyboard opens on OK in a text field and closes back to the app. `e2e/search.spec.ts` "OK in the box closes the keyboard…". |
| 18 | Terms and conditions | N/A | No account or terms to accept in the app; terms are on the website. |
| 19 | Membership sign-up | N/A | No membership; the user brings their own provider. |
| 20 | Sign-in | Pass | Adding an Xtream account and **Check** sign in to the user's provider; a failed sign-in shows a banner with **Try again** / **Edit account** (`e2e/home-nav.spec.ts`, `src/services/xtream-*.test.ts`). |
| 21 | Sign-out | Pass | Removing an account in **Settings › Sources**, or **Reset App**, removes its credentials from the TV (`src/components/settings.test.ts`, `src/services/app-reset.test.ts`). |
| 22 | Search | Pass | `e2e/search.spec.ts` (channels, programs, movies, series, recent searches). |
| 23 | Adult content authentication | Pass | No adult content is included. Parental controls lock live groups and channels and movie and series categories behind a four-digit PIN, with retry lockout: `e2e/parental-controls.spec.ts`, `src/services/parental-control.test.ts`. Steps in `ux-scenario.md` section 7a. |
| 24 | In-app purchase | N/A | No purchases. |
| 25 | Payment method, purchase history, playback | N/A | No purchases. |

## 1.5 Remote Control

| No. | Item | Result | Evidence |
|---|---|---|---|
| 26 | General remote control support | Pass | Every screen works with the standard remote alone: `src/navigation/key-handler.test.ts`, `src/navigation/spatial-nav.test.ts`, every E2E spec drives keys. |
| 27 | Magic remote control support | Pass | Pointer mode via `cursorStateChange` / `CURSOR_SHOW` (`src/navigation/input-mode.ts`, `src/navigation/input-mode.test.ts`). |
| 28 | Magic remote pointer movement | Pass | Hover lights the item under the pointer without moving the keys: `e2e/focus-owner.spec.ts`, `e2e/live-guide.spec.ts` "the pointer lights a cell…". |
| 29 | Magic remote OK key on UI buttons | Pass | OK fires a normal `click`: `e2e/home-nav.spec.ts` "the first-run cards open the Add flows by D-pad and pointer", `e2e/player.spec.ts` "pause control pauses on a Magic-Remote pointer click". |
| 30 | Magic remote wheel scrolling | Pass | `e2e/edge-scroll.spec.ts`, `e2e/catalog-browse.spec.ts`, `e2e/parental-controls.spec.ts` (wheel-scrolled rows). |
| 31 | Navigation keys | Pass | `src/navigation/spatial-nav.test.ts`; `e2e/live-panes.spec.ts` "the D-pad crosses groups, rows, and the header…". |
| 32 | Color (function) keys | Pass | Red opens the Guide, Green toggles a favorite, Yellow shows the player controls, shown in the on-screen legends: `e2e/live-guide.spec.ts`, `e2e/channel-list.spec.ts`, `e2e/player.spec.ts`. |
| 33 | General remote OK key | Pass | OK selects everywhere and pauses in the player: `e2e/player.spec.ts`, `e2e/live-preview.spec.ts`. |
| 34 | Basic general keys (magic remote) | Pass | Play, Pause, Stop, ⏪, ⏩ and CH +/− map to player actions (`src/config.ts` `KEYS`, `src/navigation/key-handler.test.ts`). |
| 35 | Non-basic general keys (magic remote) | Pass | Unmapped keys are ignored without side effects (`src/navigation/key-handler.test.ts`). |
| 36 | HOME key | Pass | Verified on TV 2026-10-30: the app goes to the background and resumes where it was, with playback state restored (`e2e/startup.spec.ts` background restarts). |
| 37 | BACK key | Pass (pending TV check: Back on Home closes the app) | Same as row 11: `e2e/back-chain.spec.ts`, `e2e/home-nav.spec.ts` "Back on Home closes the app instead of raising the launcher through platformBack". |
| 38 | EXIT key | Pass | Verified on TV 2026-10-30: EXIT closes the app; it relaunches with its data. |
| 39 | LIVE key | N/A | The app does not use the TV's LIVE key; the TV handles it. |
| 40 | Number and other unsupported keys | Pass | Number keys tune a channel number on Home, in Live and in the player; an out-of-range number keeps the channel (`e2e/home-nav.spec.ts`, `e2e/live-preview.spec.ts`, `e2e/player.spec.ts` "a channel number past the end of the list keeps the current channel"). |

## 1.6 Language

| No. | Item | Result | Evidence |
|---|---|---|---|
| 41 | Language change settings | Pass | **Settings › General › Language**: System (follows the TV) or one of 12 languages, applied at once: `e2e/locale-switch.spec.ts`, `e2e/arabic-locale.spec.ts`, `src/i18n/index.test.ts`. |

## 1.7 Sound

| No. | Item | Result | Evidence |
|---|---|---|---|
| 42 | Sound output, noise, volume, on/off | Pass | The app plays media audio only, through the TV's own volume and mute; it makes no sounds of its own. Audio tracks switch without noise: `src/utils/audio-tracks.test.ts`, `docs/audio-track-selection.md`. |

## 1.8 Multimedia

| No. | Item | Result | Evidence |
|---|---|---|---|
| 43 | Playback under varying network speeds, IPv6 | Pass (pending TV check: network unplugged and restored during playback; the adaptive channel on a slow link) | Reconnect then fail-over: `e2e/provider-retry.spec.ts`, `e2e/live-preview.spec.ts` "full screen still moves on from a dead channel…". Demo **Adaptive 360p-1080p** steps through an HLS ladder. Addresses are used as entered, so IPv6 providers work where the TV has IPv6. |
| 44 | Full/original screen switching | Pass (pending TV check: picture size via the TV's Q.Menu) | Live switches between the preview and full screen with OK and Back: `e2e/live-preview.spec.ts` "expand keeps the video identity…". |
| 45 | Playback controls | Pass | Play/Pause, seek, Go to live, audio, subtitles, previous/next episode, by keys and pointer: `e2e/player.spec.ts`, `src/components/player-osd.test.ts`. |
| 46 | Replay after completion | Pass | A finished movie returns to its detail page with **Play** / **Play from start**; a finished episode offers **Up next**: `src/components/player.test.ts`, `e2e/series.spec.ts`. |
| 47 | Real-time streaming | Pass (pending TV check: live HLS and MPEG-TS channels play continuously) | `e2e/live-preview.spec.ts`, `src/components/player-pipeline-webos.test.ts`; live DVR in `e2e/player.spec.ts`. |
| 48 | Subtitles | Pass | Live WebVTT and CEA-608/708, VOD in-container, SRT/WebVTT/ASS sidecars, Subtitle Sync: `e2e/player.spec.ts`, `e2e/movies.spec.ts`, `src/services/hls-subtitles.test.ts`, `docs/hls-subtitles.md`, `docs/vod-subtitles.md`. |
| 49 | Resume playback | Pass | **Resume** and **Play from start** on movies and episodes, Continue Watching, catch-up resume: `e2e/catalog-detail.spec.ts`, `e2e/epg-resume.spec.ts`, `e2e/storage-readonly.spec.ts`. |
| 50 | Supported resolutions (SD to UHD) | Pass (pending TV check: Group HD 720p, 1080p and 2160p items) | Demo **Group HD** items; the stream info readout shows the resolution tier (`src/components/player-osd.test.ts`). |
| 51 | Supported codecs | Pass (pending TV check: H.264/AAC in HLS, MPEG-TS and MP4 on the TV) | Native webOS pipeline (`src/components/player-pipeline.ts`), stream type detection in `src/utils/url.ts`; DASH notes in `docs/mpeg-dash.md`. |
| 52 | DRM-protected content | N/A | The app offers no DRM content. |

## 1.9 Factory Reset

| No. | Item | Result | Evidence |
|---|---|---|---|
| 53 | App works after factory reset | Pass | With empty storage the app opens on its first-run screen (`e2e/onboarding.spec.ts`); **Reset App** returns it there (`src/services/app-reset.test.ts`, `e2e/parental-controls.spec.ts` "Reset App clears a forgotten PIN"). |

## Comments for the reviewer

- Pleione is a player and ships no channels or content. Everything shown comes from the
  provider the user adds.
- The test account (server URL, username and password) is given in Seller Lounge; it serves
  synthetic test media made for this review.
- No adult content is included. Parental controls exist: **Settings › General › Parental
  controls** locks groups, channels and catalog categories behind a PIN (`ux-scenario.md`
  section 7a).
- The **Adaptive 360p-1080p** channel in **Group HD** needs HLS: set the test account's **Live
  stream format** to **HLS (m3u8)** or **Auto** in **Settings › Sources**.
