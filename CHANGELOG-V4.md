# Unstable Watch v4 desktop rebuild

- Added Electron 44 desktop shell and NSIS installer configuration.
- Added custom frameless Windows title bar and window controls.
- Added system tray; closing the window keeps local services alive.
- Added optional Start with Windows behavior.
- Added desktop settings UI stored under Windows app data.
- Installer packaging excludes `.env` and local data.
- Refactored the Express/Discord/YouTube runtime so Electron can embed it cleanly.
- Added transient Discord initial-login retry with exponential backoff.
- Reworked desktop layout for wide PC monitors: cleaner hero, six-column library, five-column arc folders, sticky filters, compact rails.
- Added Ctrl+K search shortcut.
- Preserved the single custom video control surface, CC toggle, autoplay queue, progress, My List, and YouTube fallback.
- Bumped service-worker cache to v4.
- Added desktop security/installer/lifecycle regression tests.
- Current automated suite: 27 tests.

## v4.1.0

- Normal viewers no longer need to provide a YouTube Data API key just to populate the recent upload feed.
- Added a public YouTube Atom-feed fallback with handle-to-channel resolution when `YOUTUBE_API_KEY` is empty.
- YouTube API mode remains available as an optional enhanced mode for the larger archive, duration/embeddability metadata, and arc playlist discovery.
- Desktop setup no longer opens automatically just because Discord/YouTube secrets are missing.
- Added GitHub Actions verification and a Windows NSIS installer/release build on every push to `main`.
- Added tests for public-feed parsing and channel-ID extraction.
