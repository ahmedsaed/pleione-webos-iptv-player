# Samsung Tizen port — plan

Status: decisions taken 2026-10-30 (see [§12](#12-decisions)); next step is Phase 0.
Branch: `pleione-tizen-plan` (off `pleione`). Research date: 2026-10-30.

Goal: ship Pleione on Samsung TVs from this repo, as a second build target
next to webOS, without regressing webOS and without forking the UI.

Legend for facts: **[V]** verified against a cited source, **[I]** inferred,
**[U]** unverified — must be checked on a device (see [§11](#11-device-spike-checklist)).

---

## 1. Summary

- ~90% of the app is platform-neutral: views, `morph()`/`html`, focus
  scopes, SpatialNav, parsers, Xtream, catalog, search, EPG, storage,
  i18n, OSD/menu, DVR/catch-up logic, DRM config parsing, VOD/ASS
  subtitles, media probe.
- webOS coupling is concentrated in five places:
  1. **Keys** — `CONFIG.KEYS` and a handful of hard-coded `BACK` checks.
  2. **Lifecycle** — `PalmSystem.launchParams`, `webOSRelaunch`,
     `window.close()`, `cursorStateChange`, `keyboardStateChange`.
  3. **Luna** — `src/services/luna.ts` (bundled service, Activity Manager
     reminders, toasts, PlayReady, native CC compositor). Every caller
     already degrades when `isLunaAvailable()` is false.
  4. **Native playback assumptions** — `isWebOS()` gates in
     `player-pipeline.ts`, `player.ts`, `player-tracks.ts`, plus
     `mediaOption`, `video.mediaId`, and the audio-track-collapse workaround.
  5. **Build/packaging/tooling** — `appinfo.json`, `build.sh`/`ares-*`,
     `tv.sh` (CDP + SSH), Homebrew manifest, CI, docs, site, store.
- Today a Tizen UA would fail `isWebOS()` and fall to the desktop path with
  no hls.js/mpegts loaded → plain `video.src = url`. So a raw build would
  *partly* work by accident; the plan makes that intentional.
- Recommended shape: compile-time `__PLATFORM__` (`'webos' | 'tizen'`), a
  small `src/platform/` adapter, one bundle per platform, `.wgt` packaged
  from `dist-tizen/`.

---

## 2. Platform research (key facts)

### 2.1 Versions and engines [V]
[Samsung web engine specs](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)

| Model year | Tizen | Engine |
|---|---|---|
| 2016 | 2.4 | WebKit (out of scope) |
| 2017 | 3.0 | Chromium 47 |
| 2018 | 4.0 | Chromium 56 |
| 2019 | 5.0 | Chromium 63 |
| 2020 | 5.5 | Chromium 69 |
| 2021 | 6.0 | Chromium 76 |
| 2022 | 6.5 | Chromium 85 |
| 2023 | 7.0 | Chromium 94 |
| 2024 | 8.0 | Chromium 108 |
| 2025 | 9.0 | Chromium 120 |
| 2026 | 10.0 | Chromium 130 |

- Tizen 4+ is **above** our `chrome53` floor → current polyfills, legacy
  CSS, lint gate, and `chromium-53-simulation` already cover it.
- Tizen 3 (Chromium 47) is **below** the floor → lowering it affects webOS
  too (esbuild target, browserslist, compat gate, BCD simulation, more
  polyfills).
- 2024+ TVs get OS upgrades (up to 7 years), so detect features, never infer
  them from model year.

### 2.2 Packaging and signing [V]
- `.wgt` (W3C widget zip + `author-signature.xml` + `signature1.xml`),
  manifest `config.xml`. App id `<10-char package>.<Name>`.
- CLI: `tizen package -t wgt -s <profile> -- <dir>`, `tizen install`,
  `tizen run`, `sdb connect <ip>`.
- Tizen Studio is being deprecated in favor of the Tizen VS Code extension;
  the CLI keeps working. Docker images exist for headless packaging
  (`vitalets/docker-tizen-webos-sdk`).
- Certificates: **Samsung** author + distributor certs (Tizen 7+ rejects
  plain Tizen certs). The distributor cert lists allowed TV DUIDs; creating
  it needs an interactive Samsung-account browser login. The author cert
  must stay the same across all updates.
- Dev mode: Apps → type `12345` → Developer Mode ON → host PC IP → reboot.

### 2.3 Distribution [V unless marked]
- **Samsung store**: individual (Public Seller) signup can launch only in
  the **US**; other countries need a partnership contract. Review needs
  working test credentials. No written IPTV-player policy found [U];
  Samsung has removed IPTV players case-by-case after rights-holder
  complaints (Smart IPTV, 2016).
- **Apps2Samsung** (formerly Jellyfin2Samsung): desktop/Android/CLI
  installer that makes a per-TV Samsung cert after one browser login and
  re-signs any `.wgt`. Users can add a custom `.wgt` URL. This is the
  de facto sideload path (Jellyfin used it before its store launch).
- **TizenBrew**: a launcher that loads "app modules" from npm/GitHub via
  jsDelivr at every launch, under TizenBrew's own id. No own icon/app id.
  Viable as an extra channel, not a primary one.

### 2.4 Playback [V unless marked]
- `<video>` plays HLS (TS + fMP4) natively — Jellyfin disables hls.js on
  Tizen for that reason. MSE + EME (PlayReady, Widevine) supported;
  Shaka officially supports Tizen.
- `audioTracks` switching works on Tizen 5.5–7 and is **broken on Tizen 8+**
  (Jellyfin gates it to `5.5 <= v < 8`).
- Only one `<video>` playing at a time (community report).
- **AVPlay** (`webapis.avplay`): `<object type="application/avplayer">`,
  video on a plane under transparent HTML, `setDisplayRect` in 1920×1080
  space. HLS (v7/v10), DASH, Smooth, TS over HTTP. Tracks via
  `getTotalTrackInfo`/`setSelectTrack` (TEXT not for DASH). Subtitles
  arrive as text via `onsubtitlechange`; external subtitles must be a
  local file. `setDrm` for PlayReady/Widevine. Live DVR window via
  `getStreamingProperty('GET_LIVE_DURATION')`. Known limits: no
  PROGRAM-DATE-TIME through 2020, no LL-HLS/IMSC1, some live HLS never
  prepares.
- hls.js on Tizen works but has open Tizen issues (long-stream
  degradation, discontinuity stalls, crashes on 2023). mpegts.js Tizen
  performance unknown [U]; heavy on 2018 hardware [I].

### 2.5 Input [V]
- Delivered without registration: arrows, Enter (13), Back (10009).
- Must `tizen.tvinputdevice.registerKey(Batch)`: digits 48–57, colors
  403–406, media (Play 415, Pause 19, PlayPause 10252, Stop 413,
  Rew 412, FF 417, Prev 10232, Next 10233), ChannelUp/Down 427/428,
  Info 457, Guide 458, Exit 10182, Caption 10221, Search 10225.
- **The Smart Remote (default on most models) has no color or number keys**
  — a "123" button opens an on-screen pad. Long-press Back = Exit.
- No pointer remote since 2016. USB/BT mice still work.
- IME Done/Cancel keys 65376/65385.

### 2.6 Platform services [V unless marked]
- **Alarms**: `tizen.alarm.add(AlarmAbsolute, appId, appControl)` launches
  the app. Whether it wakes a closed app reliably / from standby / after
  reboot [U].
- **No notification/toast API on TV** → in-app only.
- **Lifecycle**: JS pauses on hide; `visibilitychange` fires; exit via
  `tizen.application.getCurrentApplication().exit()`; deep links via
  `getRequestedAppControl()` + `appcontrol` event (`reload="disable"`).
- **Screensaver**: `webapis.appcommon.setScreenSaver(OFF|ON)`.
- **Background web services** (`<tizen:service>`) run **Node.js** on TV and
  are usable with an ordinary Samsung cert (TizenBrew ships one running
  express on loopback). Node version per Tizen release [U] (v4.4.3 on
  Tizen 3), LAN bind (`0.0.0.0`) permitted [U], store acceptance [U].
- Storage: localStorage ~5 MB; IndexedDB supported, quota/eviction [U];
  `tizen.filesystem` available.

### 2.7 Fonts
UI font is Samsung One UI Sans; CSS family name exposed to web apps [U].
Custom web fonts (incl. Arabic) supported. Inline-SVG icon rule still applies.

### 2.8 Emulator / automation [V]
TV Extension 10.0 emulator ships for Ubuntu (no DRM, no 4K, needs KVM).
No headless CI emulator. Automation = Playwright with stubbed `tizen`/
`webapis` + manual/scripted `sdb` checks on a real TV.

---

## 3. Codebase coupling inventory

Paths are repo-relative. Counts are non-test lines.

### 3.1 Keys and input
- `src/config.ts:188-212` — `KEYS` (BACK 461, CH±=33/34, CURSOR 1536/1537).
- `src/navigation/key-handler.ts` — `ACTION_MAP` (:25-44),
  `INPUT_PASSTHROUGH_KEYS` (:53-56), cursor pseudo-keys (:278-292),
  `cursorStateChange` (:427-434), wheel → channel (:440-473).
- Hard-coded BACK/ESC in input listeners: `sidebar.ts:1256`,
  `epg-grid.ts:960`, `settings.ts:585-587`,
  `channel-list-editor.ts:150-164`.
- `edge-scroll.ts:202-217` (cursor events).
- No `play_pause` toggle action in the `Action` union (`types.ts:378`).
- Color-key-only actions with no on-screen path (matters for the Smart
  Remote): Green favorite in player (`app.ts:1733`) and channel list
  (`channel-list.ts:652`), Yellow OSD in player (`app.ts:1738`), Green
  "today" in EPG (`epg-grid.ts:1458`). Red/Blue (Guide/Settings) and
  editor actions already have on-screen paths.

### 3.2 Lifecycle and shell
- `app.ts:1567-1570` cold launch params (`PalmSystem.launchParams`),
  `:1562` `webOSRelaunch`, `:484` `window.close()`.
- `app.ts:433-455` bundled-service start/stop on visibility.
- `keyboardStateChange`: `sidebar.ts:1238-1243`,
  `channel-list-editor.ts:224-239`.
- Boots in pointer mode (`input-mode.ts`; `index.html` lacks
  `keyboard-nav`) — wrong default on Samsung.
- `css/main.css:150` font stack names `'LG Smart UI'`.
- `utils/logger.ts:89-98` logs webOS version from UA.
- `appinfo.json` `disableBackHistoryAPI`, `requiredACG`.

### 3.3 Luna and services
| Luna target | Caller | Tizen replacement |
|---|---|---|
| `…pleione.service/start\|stop\|serviceEvents\|getDevMode` | `app.ts:510-716` | Tizen web service + message port / localhost (optional, §6.4) |
| `activitymanager/create\|cancel` | `reminder-service.ts:355,391` | `tizen.alarm.add/remove` |
| `notification/createToast\|createAlert`, `applicationManager/launch` | AM callback, bundled service | none (in-app prompt; alarm launches app) |
| `com.webos.service.drm` (PlayReady) | `playready-drm.ts`, `player-pipeline.ts:146,570` | EME via Shaka (`com.microsoft.playready`) or AVPlay `setDrm` |
| `com.webos.media/setSubtitleEnable` | `player-tracks.ts:664-692` | native `textTracks`, or AVPlay `setSilentSubtitle`/`setSelectTrack` |

- Storage is plain web standards; `idb-cache.ts` quota branches already
  feature-detect.
- LAN setup/upload (`setup-client.ts`, `upload-client.ts`,
  `bundled-service/`): app side already treats "no service" as
  unreachable; UI shows nothing usable.

### 3.4 Playback (~7,000 lines in scope)
- Path fork: `player-pipeline.ts:256-390` (`isWebOS()` → native `<source>`
  with MIME routing + IDB route cache; else hls.js/mpegts/Shaka/`src=`).
- Other `isWebOS()` gates: stall watchdog (`player.ts:358,383,685,1239`),
  CC row (`player-tracks.ts:627,665`).
- Strictly Luna/`mediaOption`: ~350 lines. Native-workaround code
  (manifest-parsed track names, HLS/DASH subtitle self-render, MIME
  sniff/cache): ~1,500–1,900 lines, portable and reusable on Tizen native.
- Seams: `MseEngine` (tracks + stream info) and `PlayerPipeline` facade.
  **No transport seam**: `Player`, `PlayerTracks`, subtitle sinks,
  `PlayerPresentation` (live preview) take a raw `HTMLVideoElement`; all
  text subtitles render through Blink `TextTrack`. An AVPlay backend needs
  a media facade + a DOM cue renderer; a `<video>`/MSE backend needs none.
- Bundling: hls.js/mpegts.js are external and only in the preview build
  (`preview-libs.js`); Shaka ships always, lazy-loaded.
- PlayReady on the non-webOS path is dropped (`player-pipeline.ts:371-375`;
  Shaka only maps Widevine/ClearKey at :717).

### 3.5 Build, tests, CI, docs (~55–80 files total)
- `esbuild.config.mjs` (version sync, static copies, defines, entries,
  preview libs, notices), `build.sh`, `package.json`, `vitest.config.ts`,
  `src/globals.d.ts`, `index.html`, `.gitignore`, `assets/build-icons.sh`,
  `scripts/sync-version.mjs`, `scripts/third-party-notices.mjs`.
- E2E: two projects; webOS faked per spec (UA spoof, `FakePalmServiceBridge`);
  ~20 specs dispatch literal `461`.
- CI: `.github/workflows/build.yml` (ares-package, IPK artifact, release).
- Tooling: `scripts/tv.sh` + `tv-*.mjs` + `cdp-client.mjs` (ares/SSH/CDP 9998).
- Docs: `AGENTS.md`, skills (`webos-device`, `legacy-engine`, `ui-design`,
  `feature-review`, `ui-copy`), `README*`, ~7 `docs/*.md`, `store/`, `site/`.

---

## 4. Target architecture

### 4.1 Build-time platform
- New define `__PLATFORM__: 'webos' | 'tizen'`, kept in lockstep in
  `esbuild.config.mjs`, `vitest.config.ts`, `src/globals.d.ts` (AGENTS.md
  rule). esbuild dead-code-eliminates the other platform.
- `node esbuild.config.mjs --platform=tizen` → `dist-tizen/`; default stays
  `webos` → `dist/`. `--preview` stays a separate axis (desktop).
- Per-platform static files: webOS copies `appinfo.json`, `resources/`,
  `icon.png`/`largeIcon.png`; Tizen generates `config.xml` from
  `platform/tizen/config.xml.tmpl` (version from `package.json`, localized
  names from the same source as `resources/`) and copies Tizen icons.
- Tizen `index.html` gets `<script src="$WEBAPIS/webapis/webapis.js">`
  (only if AVPlay/productinfo/appcommon are used) via the existing marker
  mechanism.
- `__APP_ID__` becomes per-platform (Tizen: `<pkg>.Pleione`).

### 4.2 `src/platform/` adapter
```
src/platform/
  index.ts          // export const platform: Platform (picked by __PLATFORM__)
  types.ts          // Platform interface
  webos/            // wraps today's code: luna, PalmSystem, keys
  tizen/            // tizen.*, webapis.*
  desktop.ts        // preview: no-ops (or folded into webos with guards)
```
Interface (first cut):
- `keys`: the keymap (replaces `CONFIG.KEYS` platform parts) +
  `registerKeys()` at boot.
- `exit()`, `launchParams(): unknown`, `onRelaunch(cb)`.
- `onVirtualKeyboard(cb)` (webOS `keyboardStateChange`; Tizen: focus +
  `resize` heuristic).
- `pointerDefault: boolean` (webOS true, Tizen false → boot in
  `keyboard-nav`).
- `scheduleReminder(id, at, payload) / cancelReminder(id)` + `deliversClosedAppAlerts`.
- `setScreenSaver(enabled)` (Tizen real; webOS no-op for now).
- `playback`: capability record consumed by the pipeline (see §5).
- `lanService?`: start/stop/events, absent when unsupported.
- `describeEnvironment()` for `logEnvironment`.

`isWebOS()` call sites become `platform.playback.*` capability checks.
`luna.ts` stays, imported only from `platform/webos/` and webOS-only
services.

---

## 5. Playback plan

### 5.1 Recommended: staged
**Stage A — native `<video>` + Shaka (ship this first).**
- Tizen gets the *native* branch of `player-pipeline.ts` (same as webOS)
  minus Luna bits: `<source>` + MIME routing, manifest-parsed names,
  HLS/DASH WebVTT self-render, IDB route cache, stall watchdog on.
- HLS → native. Raw MPEG-TS over HTTP → native `video/mp2t` if the
  device plays it [U]; else mpegts.js fallback (ship it in the Tizen
  bundle as a lazy chunk like Shaka).
- DASH clear/Widevine/ClearKey → Shaka (already). PlayReady → Shaka with a
  new `com.microsoft.playready` mapping (server URL + custom data headers)
  instead of the Luna `PlayReadyDrm`.
- Captions: no Luna compositor → CC row hidden; in-band 608 via
  `textTracks` if the engine exposes it [U].
- Audio switching via `audioTracks[i].enabled` on Tizen 5.5–7; on 8+
  hide the picker for multi-audio native streams (or route those to
  Shaka/hls.js) until Stage B.
- Capability record:
  `{ native: true, nativeDashMediaOption: false, nativeCcCompositor: false,
     playReady: 'eme', audioTrackSwitch: <by version>, stallWatchdog: true }`.

**Stage B — AVPlay engine (only if Stage A falls short on device).**
Triggers: Tizen 8+ multi-audio, TS streams the native element refuses,
4K/HDR or performance gaps.
- Introduce a `MediaBackend` facade over the ~40 element operations
  `Player` uses (load/play/pause/seek, time/duration/seekable,
  readyState/networkState, events, volume, error, display rect).
  `HtmlVideoBackend` wraps today's element; `AvplayBackend` implements it.
- AVPlay tracks via an `MseEngine`-style adapter (`getTotalTrackInfo`).
- Subtitles: a DOM cue renderer fed by `onsubtitlechange`; sidecar
  SRT/VTT parsed in JS and rendered by the same renderer (avoids local-file
  requirement); assjs needs a clock shim.
- Live preview: `PlayerPresentation` → `setDisplayRect`.
- Biggest single work item; estimate 1.5–3 weeks.

### 5.2 Alternative: MSE-first (hls.js + mpegts.js + Shaka everywhere)
Fastest to stand up (desktop path already works), but known hls.js Tizen
bugs, JS transmux cost on 2018–2019 hardware, and it bypasses the
hardware pipeline the webOS build deliberately uses. Keep as fallback only.

---

## 6. Feature-by-feature

### 6.1 Remote keys
- Tizen keymap: BACK 10009, CH± 427/428, EXIT 10182 → `exit`,
  PLAYPAUSE 10252 → new `play_pause` action, INFO 457 → OSD, GUIDE 458 →
  Guide, plus standard colors/media/digits.
- `registerKeyBatch` at boot for every non-default key we map; tolerate
  missing keys (`getSupportedKeys`).
- Replace hard-coded `CONFIG.KEYS.BACK` checks in input listeners with a
  helper `isBackKey(e)`; add IME Done/Cancel.
- Drop cursor pseudo-keys on Tizen (map absent).
- **Smart Remote gap**: add on-screen paths for Green favorite (player OSD
  and channel row action), Yellow-only OSD (OK/Info/Up already show it —
  verify), EPG "today" (a filter-bar button). Benefits webOS non-Magic
  remotes too.

### 6.2 Lifecycle
- Exit → `tizen.application.getCurrentApplication().exit()`.
- Launch/relaunch params → `getRequestedAppControl().appControl.data`
  (`PAYLOAD`) + `appcontrol` event; `config.xml` app-control with
  `reload="disable"`.
- Back at root: keep "press Back again to exit" unless store review
  requires immediate exit (decision D6).
- Screensaver off while video plays, on when paused/stopped
  (`webapis.appcommon`). Also a small UX win; webOS no-op.
- On resume: re-check network, restart live stream (JS was paused).

### 6.3 Reminders
- `tizen.alarm.add(new AlarmAbsolute(date), appId, appControl{reminderChannelKey})`;
  cancel with `tizen.alarm.remove`. Store alarm id per reminder.
- No system toast → when the alarm fires the app **launches** (or comes to
  front) and shows the in-app `ReminderPrompt`. Device-verify behavior
  when TV is in standby/off [U].
- Decision D5 picks between launch-on-alarm and in-app-only.

### 6.4 LAN phone setup / M3U upload
- Option 1 (recommended later phase): port `bundled-service/` as a Tizen
  web service (`<tizen:service>`). Its Node 0.12/ES5 constraint already
  satisfies Node 4. Replace `webos-service` with a thin host shim; app↔
  service doorbell via `tizen.messageport` or polling loopback HTTP.
  Blockers to verify first: LAN bind allowed, service start/stop from the
  app, Node version per release.
- Option 2: ship Tizen without LAN setup (Settings hides the phone-setup
  card when `platform.lanService` is absent); users type URLs/credentials
  with the remote.
- Option 3: cloud relay — new infra and changes the privacy promise
  (`site/content/privacy.md`); not recommended.

### 6.5 DRM
- Widevine/ClearKey: Shaka/EME, unchanged.
- PlayReady: add Shaka `com.microsoft.playready` config (license URL,
  custom data → `X-...` header or challenge customization). Store DRM may
  need partner level [U].

### 6.6 Storage
No change. Verify IndexedDB quota branch chosen on device; consider the
`unlimitedstorage` privilege.

### 6.7 Fonts / RTL
Add the Samsung family name to `css/main.css` font stack once confirmed on
device; Arabic shaping via Chromium [I] — verify with the `ar` locale.

---

## 7. Packaging, signing, distribution

- `platform/tizen/config.xml.tmpl`:
  `tizen:application id="<pkg>.Pleione" package="<pkg>" required_version="4.0"`,
  `tizen:profile name="tv-samsung"`, `content src="index.html"`,
  `access origin="*" subdomains="true"`, privileges
  (`internet`, `tv.inputdevice`, `application.launch`, `alarm`,
  `network.public`, `productinfo`, `unlimitedstorage`, `tv.window`
  if AVPlay, `drmplay` if PlayReady/AVPlay DRM),
  `tizen:setting screen-orientation="landscape" context-menu="disable"
  background-support="disable" encryption="disable"
  install-location="auto" hwkey-event="enable"`, app-control for deep
  links, localized `<name xml:lang>`.
- `<pkg>`: generate a random 10-char id **once** and never change it (with
  the author cert, it is the app's permanent identity).
- `build-tizen.sh` (or `build.sh --tizen`): lint → build `--platform=tizen`
  → `tizen package -t wgt -s <profile>` → `--install [ip]` does
  `sdb connect`, `tizen install`, cold restart, `tizen run`.
- Icons: add Tizen sizes to `assets/build-icons.sh` (exact Samsung
  requirements [U]).
- `scripts/config-privileges.test.mjs`: analogue of `appinfo-acg.test.mjs`
  — every `tizen.*`/`webapis.*` namespace used has its privilege.
- CI: a `tizen` job using a pinned Tizen CLI Docker image; produce an
  author-signed `.wgt` artifact from secrets (author `.p12` + Samsung
  distributor cert/password); skip signing on fork PRs; attach `.wgt` to
  releases. Note: a CI-signed `.wgt` only installs on DUIDs in that
  distributor cert — public users re-sign with Apps2Samsung.
- Distribution (decision D3): GitHub release `.wgt` + Apps2Samsung
  instructions; optional TizenBrew module; optional US Seller Office.

---

## 8. Testing

- **Unit**: `src/platform/tizen/*.test.ts` with stubbed `tizen`/`webapis`
  (keymap, registerKeys, exit, launch params, alarms, screensaver).
  `player-pipeline-tizen.test.ts` beside `player-pipeline-webos.test.ts`.
  Vitest runs both platforms (define per test file via `vi.stubGlobal` or a
  second Vitest project with `__PLATFORM__='tizen'`).
- **E2E**: a third Playwright project `tizen-sim`: preview build with
  `--platform=tizen`, init script installing fake `tizen` (tvinputdevice,
  application, alarm) and `webapis` (appcommon, productinfo), UA with
  `Tizen`. Run a focused subset (startup, key nav/Back, player, reminders,
  settings without LAN). Replace literal `461` in specs with a
  `KEY.BACK` helper so specs run on both.
- Ring audit (two rings = fail) applies unchanged.
- No floor change if Tizen 4+ (Chromium 56 > 53).
- **Device**: scripted smoke over `sdb` (install, run, CDP logs/eval through
  `sdb forward` + existing `cdp-client.mjs`), plus a manual checklist per
  release on at least one Tizen 4–5 TV and one Tizen 8+ TV.

---

## 9. Tooling, docs, site

- `scripts/tizen.sh`: `connect`, `install`, `run`, `restart`, `logs`,
  `eval` (reuse `cdp-client.mjs` with a CDP URL from
  `sdb shell 0 debug <appId>` + `sdb forward`). No SSH/`/dev/input`/Luna
  probes on retail Tizen; `diag` gets a reduced Tizen variant later.
- New skill `.agents/skills/tizen-device/` (mirror of `webos-device`).
- `AGENTS.md`: platform section, `__PLATFORM__` rule, Tizen gotchas
  (Back 10009, registerKey, Smart Remote has no color keys, no toasts,
  JS paused on hide, audioTracks broken on 8+).
- `legacy-engine` skill: Tizen version→Chromium table; floor statement.
- `docs/tizen.md` (playback paths, keys, lifecycle, reminders, LAN),
  short Tizen notes in `audio-track-selection.md`, `hls-subtitles.md`,
  `mpeg-dash.md`, `storage-and-data.md`, `lan-service.md`.
- `README*`: supported platforms, Samsung install via Apps2Samsung,
  remote mapping per platform.
- `site/`: setup page for Samsung, home copy "LG and Samsung TVs",
  terms trademark line; `store/samsung/` if D3 includes the store.

---

## 10. Phases

Estimates are rough working days for one developer with AI help and a TV
on the desk.

| # | Phase | Output | Exit criteria | Est. |
|---|---|---|---|---|
| 0 | Device spike | Hello-world `.wgt` on the TV; answers to §11 | Checklist filled in `docs/tizen.md` | 1–2 |
| 1 | Platform layer (webOS only) | `__PLATFORM__`, `src/platform/`, call sites moved | All webOS unit + E2E green, no behavior change | 2–3 |
| 2 | Tizen shell | `--platform=tizen` build, `config.xml`, keys, exit, launch params, keyboard-nav default, `.wgt` packaging, `tizen.sh` | App boots, navigates, exits on TV | 2–3 |
| 3 | Playback Stage A | Native path on Tizen, mpegts fallback, Shaka PlayReady, capability gates, screensaver | Live HLS/TS, VOD, catch-up, DASH play on TV; tracks where supported | 3–5 |
| 4 | Smart Remote + reminders | On-screen paths for color-only actions, `tizen.alarm` reminders | Every action reachable without color keys; reminder fires | 2–3 |
| 5 | Tests, CI, docs | `tizen-sim` project, unit tests, CI `.wgt` job, docs/skills/README/site | CI green on both platforms | 2–3 |
| 6 | LAN service (optional) | Tizen web service port | Phone setup + upload work on TV | 3–5 |
| 7 | AVPlay (conditional) | `MediaBackend` + `AvplayBackend` | Gaps from Stage A closed | 8–15 |

Phases 1 and 4's Smart Remote work can land on webOS before any Tizen
code ships.

---

## 11. Device spike checklist

Run on a real Samsung TV (ideally one Tizen 4–6 and one Tizen 8+):
1. `canPlayType('application/vnd.apple.mpegurl')` and `('video/mp2t')`;
   does `<video src>` play live HLS, raw TS over HTTP, MKV/MP4 VOD?
2. `audioTracks` count/labels/switching on a multi-audio HLS stream.
3. In-band CEA-608 exposed as a `TextTrack`?
4. Self-rendered WebVTT (`addTextTrack` + `VTTCue`) draws over native video?
5. Seeking within a live DVR window via `currentTime`/`seekable`.
6. `getStartDate()` on HLS with PROGRAM-DATE-TIME.
7. Shaka PlayReady + Widevine with a test stream.
8. `tizen.alarm` with app closed, in standby, after reboot.
9. Web service: Node version, can it bind `0.0.0.0`, reachable from a phone.
10. IndexedDB quota (`navigator.storage.estimate` / webkit quota).
11. Font family name; Arabic rendering; symbol glyph coverage.
12. `sdb` + CDP debugging flow for `tizen.sh`.
13. Key codes actually delivered by the Smart Remote and a classic remote.

---

## 12. Decisions

Decided 2026-10-30:
- **D1 — Oldest supported Tizen: 4.0** (2018, Chromium 56). No floor change.
- **D2 — Playback:** native `<video>` + Shaka first (Stage A); AVPlay only
  if the spike or Stage A shows gaps (Stage B).
- **D3 — Distribution:** GitHub release `.wgt` + Apps2Samsung guide,
  optional TizenBrew module. No Samsung store for now.
- **D4 — LAN phone setup:** ship without it; port the bundled service as a
  Tizen web service after the spike confirms LAN binding (Phase 6).
- **D5 — Reminders:** `tizen.alarm` launches the app at air time and shows
  the in-app prompt.
- **D6 — Back at Home:** keep "press Back again to exit".
- **D7 — Test hardware:** two TVs — a 2020 model (`T` model code →
  Tizen 5.5, Chromium 69; software version 2743) and a current supported
  model (OS version to confirm). Neither covers the Tizen 4 floor itself,
  so Tizen 4 relies on the Chromium 53 gate plus emulator/best effort.
  The 2020 TV is on the working side of the `audioTracks` cutoff
  (5.5 <= v < 8); the new TV likely tests the broken side if it runs 8+.
