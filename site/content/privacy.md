<!--
  pleione.merope.dev/privacy. Every claim is checked against the code — if a
  feature changes what leaves the TV, this page changes in the same PR, and
  the effective date moves (see site/content/README.md).
-->

# Pleione — Privacy Policy

**Effective October 30, 2026** · Pleione is made by Merope ([merope.dev](https://merope.dev)).

## The short version

Pleione is a player for IPTV services **you already have**. It ships no channels or content, and
it has no account, no server of ours, and **no analytics, advertising, crash reporting or update
checks**. Your provider details, playlists, favorites and viewing history are stored **on your
TV**, in the app's own storage.

When Pleione goes online, it talks to **the providers you add** — and, only if you use them, to
the optional services listed below. None of those requests pass through anything of ours; we
never see them.

## What stays on your TV

- **Your sources**: playlist and program-guide (XMLTV) addresses, and Xtream account server
  addresses, usernames and passwords.
- **Your keys** for the optional services below, if you enter any.
- **Your library and history**: favorites, reminders, Watchlist, Continue Watching and playback
  positions, recently watched channels, recent searches, subtitle and audio choices, channel
  customization, and parental-control settings. The parental PIN is stored only as a salted
  hash, never as the PIN itself.
- **Caches**: downloaded playlists, guides, catalogs and subtitles, kept so the app opens
  quickly. They can be deleted at any time.

These are kept in the TV's storage for the app, which other ordinary TV apps cannot read.
Pleione does not add its own encryption on top. Nothing is synced to a cloud or backed up
anywhere else.

## Who Pleione talks to

### Your own providers

Pleione loads playlists, program guides, catalogs, posters, channel logos and video **directly
from the addresses you enter** (or that your playlist lists). Those requests carry what any
player's would: your TV's IP address, and for an Xtream account, the username and password, which
the Xtream protocol sends in the address of every request. If you enter an address starting with
`http://`, that traffic is not encrypted; whether `https://` is available is up to your
provider. Each provider's own privacy policy governs what they do with it.

**Check Channel Health**, a button in Settings, asks each channel's stream whether it responds.
It runs only when you press it, and only against your own providers.

### Online subtitles (optional, on request)

From the player's subtitle menu on a movie or an episode, **Search online…** looks for subtitles
with the services you choose, and downloads the one you pick:

- **OpenSubtitles** and **SubDL** work only with **your own** API key (and, for OpenSubtitles,
  your account's username and password, which are sent to OpenSubtitles to sign in before a
  download).
- **Assrt** works without setup, using a shared public key unless you enter your own.

A search sends the title — or the IMDb or TMDB id your provider lists for it — and, where known,
the year or the season and episode number. It never sends the video, a file fingerprint, or
anything about your provider. Your preferred subtitle language stays on the TV. A subtitle you
picked is remembered for that title; if its cached copy has expired, Pleione downloads that same
subtitle again the next time you play the title.

### Cast photos — TMDB (optional)

If you enter **your own** TMDB API key in Settings, a movie or series page shows its cast with
photos from [The Movie Database](https://www.themoviedb.org). Pleione sends TMDB only the TMDB or
IMDb id that your provider lists for that title, authenticated with your key; the photos are
loaded from TMDB's image server. Without a key, nothing is sent to TMDB. TMDB's handling of these
requests is governed by its own terms and privacy policy.

### Phone setup on your home network

So you can type addresses and passwords on a phone instead of a TV remote, Pleione includes a
small setup service that runs **on the TV** while the app is open, and stops when you leave it.

- It serves a setup page to devices on **your home network** (it is not reachable from the
  internet unless your router is set up to forward it). The TV shows its address, a QR code, and
  a four-digit pairing code.
- To change anything, a phone must first enter that code or scan the code's QR link. A new code
  is made each time the service starts, and repeated wrong codes are locked out.
- Through the page, a paired device can add sources, accounts and subtitle or TMDB keys, and upload
  an `.m3u` playlist file. The page never shows saved passwords or keys back.
- Uploaded playlist files are stored on the TV, and **any device on the same network** can list
  and download them while the app is open. If an uploaded playlist contains a username or
  password, keep that in mind on a shared network, and remove the upload when you no longer need
  it.
- The service itself makes no requests to the internet.

### Reminders

When you set a reminder for a program, Pleione schedules it with the TV's own scheduler, which
keeps the program's title, channel and time so it can notify you even while the app is closed.
For content locked by parental controls, the title and channel are left out.

## Analytics and tracking

None. Pleione contains no analytics, advertising, tracking, crash-reporting or remote-logging
code, does not check for updates, and does not contact any server of Merope's. Its logs stay in
the TV's developer console. It requests no special TV permissions.

This website is static pages; it sets no cookies and runs no analytics either.

## Deleting your data

- **Settings › Data Management › Reset App** removes your accounts, sources, preferences,
  favorites, history and caches from the TV and restarts the app.
- **Clear Cache** removes only downloaded data; separate buttons clear Recently Watched, Continue
  Watching and the Watchlist.
- **Uploaded playlists** belong to the setup service: remove them from **Settings › Sources ›
  Uploaded Playlists** before resetting, or the app may find them again.
- **Uninstalling** Pleione removes the app and the data in its app storage from the TV. Remove
  uploaded playlists first, as above: depending on the TV, the setup service may keep them in a
  folder of the TV's own.

Because we hold none of your data, there is nothing for us to delete on our side. Data held by
your providers, OpenSubtitles, SubDL, Assrt or TMDB is subject to their own policies.

Pleione is not directed at children under 13.

## Changes

If what Pleione sends off your TV changes, this page changes with it, and the effective date at
the top moves.

## Contact

support@merope.dev
