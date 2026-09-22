import 'dotenv/config';

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int(process.env.PORT, 3000),
  baseUrl: process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000',
  pollIntervalMs: Math.max(int(process.env.POLL_INTERVAL_MS, 120_000), 60_000),
  discordInvite: process.env.DISCORD_INVITE || 'https://discord.gg/unstableevents',
  discordToken: process.env.DISCORD_BOT_TOKEN || '',
  discordBotMode: ['cloud', 'local', 'disabled'].includes(process.env.DISCORD_BOT_MODE) ? process.env.DISCORD_BOT_MODE : 'local',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordMessageContentIntent: /^true$/i.test(process.env.DISCORD_MESSAGE_CONTENT_INTENT || ''),
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || ''
};

export const creators = [
  {
    id: 'spoke',
    name: 'Spoke',
    handle: 'Spokeishere',
    channelId: 'UCk2uxbWi5py_iJXaEsh2YRA',
    tagline: 'Schemes, heists and empire politics.',
    accent: '#ff345f'
  },
  {
    id: 'parrot',
    name: 'Parrot',
    handle: 'ParrotX2',
    channelId: 'UCPLMPHT-d8GZOqL_AHJFdQQ',
    tagline: 'Kingdoms, strategy and impossible plans.',
    accent: '#ffb52f'
  },
  {
    id: 'wemmbu',
    name: 'Wemmbu',
    handle: 'wemmbumc',
    channelId: 'UCkzzNLnuM-VsATWC53ehwOQ',
    tagline: 'One-player wars and chaotic comebacks.',
    accent: '#39d98a'
  },
  {
    id: 'flame',
    name: 'FlameFrags',
    handle: 'FlameFragsMC',
    channelId: 'UCvYPobTo42NM36X7VC4dLhA',
    tagline: 'High-pressure PvP and survival.',
    accent: '#8b5cff'
  }
];
