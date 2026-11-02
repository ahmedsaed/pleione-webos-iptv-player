# Pleione — UX scenario for LG app review

Pleione is an IPTV **player**: it ships with no channels or content. To test it, the reviewer adds
the test account below, which serves synthetic test media made for this review (color bars, test
tones, and titles such as "Alpha", "Movie A" and "Series A"). Every step below uses that account.

Every step works with the standard remote alone: the arrows, **OK**, **Back**, the color keys,
the number keys and **CH +/−**. The Magic Remote pointer works too, but is never required.
Button and screen names are written as they appear in the app in English.

## 0. Test account

| Field | Value |
|---|---|
| Account type | Xtream account |
| Server URL | `[DEMO XTREAM URL]` |
| Username | `[DEMO USERNAME]` |
| Password | `[DEMO PASSWORD]` |

The server runs for the whole review period. It offers about 150 live channels in eight groups
(**Group 1** to **Group 8**) plus **Group HD**, a program guide covering the past three days and
the next two, a movie catalog and a series catalog.

- Channel **Alpha** (number 1) has catch-up, so its past programs can be played.
- **Movie A** has two audio tracks (**Track 1**, **Track 2**) and several subtitle tracks.
- **Group HD** holds the resolution test streams (section 10).

## 1. First launch and adding the account

1. Launch **Pleione**. Home shows **Welcome to Pleione**, "Add a source to start watching.", a
   **Set up with your phone or computer** panel with a QR code, an address and a four-digit
   pairing code, and two cards: **Add Xtream account** (selected) and **Add M3U playlist**.
2. Press **OK** on **Add Xtream account**. Settings opens on **Sources** with a new account under
   **Xtream Accounts**, its **Label** field selected.
3. Press **OK** on each field and type with the on-screen keyboard, then press **Down** to the
   next field:
   - **Label**: `Test`
   - **Server URL**, **Username**, **Password**: the values in section 0.

   Leave **Live stream format** on **TS (compatible)** for now (section 10 changes it).
4. Select **Check**. The account shows **Active**.
5. Select **Save Changes**. The app returns to Home.

Expected: no error. Home now shows the app name, the clock, the account's initial in a circle at
the top right, and five cards: **Live**, **Movies**, **Series**, **Search** and **Settings**,
with **Live** selected.

Instead of typing on the TV, the account can be added from a phone (section 8).

## 2. Home

1. Use the arrows to move between the five cards; **Up** reaches the account circle (**Switch
   account**, which lists the accounts added).
2. Press **OK** on a card to open that section. **Back** from any section returns to Home, with
   that section's card selected.
3. Press **Back** on Home: the app closes at once (section 9).

## 3. Live TV

1. On Home, select **Live**. Live opens in three panes: the groups on the left (**All**,
   **Favorites**, **Recently Watched**, **Group 1** …), the channel list in the middle with each
   channel's current and next program, and a preview on the right. A legend at the bottom reads
   **OK Watch**, **Green Favorite** and **Red Guide**.
2. Press **Down** through the channels. When the selection rests on a channel for a moment, the
   preview starts playing it, with its program details and the next programs below.
3. Press **Left** to the groups, **Down** to **Group 2**, then **OK**: the list
   shows that group's channels.
4. On a channel, press **Green**: it is added to **Favorites** (a message confirms). Press
   **Green** again to remove it.
5. Press **OK** on a channel: it plays full screen. Press **Up** / **Down** (or **CH +/−**) to
   change channel, or type a channel number (for example **3**) to tune it.
6. Press **Back**: Live returns, with the channel just watched selected.

### The Guide

1. In Live, press **Red**. The **Guide** opens beside the groups: a timeline with each channel
   in a row, the programs as cells, and a line marking the current time. The legend reads **OK**
   (with what OK does on the selected cell), **Earlier and later**, **Back Groups** and **Red
   List**.
2. Press **Up** / **Down** to move between channels and **Left** / **Right** to move through
   time.
3. **OK on the program now on air** plays the channel full screen. Press **Back** to return to
   the Guide.
4. **OK on a future program** sets a reminder: "Reminder set" appears and a bell marks the
   program. Press **OK** again to remove it ("Reminder removed").
5. **OK on a past program**: go to **Alpha** (number 1), press **Left** past the current program
   into the past, and press **OK**: the program plays from its start (catch-up). Press **Back**
   to return to the Guide. Channels without catch-up do not go into the past: **Left** moves to
   the groups instead.
6. Press **Red** to return to the list, or **Back** to step to the groups, then **Back** again to
   go Home.

## 4. Player controls

### Live

