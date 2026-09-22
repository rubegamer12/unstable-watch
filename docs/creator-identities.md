# Canonical YouTube identities

Verified 2026-09-22 by fetching each actual YouTube handle page: both
`channelMetadataRenderer.externalId` and `<link rel="canonical">` agreed.
The corresponding public Atom feeds returned HTTP 200 and the matching author.

| Creator channel | Canonical ID |
| --- | --- |
| https://www.youtube.com/@Spokeishere | UCk2uxbWi5py_iJXaEsh2YRA |
| https://www.youtube.com/@ParrotX2 | UCPLMPHT-d8GZOqL_AHJFdQQ |
| https://www.youtube.com/@wemmbumc | UCkzzNLnuM-VsATWC53ehwOQ |
| https://www.youtube.com/@FlameFragsMC | UCvYPobTo42NM36X7VC4dLhA |

Atom feed headers currently omit `UC` from `yt:channelId`; entry IDs and author
channel URLs include it. Normalize this format before comparing identities.
Names alone are never sufficient to accept a channel. Public feeds expose recent
uploads; accumulated verified cache is preserved across startup and refresh.
YouTube API mode remains available for the larger archive and playlist discovery.
