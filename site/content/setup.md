# Setup guide

Pleione runs on LG TVs with **webOS 4.0 (2018) or newer**. It ships no channels: you need a
playlist or an account from an IPTV provider of your own. On this page:

1. [Install Pleione](#install-pleione)
2. [Add an Xtream account](#add-an-xtream-account)
3. [Add an M3U playlist](#add-an-m3u-playlist)
4. [Set up from your phone](#set-up-from-your-phone)
5. [Find your way around](#find-your-way-around)

## Install Pleione

### LG Content Store

Coming soon. Once Pleione is listed, search for **Pleione** in the LG Content Store (Apps) on your
TV and install it like any other app.

### Developer Mode

Until then, you can sideload Pleione with LG's **Developer Mode** app. It takes a computer, a
free LG developer account, and some upkeep: a Developer Mode session lasts a limited time (the
Developer Mode app shows how long is left), you have to renew it from that app before it runs
out, and when a session expires the TV removes the apps installed this way.

1. On a computer, download the latest `.ipk` file from the
   [releases page](https://github.com/ahmedsaed/pleione-webos-iptv-player/releases/latest), and
   install the [webOS CLI tools](https://webostv.developer.lge.com/develop/tools/cli-installation)
   (`npm install -g @webos-tools/cli`).
2. Create a free account on the [LG webOS developer site](https://webostv.developer.lge.com/).
   On the TV, install **Developer Mode** from the LG Content Store, sign in, and switch
   **Dev Mode Status** on. The TV restarts; note the **IP address** and **passphrase** that
   Developer Mode shows.
3. Register the TV (use your TV's IP address), then fetch its key, entering the passphrase when
   asked:

   ```bash
   ares-setup-device --add tv -i "username=prisoner" -i "host=192.168.1.20" -i "port=9922"
   ares-novacom --device tv --getkey
   ```

4. Install Pleione:

   ```bash
   ares-install --device tv ./com.merope.pleione_<version>_all.ipk
   ```

To keep Pleione installed, open the Developer Mode app now and then and extend the session. To
update, download the new `.ipk` from the releases page and run `ares-install` again.

## Add an Xtream account

An Xtream account gives you **Live**, **Movies** and **Series**, with the program guide.

1. Open Pleione. On first launch, Home shows **Welcome to Pleione** with two cards, **Add Xtream
   account** (selected) and **Add M3U playlist**; press **OK** on **Add Xtream account**.
   Settings opens on **Sources** with a new account ready to fill in. (Later, add more accounts
   with **+ Add Xtream Account** in **Settings › Sources**.)
2. Fill in **Label** (any name), **Server URL**, **Username** and **Password** from your
   provider. Leave **Live stream format** on **TS (compatible)** unless your provider supports
   HLS, which allows pausing and rewinding live TV.
3. Select **Check** to test the account, then **Save Changes**.

Home then shows **Live**, **Movies**, **Series**, **Search** and **Settings**.

## Add an M3U playlist

1. On first launch, press **OK** on **Add M3U playlist** on Home; later, select **+ Add
   Playlist** in **Settings › Sources**.
2. Enter a **Playlist name** and the **Playlist URL** from your provider, then **Save Changes**.

If the playlist names a program guide (XMLTV), Pleione finds it automatically. Otherwise, add
the guide's address in **Settings › Program Guide › Add EPG source**. M3U playlists give you
**Live** and **Search**; Movies and Series need an Xtream account.

## Set up from your phone

Typing a long address with a remote is slow, so Pleione can take it from a phone or computer on
the same home network:

1. On first launch, Home shows **Set up with your phone or computer** beside the Add cards; later,
   it is in **Settings › General**. The TV shows a QR code, an address and a four-digit pairing
   code.
2. Scan the QR code with your phone, or open the address in a browser and enter the pairing code.
3. Add your Xtream account or playlist on the page, or upload an `.m3u` file. The TV applies it
   right away.

The setup page works only while Pleione is open on the TV, and only on your home network. The
[privacy policy](/privacy/) has the details.

## Find your way around

Pleione opens on **Home**, with cards for **Live**, **Movies**, **Series**, **Search** and
**Settings**. It does not start playing on its own: pick a section, or type a channel number.

- **Live** shows the groups, the channel list, and a preview that starts playing when you rest
  on a channel. **OK** watches it full screen. **Red** switches Live to the **Guide**, a
  timeline of every channel: **OK** on a program on air watches it, on a later one sets a
  reminder, and on an earlier one plays it from the start where your provider offers catch-up.
- **Movies** and **Series** open a detail page with **Play**, **Resume** where you stopped,
  **Play from start**, the episodes, the cast, and more like this.
- **Back** goes back one step, and from Home it closes Pleione.

| Remote key | What it does |
|---|---|
| Arrows and **OK** | Move and select, everywhere |
| **Back** | Go back one step; on Home, close Pleione |
| **Red** | Open the Guide; in the Guide, back to the channel list |
| **Green** | Add or remove the selected channel from Favorites, in Live |
| **Yellow** | Edit the channel list in Live; show the player controls while watching |
| **Blue** | Open Settings |
| **Up** / **Down**, **CH +/−** | Change channel while watching live TV |
| **Left** / **Right** | Skip back or forward in movies and episodes |
| Number keys | Tune a channel by its number |

The Magic Remote's pointer works everywhere too: point and click, and use the Home button at the
top left of each section to return to Home.

Something not working? See [Support](/support/).