1. Play channel **Alpha**. Press **OK** (or **Yellow**): the controls appear with the channel's
   name and number, the **NOW** and **NEXT** programs and a progress bar, and a row of buttons:
   **Toggle Favorite** and **Channel Info** on the left, **Play/Pause** in the middle, and
   **Audio Track** and **Subtitles** on the right. Small boxes beside the channel name show the
   stream's resolution, codecs, audio track and subtitles.
2. Use **Left** / **Right** to move between the buttons and **OK** to press one. **Channel Info**
   shows the channel's program details. **Up** hides the controls.
3. Open **Audio Track** and choose **Track 2**: the tone changes. Open **Subtitles** and choose
   **Track 3**: a caption with the time appears; choose **Off** to remove it.
4. **Back** hides the controls; **Back** again stops playback and returns to Live.

### Movies and episodes

1. Play **Movie A** (section 5). **Left** / **Right** skip back and forward (also with the
   controls hidden); **OK** pauses and resumes; **⏪** / **⏩** also skip.
2. Press **Up** or **Down** to show the controls without pausing: the seek bar is selected, and
   **Left** / **Right** move along it. Press **Down** to reach the buttons: **Play from start**
   and **Play/Pause** in the middle (for a series, **Previous episode**, **Play/Pause** and
   **Next episode**), with **Audio Track** and **Subtitles** on the right. **Play from start**
   restarts the movie. **Up** from the buttons returns to the seek bar, and **Up** again hides
   the controls. While a movie loads or after a skip, a spinner shows until it plays.
3. **Audio Track**: choose **Track 2**. **Subtitles**: choose **Track 3** or **Sidecar SRT**, then
   **Off**. **Subtitle Sync** in the same menu shifts the subtitles with **Left** / **Right**.
4. **Back** hides the controls if they are showing; **Back** again stops playback and returns to
   the detail page.

## 5. Movies and Series

1. From Home, select **Movies**. A large preview of the selected title sits above rows of
   posters: **Continue Watching** (once something has been played), then one row per category,
   each ending with **See all**.
2. Move with the arrows; the preview follows the selection. Press **OK** on **Movie A**.
3. The detail page shows the title, year, length, genre, rating and plot, with the buttons
   **Play** and **Watchlist**, then the **Cast** row and the **More like this** row.
4. Select **Watchlist**: "Added to Watchlist" appears. Select it again to remove the title
   ("Removed from Watchlist").
5. Select **Play**. After a minute, press **Back** (twice if the controls show). The detail page
   now offers **Resume** with the position, and **Play from start**. Select **Resume**: playback
   continues where it stopped. Back on the Movies page, the title is in **Continue Watching**.
   **OK** on it there opens its detail page.
6. To take a title out of **Continue Watching**, **hold OK** on it for about a second: a small
   menu offers **Remove from Continue Watching** and **Cancel**. Select **Remove from Continue
   Watching**: the title leaves the row and "Removed from Continue Watching" appears. **Back**
   closes the menu without removing anything.
7. On the detail page, press **Down** to **More like this** and **OK** on a title: its detail page
   opens. **Back** returns to the previous page, then to Movies.
8. From Home, select **Series**, then **OK** on **Series A**. The detail page shows **Play**, the
   **Season 1**, **Season 2** … buttons and the **Episodes** row. Choose a season, then **OK** on
   an episode to play it. After **Back**, the detail page offers **Resume S1E1** and **Play from
   start**. In **Continue Watching**, a series shows once, at the episode watched last; **OK**
   opens the series' detail page with **Resume** on that episode.

## 6. Search

1. From Home, select **Search**. The search box is selected.
2. Press **OK** and type `Bravo` with the on-screen keyboard, then confirm. Results appear in rows
   by type: **Channels** (Bravo) and **Programs** airing on it. Type `Movie` instead to see
   **Movies** and **Series**.
3. Press **Down** into the results and **OK** on a channel to play it, on a movie or series to
   open its detail page, or on a program to watch it live, play its catch-up, or set a reminder.
4. **Back** from the results returns to the search box; **Back** again goes Home.
5. Open Search again: **Recent searches** lists the last searches.

## 7. Settings

Open **Settings** from Home. The pages are listed on the left; press **Right** to enter a page
and **Left** to return to the list. Changes apply with **Save Changes**; **Cancel** discards
them. **Back** closes an open list first, then goes Home.

1. **General**: **Language** (System, or one of the app's 12 languages; in **العربية**
   (Arabic) the whole interface is laid out right to left, while the player's seek bar and
   playback buttons keep their usual left-to-right order); **Set up with your phone
   or computer** with the QR code, address and pairing code; **Parental controls** (section 7a).
2. **Sources**: **Xtream Accounts** (with **Check**), **Playlists**, **Uploaded Playlists**, and
   **Channels** with **Edit Channel List**, **Show hidden channels**, **Reset Customization**
   and **Check Channel Health**.
