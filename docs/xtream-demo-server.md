# Demo Xtream server

A local Xtream Codes server for testing the whole app by hand, in the
desktop preview or on a TV on your LAN. It serves a synthetic catalog
(channels, a multi-day guide, movies, series) and real, playable media
that ffmpeg generates on your machine. It is a development tool only:
nothing of it ships in the app or the `.ipk`.

Code: `scripts/xtream-demo-server.mjs` (entry) and `scripts/xtream-demo/`.

## Start

Needs Node.js and `ffmpeg` with `libx264` and the native `aac` encoder on
`PATH`.

```bash
npm run xtream:demo                  # small catalog on port 8090
npm run xtream:demo -- --size large  # ~2000 channels / 1500 movies / 300 series
npm run xtream:demo -- --prepare     # encode all media now, then exit
npm run xtream:demo -- --help
```

The first start encodes the shared audio loops and VOD clips (about a
minute) into `.cache/xtream-demo/` (git-ignored). Each live channel's
loop is encoded the first time it is played, which takes a few seconds;
`--prepare` encodes every channel in advance (`--jobs` sets the
parallelism). Delete `.cache/xtream-demo/` to start over.

On start it prints every URL it listens on, including your LAN
addresses, and the credentials:

```text
[xtream-demo] Server URL: http://127.0.0.1:8090
[xtream-demo] Server URL: http://192.168.1.20:8090
[xtream-demo] Username: demo
[xtream-demo] Password: demo
```

In the app, open **Settings → Xtream Accounts**, add an account with one
of those URLs and the credentials, and save.

| Option | Env | Default | |
| --- | --- | --- | --- |
| `--port` | `XTREAM_DEMO_PORT` | `8090` | `0` picks a free port |
| `--host` | `XTREAM_DEMO_HOST` | `0.0.0.0` | `127.0.0.1` keeps it off the LAN |
| `--size` | `XTREAM_DEMO_SIZE` | `small` | `small` or `large` |
| `--username` / `--password` | `XTREAM_DEMO_USERNAME` / `XTREAM_DEMO_PASSWORD` | `demo` / `demo` | |
| `--cache-dir` | `XTREAM_DEMO_CACHE` | `.cache/xtream-demo` | |
| `--prepare`, `--jobs` | | | pre-encode everything |
| `--verbose` | | | log every request |

## Desktop preview

```bash
npm run xtream:demo            # terminal 1
npm run preview                # terminal 2, then open http://localhost:3000
```

Add `http://127.0.0.1:8090` in Settings. The server sends permissive CORS
headers (including the private-network preflight answer), so the
browser can fetch every endpoint and stream.

## On a TV

Start the server with the default `--host 0.0.0.0`, then use the LAN URL
it prints (`http://192.168.x.y:8090`) on the TV. The machine's firewall
must allow inbound TCP on the port.

**WSL2:** the default NAT networking gives WSL a private address
(`172.x.y.z`) that the LAN cannot reach. Either

- switch WSL to mirrored networking: add
  `[wsl2]` / `networkingMode=mirrored` to `%UserProfile%\.wslconfig`,
  run `wsl --shutdown`, and use the Windows machine's LAN address; or
- keep NAT and forward the port from Windows (admin PowerShell):
  `netsh interface portproxy add v4tov4 listenport=8090 listenaddress=0.0.0.0 connectport=8090 connectaddress=<WSL address>`.

Either way, also allow the port through the Windows firewall, for example
`New-NetFirewallRule -DisplayName "Xtream demo" -Direction Inbound -Protocol TCP -LocalPort 8090 -Action Allow`.

## What's in the catalog

Everything is deterministic and synthetic.

| | Small | Large |
| --- | --- | --- |
| Live channels | 150 in `Group 1`-`Group 8` | 2000 in 40 groups |
| Catch-up | every third channel (and `Alpha`), 3 days | 1 day |
| Guide | 3 past days + 2 days ahead | 1 + 1 day |
| Movies | 120 in 6 groups | 1500 in 25 groups |
| Series | 24 in 4 groups, 1-3 seasons | 300 in 12 groups |

Channels are `Alpha`, `Bravo`, `Charlie`, then `Channel 4`, `Channel 5`,
and so on; programmes are `Program N`; movies are `Movie A`, `Movie B`, …;
series are `Series A`, …. Logos, posters, covers and episode stills are
SVGs the server draws. Movies carry ratings, years, durations and spread
`added` dates, so every sort order has something to sort.

Edge cases:

- `Channel 4` has a very long name.
- `Channel 6` has no `epg_channel_id` and no guide data.
- The last live, movie and series group is empty.
- `Movie A` has two audio tracks (`Track 1`, `Track 2`), an embedded
  subtitle track (`Track 3`), and two sidecar subtitles in
  `info.subtitles` (`Sidecar SRT`, `l1`; `Sidecar WebVTT`, `l2`). The
  first episode of `Series A` lists the same sidecars.
- `Series D` sends an empty `seasons` list and episodes without a
  `season` field.
- Fields mix numbers and numeric strings the way real panels do.

## Media

All media is H.264 + AAC at 640x360, built from ffmpeg's color-bar and
sine-tone test sources.

- **Live HLS** (`/live/<user>/<pass>/<id>.m3u8`): a master playlist with
  two audio renditions (`Track 1`/`l1` and `Track 2`/`l2`, different
  tones) and a WebVTT subtitle rendition (`Track 3`/`l1`, a cue per
  second showing the UTC time). Each channel loops 60 seconds of video
  with its name and a seconds counter burned in. The playlists slide with
  the wall clock in 4-second segments over a five-minute DVR window,
  every segment carries `EXT-X-PROGRAM-DATE-TIME`, and timestamps are
  rewritten per loop, so the stream plays as one continuous live
  timeline and the burned-in seconds match the clock.
- **Live MPEG-TS** (`/live/<user>/<pass>/<id>.ts`, also
  `/<user>/<pass>/<id>`): the same loop muxed with both audio tracks,
  streamed continuously at real-time pace. The app requests `.ts` unless
  the account's live output is set to HLS.
- **Catch-up**: `/timeshift/<user>/<pass>/<minutes>/<YYYY-MM-DD:HH-MM>/<id>`
  with `.m3u8`, `.ts` or no extension, and
  `/streaming/timeshift.php?…&stream=&start=&duration=`. The start is in
  the server's time zone, which is UTC (`server_info.timezone`). HLS
  answers with a closed playlist (or an open one while it reaches the
  live edge); TS streams the window faster than real time.
- **VOD** (`/movie/…/<id>.mp4`, `/series/…/<id>.mp4`): faststart MP4
  clips of 1.5-3 minutes with a running time burned in, served with
  `Range` support for seeking.

## API surface

`player_api.php` without an action returns `user_info` and `server_info`;
the actions are `get_live_categories`, `get_live_streams`,
`get_vod_categories`, `get_vod_streams`, `get_vod_info`,
`get_series_categories`, `get_series`, `get_series_info`,
`get_short_epg`, and `get_simple_data_table` (also the legacy
`get_simple_date_table` spelling). The list actions accept
`category_id`. `get.php` (`type=m3u_plus` or `m3u`, `output=ts` or
`m3u8`) lists live channels, then movies and episodes; `xmltv.php`
serves the guide. Wrong credentials get `{"user_info":{"auth":0}}` from
the Player API and `401` elsewhere.

## Known gaps

Compared with a real provider: one fixed account with no connection
limits or expiry, no redirects or tokenized stream URLs, UTC as the only
server time zone, one video quality, the same 60-second loop for every
hour of a channel's archive, and episodes that all share one clip.
