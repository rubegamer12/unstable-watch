import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { config, creators } from './config.mjs';
import { Store } from './store.mjs';
import { PushService } from './push.mjs';
import { YouTubeService } from './youtube.mjs';
import { DiscordBot } from './discord-bot.mjs';

const creatorIds = new Set(creators.map(c => c.id));

function sanitizePushPrefs(input = {}) {
  return {
    uploads: input.uploads !== false,
    events: input.events !== false,
    creators: Array.isArray(input.creators)
      ? [...new Set(input.creators.filter(id => creatorIds.has(id)))]
      : creators.map(c => c.id)
  };
}

export async function startServer({
  port = config.port,
  host = process.env.HOST || '0.0.0.0',
  publicDir = path.resolve('public'),
  startServices = true
} = {}) {
  const app = express();
  const store = new Store();
  const push = new PushService(store);
  const sseClients = new Set();
  let closing = false;

  function broadcast(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      if (client.writableEnded || client.destroyed) continue;
      client.write(payload);
      client.flush?.();
    }
  }

  const discord = new DiscordBot(store, {
    onEvent: async event => {
      broadcast('event', event);
      await push.send({
        kind: 'event',
        title: '⚡ New Unstable event',
        body: event.content.slice(0, 180),
        url: '/#events',
        tag: `event-${event.id}`,
        image: event.image || undefined
      });
    }
  });

  const youtube = new YouTubeService(store, {
    onUpload: async video => {
      broadcast('upload', video);
      await Promise.allSettled([
        discord.announceUpload(video),
        push.send({
          kind: 'upload',
          creatorId: video.creatorId,
          title: `🔔 ${video.creator} uploaded`,
          body: video.title,
          url: `/?watch=${encodeURIComponent(video.id)}`,
          tag: `upload-${video.id}`,
          image: video.thumbnail
        })
      ]);
    }
  });

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(compression({
    filter: (req, res) => req.path === '/api/live' ? false : compression.filter(req, res)
  }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        frameSrc: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        connectSrc: ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
        workerSrc: ["'self'", 'blob:']
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));
  app.use(express.json({ limit: '200kb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      serverReady: !closing,
      uptime: Math.floor(process.uptime()),
      discordBotMode: config.discordBotMode,
      discordReady: discord.ready,
      discordConfigured: config.discordBotMode === 'local' && Boolean(config.discordToken),
      discordSourceReady: discord.sourceChannelReady,
      discordError: discord.lastError ? 'Discord needs attention; check configuration and permissions.' : null,
      youtubeReady: youtube.getFeed().some(creator => creator.videos.length),
      youtubeError: youtube.lastError ? 'One or more creator feeds could not refresh; cached videos remain available.' : null,
      youtubeLastSuccessAt: youtube.lastSuccessAt,
      youtubeMode: youtube.mode,
      creatorCount: creators.length,
      guildCount: Object.keys(store.state.guilds).length,
      pushSubscriberCount: store.state.pushSubscriptions.length
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      discordInvite: config.discordInvite,
      botInvite: discord.inviteUrl,
      vapidPublicKey: push.publicKey,
      pollIntervalMs: config.pollIntervalMs,
      youtubeMode: youtube.mode,
      creators: creators.map(({ id, name, accent }) => ({ id, name, accent }))
    });
  });

  app.get('/api/feed', (_req, res) => {
    res.json({
      creators: youtube.getFeed(),
      recentEvents: store.state.recentEvents,
      refreshedAt: new Date().toISOString()
    });
  });

  app.get('/api/events', (_req, res) => {
    res.json({ events: store.state.recentEvents });
  });

  app.get('/api/live', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'identity');
    res.flushHeaders?.();

    const write = chunk => {
      if (res.writableEnded || res.destroyed) return;
      res.write(chunk);
      res.flush?.();
    };

    write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
    sseClients.add(res);

    const heartbeat = setInterval(() => write(`: heartbeat ${Date.now()}\n\n`), 15_000);
    heartbeat.unref?.();
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  app.post('/api/push/subscribe', (req, res) => {
    const subscription = req.body?.subscription || req.body;
    if (!subscription?.endpoint || !subscription?.keys) return res.status(400).json({ error: 'Invalid push subscription' });
    const prefs = sanitizePushPrefs(req.body?.prefs || {});
    const entry = store.upsertPushSubscription(subscription, prefs);
    res.status(201).json({ ok: true, prefs: entry.prefs });
  });

  app.post('/api/push/preferences', (req, res) => {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
    const prefs = store.patchPushPreferences(endpoint, sanitizePushPrefs(req.body?.prefs || {}));
    if (!prefs) return res.status(404).json({ error: 'Subscription not found' });
    res.json({ ok: true, prefs });
  });

  app.post('/api/push/unsubscribe', (req, res) => {
    if (req.body?.endpoint) store.removePushSubscription(req.body.endpoint);
    res.json({ ok: true });
  });

  app.get('/sw.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'sw.js'));
  });
  app.use(express.static(publicDir, { extensions: ['html'], maxAge: '1h', setHeaders(res,file) {
    if (/\.(?:html|js|css)$/.test(file)) res.setHeader('Cache-Control','no-cache');
  } }));
  app.use((_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.once('error', reject);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const url = `http://${displayHost}:${actualPort}`;
  console.log(`[web] ${url}`);

  // Readiness/polling must not delay HTTP listening, desktop startup or signal handlers.
  const servicesStarted = startServices ? Promise.allSettled([discord.start(), youtube.start()]) : Promise.resolve();

  const close = async () => {
    if (closing) return;
    closing = true;
    await youtube.stop();
    await discord.stop();
    for (const client of sseClients) client.end();
    await servicesStarted;
    clearTimeout(store.saveTimer);
    store.save();
    server.closeIdleConnections?.();
    await new Promise(resolve => server.close(resolve));
  };

  return { app, server, store, push, discord, youtube, url, port: actualPort, close };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const runtime = await startServer();
  let stopping = false;
  const shutdown = async signal => {
    if (stopping) return;
    stopping = true;
    console.log(`[app] ${signal}; shutting down`);
    const hardExit = setTimeout(() => process.exit(1), 6_000);
    hardExit.unref?.();
    await runtime.close().catch(error => console.error('[app] shutdown:', error));
    clearTimeout(hardExit);
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}