3. **Program Guide**: manual XMLTV sources, **Program guide time zone**, **EPG time correction**,
   and **Manage Reminders** with the reminder set in section 3.
4. **Appearance**: **Theme** (the app recolors at once), **Player overlay style**, **Interface
   size** and **Text size**.
5. **Playback**: **Channel Up/Down** (Global or Active).
6. **Online Subtitles**: **Preferred subtitle language** and the user's own keys for SubDL, Assrt
   and OpenSubtitles; **Cast photos** with an optional TMDB key. With no keys, nothing is
   contacted and **Search online…** does not appear in the player.
7. **Advanced**: **Animation mode**, reconnect attempts, on-screen display timeouts and refresh
   intervals.
8. **Data Management**: clear **Recently Watched**, **Continue Watching** and **Watchlist**,
   **Clear Cache**, **Reset App**, and the app version.

### 7a. Parental controls (checklist row 23)

Parental controls lock live groups and channels, and movie and series categories and titles,
behind a four-digit PIN. The test content is not adult content; the locks work on any group.

1. **Settings › General › Parental controls**: select **Turn on**. Enter a PIN (for example
   `1234`) with the number keys, then enter it again to confirm. The parental controls manager
   opens.
2. Under **What to lock**, select **Group 2** and press **OK**: it shows **Locked**. Movie and
   series categories are listed and locked the same way.
3. Open **Options**: set **Ask for PIN again** to **Every time**. **Locked content in lists**
   offers **Show with a lock** (default) or **Hide**.
4. Press **Back** to Settings and **Back** again to Home, then open **Live**. **Group 2** and its
   channels show a lock. Press **OK** on one of its channels: "Enter PIN to open" appears and
   nothing plays.
5. Enter a wrong PIN: "Incorrect PIN. Try again." Repeated wrong PINs lock the prompt for a
   while. Enter `1234`: the channel plays.
6. With **Ask for PIN again** on a time limit, Home shows **Lock now** at the top while content
   is unlocked; selecting it locks everything again at once.
7. To turn parental controls off: **Settings › General › Parental controls › Manage**, enter the
   PIN, then on **Options** turn off **Use parental controls**. A forgotten PIN can only be
   cleared with **Reset App** (which also removes the sources).

## 8. Setup from a phone

This needs a phone or computer on the same network as the TV.

1. On the first-run Home screen, or in **Settings › General**, the TV shows a QR code, an address
   (for example `http://192.168.x.y:<port>`) and a four-digit pairing code.
2. Scan the QR code with the phone (it pairs at once), or open the address in a browser and enter
   the pairing code.
3. On the page, add the test account from section 0 (with another label) and submit. The TV
   shows the account under **Settings › Sources** within a few seconds. The same page can upload
   an `.m3u` file, which appears under **Uploaded Playlists**.

## 9. Back and leaving the app

- **Back** always goes up one level: from full-screen playback to the screen it was started
  from, from the Guide to the groups, from a detail page to its catalog, from search results to
  the search box, and from a section to Home.
- **Back on Home closes Pleione** in one press. The remote's **Home** key also leaves it.
- Relaunching keeps the account, favorites, reminders and playback progress.
- To return the app to its first-launch state: **Settings › Data Management › Reset App**, then
  confirm.

## 10. Resolution and network (Group HD)

**Group HD**, after **Group 8** in Live and after the last numbered group in Movies, checks playback at each resolution. Each
picture shows its resolution.

| Item | Where | Video |
|---|---|---|
| **HD 720p** | Live › Group HD | 1280 × 720 |
| **Full HD 1080p** | Live › Group HD | 1920 × 1080 |
| **Adaptive 360p-1080p** | Live › Group HD | HLS ladder: 360p, 720p, 1080p |
| **HD Movie 720p** | Movies › Group HD | 1280 × 720 |
| **Full HD Movie 1080p** | Movies › Group HD | 1920 × 1080 |
| **UHD Movie 2160p** | Movies › Group HD | 3840 × 2160 |

1. Play each item full screen. **Channel Info** in the live controls shows the resolution.
2. The adaptive channel steps between its variants with the network speed, and needs HLS: in
   **Settings › Sources**, set the test account's **Live stream format** to **HLS (m3u8)** or
   **Auto**, select **Save Changes**, and play **Adaptive 360p-1080p** again. On **TS
   (compatible)** it plays only the 360p variant.
3. Network loss: unplug the network while a channel plays. The player shows "Reconnecting…" and
   retries; when the network returns, playback resumes or the channel can be played again from
   Live. A movie or episode that stops does the same: "Reconnecting…" shows and it resumes where
   it stopped, or after three tries an error stays on screen until **Back**. A server that cannot be reached at launch shows "Can’t connect to Test" on Home with
   **Try again** and **Edit account**.
