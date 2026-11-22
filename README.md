# GLOT

An Apple TV–style home screen for Samsung Tizen TVs, set up from your phone.

GLOT replaces the home screen you see when you press Home: a Top Shelf that previews the focused app or HDMI input, wide tiles that lift and tilt as you move, Apple's aerial videos as the screensaver, and a website on your home network where you design the screen from your phone like an iPhone Lock Screen.

It's built on [Glass Home](https://github.com/victaphu/glass-home-samsung-tv) and is MIT-licensed.

> Tested on one TV: a 2023 Samsung S95C (QA77S95CAUXZN) on Tizen 9.0. Other Tizen TVs may work, but expect rough edges. Not affiliated with Samsung, Apple or any app shown.

## What it does

**On the TV**
- **Four faces:** Apple TV (Top Shelf and wide tiles, the default), Glass, Minimal, and Big Clock (like the iPhone Lock Screen). Each keeps its own clock font, weight, colour and widgets.
- **Top Shelf:** the focused tile shown large. Rest on an HDMI tile and that input plays live in the shelf. Previewing switches the TV to that input in the background, so its sound may play and HDMI devices may wake, and it can be turned off.
- **Aerial screensaver:** Apple's aerial videos with crossfades between scenes and Apple's own captions in English or Arabic. Left and Right change the scene; any other button returns Home. Back on Home opens it straight away.
- **All apps:** press Down from the tile row. Hold OK on a tile to move it, or add it to or remove it from the row.
- **HDMI inputs as tiles**, with logos for common devices.
- **Widgets:** date, weather (Open-Meteo, no key), a countdown and a greeting.
- **Hidden menu:** press Up three times quickly on the tile row for Samsung Home, Clean RAM (closes apps left running in the background), restart options and startup timings.
- **Lighter when the TV struggles:** blur and photo drift switch off automatically and come back when the TV recovers.

**On your phone** (the TV serves a website on your home network)
- **Design:** a live preview of the TV screen; tap the clock, background or tiles to edit them. Choose a face, clock font, weight and colour (including colours from today's photo), widgets, a gradient background and the accent colour.
- **Photos:** upload your own; choose which of the 12 bundled photos show and how long each stays.
- **Home:** which apps are on the row and in what order, HDMI names and logos, and the All apps order.
- **Shortcuts:** websites and YouTube videos as tiles.
- **Videos:** your own screensaver video links, and screensaver quality (1080p or 4K).
- **Settings:** name, clock, weather city, screensaver timing, evening dimming, password, and Advanced settings (sizes, behaviour, custom CSS, backup and restore).
- **Sign in by QR code:** open the **+** tile (or the hidden menu) and scan the code. It holds a single-use code that expires after 10 minutes and is withdrawn when the panel closes; it never contains the password.

## Install

You need a Samsung TV in **Developer Mode** with this computer's IP address as its Host PC IP, and a way to sign and install `.wgt` packages. These steps use the free [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) CLI on Windows.

1. Turn on Developer Mode: on the TV open **Apps**, type `12345`, switch Developer Mode on, enter this computer's IP address and restart the TV.
2. Fetch Apple's aerial list. It's made on your computer and isn't part of this repository:
   ```powershell
   powershell -File scripts/fetch-aerials.ps1
   ```
   Without it, GLOT still works and the screensaver shows photos.
3. Package the app:
   ```powershell
   powershell -File scripts/package.ps1 -Repo .
   ```
4. Install it (Apps2Samsung signs it with its free public certificate):
   ```powershell
   apps2samsung-cli install dist/GlassHome.wgt --tv <TV IP> --launch
   ```
5. On the TV, open **+** at the end of the tile row and scan the QR code with your phone, or open the address it shows and sign in with the password.

The starting apps and HDMI inputs are in `app/js/config.js`; edit them before packaging, or change them on the website later.

## Making the Home button open GLOT (experimental)

Samsung doesn't offer a setting for this. GLOT can use [AeroTizen](https://github.com/helalaou/AeroTizen)'s guarded Home tool, which changes the Home target without root and keeps a backup for restoring:

- GLOT installs under the app ID `DclHome001.Home`, the ID that tool targets, and answers its handoff protocol (`app/service/home-control.js`, adapted from AeroTizen under MIT). This means GLOT can't be installed alongside AeroTizen's own launcher.
- With GLOT open on the TV, run AeroTizen's `home status`, then `home backup`, then `home apply --yes`. Unplug the TV for 60 seconds afterwards.
- To undo, open GLOT and run `home restore --yes`, then unplug for 60 seconds.

This rewrites undocumented TV settings. It worked on the S95C above, but read AeroTizen's documentation and keep its backup before trying it on another TV.

## Develop

Preview the TV screen and the phone website on a computer, with sample apps:

```bash
node dev/run.js --no-fetch
```

Then open `http://127.0.0.1:18091/index.html?preview=1` for the TV screen and `http://127.0.0.1:18091/dev/login?to=/` for the website. Useful URL options: `still=1` (no motion), `wx=mock` (sample weather), `idle=2000` (screensaver after 2 s), `decoders=1` (act as a TV with one video decoder), `lite=1`.

Tests (Node.js):

```bash
node dev/test-settings.js
node dev/test-home-control.js
node dev/test-data.js
```

The rest are in `dev/test-*.js`. The TV runs Node 12 for the service and an older Chromium for the app, so the code avoids newer syntax.

## Privacy and security

- The website only answers on your home network, behind a password or the single-use QR sign-in. The TV app talks to its service with a per-install local key that never leaves the TV.
- Nothing is sent anywhere except weather (Open-Meteo), place search (Open-Meteo geocoding), YouTube thumbnails, Apple's aerial videos, and the icons of websites you add as shortcuts.
- `app/js/local-key.js` is generated per install and is not in this repository.

## Credits

Built on [Glass Home](https://github.com/victaphu/glass-home-samsung-tv) (MIT). Home handoff adapted from [AeroTizen](https://github.com/helalaou/AeroTizen) (MIT). App filter and input code adapted from [Arn0 Launcher](https://github.com/NelsonEU/arn0-tv) (MIT). QR codes by qrcode-generator (MIT). Fonts, photos, icons and data sources are listed in [CREDITS.md](CREDITS.md).

Apple's aerial videos and captions belong to Apple and are streamed from Apple's servers for personal use; they are not included here. Samsung, Tizen, Apple, Apple TV and other names are trademarks of their owners.

## Licence

MIT. See [LICENSE](LICENSE).
