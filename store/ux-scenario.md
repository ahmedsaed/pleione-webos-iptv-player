# Pleione — UX scenario for LG app review

Pleione is an IPTV **player**: it ships with no channels or content. To test it, the reviewer adds
the test account below, which serves synthetic test media made for this review (color bars, test
tones, and titles such as "Alpha", "Movie A" and "Series A"). Every step below uses that account.

All steps work with the standard remote (arrows, **OK**, **Back**, color keys, number keys) and
with the Magic Remote pointer. Button and screen names are written as they appear in the app in
English.

## 0. Test account

| Field | Value |
|---|---|
| Account type | Xtream account |
| Server URL | `[DEMO XTREAM URL]` |
| Username | `[DEMO USERNAME]` |
| Password | `[DEMO PASSWORD]` |

The server runs for the whole review period. It offers about 150 live channels in eight groups
(Group 1 to Group 8) with a seven-day program guide, a movie catalog, and a series catalog.
Channel **Alpha** (number 1) has catch-up, and **Movie A** has two audio tracks and several
subtitle tracks.

## 1. First launch and adding the account

1. Launch **Pleione**. Home opens with two tiles, **Live** and **Search**, and the **Settings**
   tile selected. A message reads "Welcome! Add a playlist URL to get started."
2. Press **OK** on **Settings**. Settings opens on **General**.
3. Press **Down** to **Sources**, then **Right** into the page.
4. Select **+ Add Xtream Account**. A new account row appears with the fields **Label**,
   **Server URL**, **Username**, **Password** and **Live stream format**.
5. Select each field with **OK** and type with the on-screen keyboard:
   - **Label**: `Test`
   - **Server URL**, **Username**, **Password**: the values in section 0.
   Leave **Live stream format** on **TS (compatible)**.
6. Select **Check**. The row shows the account as **Active**.
7. Select **Save Changes** (bottom right). The app loads the channels and returns to Home, which
   now has five tiles: **Live**, **Movies**, **Series**, **Search** and **Settings**, and the
   account's initial in a circle at the top right.

Expected: no error; a message reports the number of channels loaded.

## 2. Live TV

1. On Home, select **Live**. The channel list opens: groups on the left (**All**,
   **Favorites**, **Recently Watched**, **Group 1** …), channels on the right with the program
   now on air.
2. Press **Left** to the groups, **Down** to **Group 2**, then **OK**. The list shows that
   group's channels.
3. Press **Right**, move to a channel, and press **Green**: the channel is added to
   **Favorites** (a message confirms). Press **Green** again to remove it.
4. Press **OK** on a channel. It plays full screen, and the channel's information appears at the
   bottom.
5. While watching, press **Up** / **Down** (or **CH +/−**) to change channel, and press a number
   key (for example **3**) to tune that channel number.
6. Press **Back** to return to the channel list.

## 3. Player controls (live)

1. Play channel **Alpha** (number 1).
2. Press **OK** (or **Yellow**). The controls appear: channel name and number, **NOW** and
   **NEXT** programs, a progress bar, and buttons for **Play/Pause**, **Toggle Favorite** and
   **Channel Info**.
3. Use **Left** / **Right** to move between the buttons and **OK** to press one. **Channel Info**
   shows details about the stream.
4. Press **Back** to hide the controls; press **Back** again to stop and return to the list.

## 4. Program guide

1. From the channel list, press **Red**. The **Program Guide** opens: channels on the left, the
   selected channel's programs for the day on the right, and a strip of days at the top. The
   program on air is marked **LIVE**.
2. Press **Right** to the programs and **Up** / **Down** to move through them.
3. On a program that already aired on **Alpha**, press **OK**: it plays from its start
   (catch-up). Press **Back** to return to the guide.
4. On an upcoming program, press **OK**: "Reminder set" appears and a bell marks the program.
   Press **OK** again to remove it ("Reminder removed").
5. Press **Green** to return to today. Press **Back** to leave the guide.

## 5. Movies and Series

1. Press **Back** until Home shows, then select **Movies**. A large preview of the focused title
   sits above rows of posters grouped by category.
2. Move with the arrows; the preview follows the focus. Press **OK** on **Movie A**.
3. The detail page shows the title, year, length, genre, rating, plot, **Cast** and **More like
   this**, with the buttons **Play** and **Watchlist**.
4. Select **Watchlist**: "Added to Watchlist" appears. Select it again to remove the title.
5. Select **Play**. The movie plays.
6. While it plays: **Left** / **Right** skip 10 seconds; **OK** pauses and resumes; **Up** or
   **Down** shows the controls, which include **Audio Track** and **Subtitles**. Open
   **Audio Track** and pick the other track; open **Subtitles** and pick a subtitle, then
   **Off**.
7. Press **Back** (the first press hides the controls if they are showing). Playback stops and
   the detail page shows **Resume** with the position, and
   Movies shows the title in **Continue Watching**.
8. Return to Home and select **Series**. Press **OK** on **Series A**: the detail page lists
   **Episodes** under a **Season** picker. Select an episode to play it; press **Back** to stop.

## 6. Search

1. From Home, select **Search**. A search box opens at the top.
2. Press **OK** on the box and type `Bravo` with the on-screen keyboard, then confirm.
3. Results appear by type: **Channels** (channel Bravo) and **Programs** on that channel. Type
   `Movie` instead to see movies and series results.
4. Press **OK** on a channel result to play it, or on a program result's **Open channel**.
5. Open Search again: the box offers **Recent searches**.

## 7. Settings

1. Press **Blue** from anywhere (or select **Settings** on Home).
2. **General**: **Language** (System or one of 12 languages), and **Parental controls** with
   **Turn on**, which asks for a four-digit PIN.
3. **Appearance**: pick a **Theme** (the app recolors at once), **Player overlay style**,
   **Interface size** and **Text size**.
4. **Program Guide**: guide sources, time zone and **EPG time correction**, and **Manage
   Reminders** with the reminder set in step 4.
5. **Data Management**: **Clear Cache**, **Reset App**, and at the bottom the app version and
   the TMDB notice.
6. Changes apply after **Save Changes**; **Cancel** discards them.

## 8. Setup from a phone (optional)

This needs a phone or computer on the same network as the TV.

1. Open **Settings › General**. Under **Set up with your phone or computer**, the TV shows a QR
   code, an address (for example `http://192.168.x.y:<port>`) and a four-digit pairing code.
2. Scan the QR code with a phone, or open the address in a browser and enter the pairing code.
3. On the page, add a source (for example the test account in section 0, with another label)
   and submit. The TV shows the new account in **Settings › Sources** within a few seconds.

## 9. Leaving the app

Press the remote's **Home** key to leave Pleione. Relaunching it keeps the account, favorites and
progress.

To return the app to its first-launch state: **Settings › Data Management › Reset App**, then
confirm.
