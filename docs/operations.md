# Desktop releases and hosted bot

## Independent cloud runtime

`npm ci --omit=dev` followed by `npm start` runs Express, the Discord bot,
YouTube polling, SSE and push notifications without installing Electron.
Use `render.yaml` with its paid always-on instance and persistent `/var/data`
disk. A free/sleeping instance cannot guarantee continuous notifications.
Run one instance against this disk; this JSON store is not a multi-writer database.

Set `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` as secret environment variables
in the host dashboard. The optional `YOUTUBE_API_KEY` enables a deeper archive;
ordinary watching and polling use verified public feeds without it. Set
`DISCORD_MESSAGE_CONTENT_INTENT=true` only after enabling the privileged intent
in the Discord Developer Portal. `DATA_DIR=/var/data` holds guild settings,
event sources, cached events/uploads, seen IDs, push subscriptions and VAPID keys.
Back up the disk before migrating hosts. Never put these files into Git.

The host runs with `DISCORD_BOT_MODE=local` (the bot runs in that server process).
Desktop Settings defaults to **Cloud / hosted bot**, which suppresses local bot
login even when an old token remains saved. This mode does not itself provision
a cloud service. Normal viewers need no Discord token, and desktop playback
continues using the desktop's independent local video feed.

The health endpoint reports safe readiness flags and uptime. HTTP starts before
external service initialization finishes. Discord reconnects with its SDK and
retries initial transient login failures. YouTube failures preserve verified
cache and retry at the next poll. Shutdown aborts YouTube requests, stops Discord,
closes SSE, and saves state. Configure restart/recovery on your host (Render
manages process recovery; for Docker use `--restart unless-stopped` and a persistent
volume mounted at `/var/data`, writable by container user `node`).

## Local event relay

Invite the bot into your own server. Run `/setup` for upload/event destinations,
then `/setsource channel:#unstable-event-feed`. Give it View Channel and Read
Message History on the source and Send Messages/Embed Links on destinations.
Manually forward legitimate public Unstable Events into this channel. Its posts
are made available in Unstable Watch. Do not select a private/personal channel.

Normal posts, webhooks, embeds, attachments and Discord forwarded snapshots
normalize into events. Explicit protagonist names/handles identify targets,
including multiple targets; otherwise the target is Unspecified. No Discord user
token, self-bot or inaccessible external server is used. Legacy global external
source settings are ignored. Source configuration and event cache are per guild.
`/testnotify events` selects a cached event from this guild's current source or
fetches the newest valid post from that source and caches it. `/status` reports
source readiness and last event time. Reposted bot notifications are ignored.

## Windows updates

The installed NSIS app uses `electron-updater` in the main process with the fixed
public GitHub provider `rubegamer12/unstable-watch`. No GitHub token is packaged.
Updates are disabled in development, unpacked builds and portable builds.
Checks run after 15 seconds and every six hours; manual checks are rate-limited
to one per minute. Only newer stable semver versions download. The app reports
progress and waits for **Restart & update**. Later leaves watching uninterrupted;
quitting alone does not install. Restart saves watch progress and runtime state.

The release build uploads its installer, `latest.yml`, and `.exe.blockmap` from
the same build. `scripts/verify-update-artifacts.mjs` checks version, filename,
file size and SHA-512 against the actual installer before publication. Feature
branches/PRs produce downloadable Actions artifacts; only main publishes releases.
New releases start as drafts until all files are uploaded. App data remains outside
the installation directory and NSIS is configured to preserve it.

Version 4.1.0 did not contain an updater. Users on that version must install the
first updater-enabled release manually once. Subsequent updates use this flow.
The project currently has no Windows code-signing certificate configured;
Windows may show publisher/reputation prompts. Configure signing in CI to provide
verified publisher identity; do not disable updater signature verification.

## Player boundary

Application controls live in cinematic bands outside the embedded viewport.
Paused chrome stays visible with title, creator, timeline and a Resume button;
playing chrome fades after inactivity. Stale callbacks from closed/replaced
players are ignored. YouTube's native pause content cannot be completely removed
with the supported IFrame API; branding and native content are not covered or
cropped. No video stream extraction or cross-origin iframe injection is used.

References: https://www.electron.build/docs/features/auto-update/ and
https://developers.google.com/youtube/iframe_api_reference .
