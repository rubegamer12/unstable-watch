# Unstable Watch v4.1

A desktop-first Unstable SMP watch hub with a custom YouTube player, story arcs, chronological watch order, upload/event alerts, and an optional Discord notification bot. Normal viewers can load recent creator uploads without configuring their own YouTube API key.

v4 is designed primarily for Windows PCs and wide monitors. The web server still works in a normal browser, but the main experience is now an Electron desktop app.

## v4.1 highlights

### Desktop app

- Frameless Windows app with custom title bar and window controls.
- Installs through an NSIS `.exe` when built on Windows.
- Desktop and Start Menu shortcuts.
- System tray support.
- Closing the main window hides it to the tray instead of stopping the bot.
- Optional **Start with Windows** toggle.
- Local app-data storage for bot settings, cached library data, Discord server settings, push state, and VAPID keys.
- Desktop settings panel for optional Discord bot settings and an optional YouTube API key. The viewer works without either secret.
- Secret values are not bundled into the installer and are not shown back after saving.
- Installed app runs the Express server, YouTube sync, optional Discord bot, and UI inside one desktop application.

### PC-focused UI

- Wide cinematic hero sized for 1080p/1440p-class displays.
- Cleaner Netflix-inspired rails and hover states.
- Six-column desktop library on large monitors.
- Five-column arc folders.
- Sticky creator filters.
- Reduced visual clutter: stats/creator-card noise is removed from the main flow.
- `Ctrl+K` or `/` opens search.
- Full-screen custom player with auto-hiding chrome.
- No right-side episode drawer.
- CC, playback speed, volume, timeline, ±10 seconds, previous/next, fullscreen, My List, and Continue Watching.

### Library behavior

- Four configured protagonist feeds: Spoke, Parrot, Wemmbu, and FlameFrags.
- Shorts are filtered out.
- Normal long-form protagonist uploads remain as a fail-safe if YouTube metadata is incomplete.
- Arc playlists are discovered and merged across POVs.
- Full chronological upload-order queue.
- Search, My List, Continue Watching, creator filtering, and arc folders.

### Discord bot

- `/setup`
- `/setchannel`
- `/notifications`
- `/creator`
- `/mention`
- `/status`
- `/testnotify`
- `/reset`
- `/help`
- `/ping`

`/testnotify uploads` sends the latest real cached upload. `/testnotify events` sends the newest real event available to the bot.

The bot requests only `Guilds` and `GuildMessages` by default. Message Content Intent is opt-in. Initial transient login failures retry with backoff; Discord.js handles normal gateway reconnects after login.

## Run the Windows desktop app from source

Requires Node.js 24.17+ for the pinned Discord.js version.

```bat
START-DESKTOP.bat
```

or:

```bash
npm install
npm run verify
npm run desktop
```

The viewer works immediately after installation. Open the gear icon only if you want to run your own Discord bot or add an optional YouTube Data API key for the deeper archive/arc discovery. When running this source tree directly, a project `.env` is also supported.

## Build the Windows installer

On Windows, double-click:

```text
BUILD-WINDOWS-INSTALLER.bat
```

It runs verification first, installs dependencies if needed, then creates the installer under:

```text
dist\Unstable-Watch-Setup-4.1.0.exe
```

Manual command:

```bash
npm install
npm run verify
npm run desktop:dist
```

A portable executable target is also configured:

```bash
npm run desktop:portable
```

The Electron build intentionally excludes `.env`, `data/`, tests, and build output from the packaged app.


## Automatic Windows installer builds

Every push to `main` runs verification on GitHub and builds the Windows NSIS installer on a Windows runner. The resulting `.exe` is uploaded both as a workflow artifact and to the matching GitHub Release (`v4.1.0`, etc.). This keeps large generated Electron binaries out of Git history while still giving normal users a direct installer download.

The repository also runs scheduled health verification so broken dependency/source changes are caught even between manual releases.

## Normal browser/server mode

```bash
npm install
npm run verify
npm start
```

Then open:

```text
http://localhost:3000
```

## 24/7 bot uptime

There are two different modes:

1. **Desktop mode** — closing the window keeps the app and bot running in the Windows system tray. Enabling **Start with Windows** starts it again when you sign in. This only works while the computer is powered on and connected.
2. **True 24/7 mode** — deploy the included `render.yaml`/`Dockerfile` to an always-on host. The included Render Blueprint uses a persistent disk and health check. Add the secret environment variables in the host dashboard rather than committing them.

Required hosted secrets only if you want the Discord bot:

```text
DISCORD_CLIENT_ID
DISCORD_BOT_TOKEN
```

`YOUTUBE_API_KEY` is optional. Without it, recent uploads are read from YouTube public channel feeds. With it, the server can fetch the deeper archive, durations/embeddability metadata, and creator arc playlists.

For full event-message text/image relaying, enable Message Content Intent in the Discord Developer Portal and then set:

```env
DISCORD_MESSAGE_CONTENT_INTENT=true
```

Otherwise leave it off.

## Project environment variables

```env
PORT=3000
BASE_URL=http://localhost:3000
DATA_DIR=./data
POLL_INTERVAL_MS=120000
EVENT_SOURCE_CHANNEL_ID=1382502803058196612
DISCORD_INVITE=https://discord.gg/unstableevents
DISCORD_CLIENT_ID=your_application_id
DISCORD_BOT_TOKEN=your_bot_token
# optional: recent uploads work without this
YOUTUBE_API_KEY=
DISCORD_MESSAGE_CONTENT_INTENT=false
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
```

Desktop-installed settings are stored in the Windows app-data directory instead of inside the installed program files.

## Validation

```bash
npm run verify
```

The v4.1 suite validates syntax plus desktop installer configuration, Electron sandboxing, tray/startup behavior, app-data secret storage, embedded-server lifecycle, player structure, live-feed fallback, Discord intent behavior, latest-real-data test notifications, library filtering, Shorts filtering, upload ordering, arc normalization, and persistence.

## Player implementation note

Playback uses YouTube's official IFrame Player API rather than temporary media-file URLs. YouTube native controls are disabled and the iframe does not receive pointer input; the custom player is the interactive control surface. Videos that reject embedding still have a direct YouTube fallback.
