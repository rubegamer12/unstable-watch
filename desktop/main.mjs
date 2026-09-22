import fs from 'node:fs';
import path from 'node:path';
import { createUpdater, canUpdate } from './updater.mjs';
import { app, BrowserWindow, Menu, Tray, ipcMain, shell, nativeImage, Notification, session } from 'electron';

const APP_ID = 'com.unstable.watch';
const APP_NAME = 'Unstable Watch';
const DESKTOP_PORTS = [39177, 39178, 39179, 39180, 39181];

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

let mainWindow = null;
let tray = null;
let runtime = null;
let quitting = false;
let healthTimer = null;
let activeUrl = null;
let updates = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function dataRoot() {
  return app.getPath('userData');
}

function envPath() {
  return path.join(dataRoot(), '.env');
}

function readEnvFile() {
  const result = {};
  const candidates = [envPath()];
  if (!app.isPackaged) candidates.push(path.join(app.getAppPath(), '.env'));
  candidates.push(path.join(path.dirname(process.execPath), '.env'));

  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) return result;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function writeEnvFile(patch) {
  const current = readEnvFile();
  const next = { ...current };
  const allowed = [
    'DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'YOUTUBE_API_KEY', 'EVENT_SOURCE_CHANNEL_ID',
    'DISCORD_INVITE', 'DISCORD_MESSAGE_CONTENT_INTENT', 'POLL_INTERVAL_MS', 'DISCORD_BOT_MODE'
  ];
  for (const key of allowed) {
    if (!Object.hasOwn(patch, key)) continue;
    const value = String(patch[key] ?? '').trim();
    if (value) next[key] = value;
    else if (key === 'DISCORD_MESSAGE_CONTENT_INTENT') next[key] = 'false';
  }
  fs.mkdirSync(dataRoot(), { recursive: true });
  const lines = [
    '# Unstable Watch desktop configuration',
    '# Stored locally in your Windows app-data folder.',
    ...Object.entries(next).map(([key, value]) => `${key}=${String(value).replace(/[\r\n]/g, '')}`),
    ''
  ];
  fs.writeFileSync(envPath(), lines.join('\n'), { mode: 0o600 });
}

function desktopState() {
  const env = readEnvFile();
  const login = app.getLoginItemSettings();
  return {
    desktop: true,
    version: app.getVersion(),
    platform: process.platform,
    launchAtLogin: login.openAtLogin,
    dataPath: dataRoot(),
    serverUrl: activeUrl,
    configured: {
      discordToken: Boolean(env.DISCORD_BOT_TOKEN),
      discordClientId: Boolean(env.DISCORD_CLIENT_ID),
      youtubeApiKey: Boolean(env.YOUTUBE_API_KEY),
      messageContentIntent: /^true$/i.test(env.DISCORD_MESSAGE_CONTENT_INTENT || '')
    },
    values: {
      botMode: ['cloud','local','disabled'].includes(env.DISCORD_BOT_MODE) ? env.DISCORD_BOT_MODE : 'cloud',
      discordInvite: env.DISCORD_INVITE || 'https://discord.gg/unstableevents',
      pollIntervalMs: Number.parseInt(env.POLL_INTERVAL_MS || '120000', 10) || 120000
    }
  };
}

async function startLocalRuntime() {
  process.env.DATA_DIR = path.join(dataRoot(), 'data');
  process.env.DOTENV_CONFIG_PATH = fs.existsSync(envPath())
    ? envPath()
    : (!app.isPackaged && fs.existsSync(path.join(app.getAppPath(), '.env')) ? path.join(app.getAppPath(), '.env') : envPath());

  const env = readEnvFile();
  process.env.DISCORD_BOT_MODE = ['cloud','local','disabled'].includes(env.DISCORD_BOT_MODE) ? env.DISCORD_BOT_MODE : 'cloud';
  const { startServer } = await import('../src/server.mjs');
  const publicDir = path.join(app.getAppPath(), 'public');
  let lastError = null;
  for (const port of DESKTOP_PORTS) {
    try {
      runtime = await startServer({ port, host: '127.0.0.1', publicDir, startServices: true });
      activeUrl = runtime.url;
      return runtime;
    } catch (error) {
      lastError = error;
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw lastError || new Error('No desktop port was available.');
}

function iconPath() {
  return path.join(app.getAppPath(), 'build', 'icon.png');
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(iconPath()).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip(`${APP_NAME} · starting`);
  const rebuild = () => {
    const launchAtLogin = app.getLoginItemSettings().openAtLogin;
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Unstable Watch', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: 'Open in browser', click: () => activeUrl && shell.openExternal(activeUrl) },
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: launchAtLogin,
        click: item => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: item.checked ? ['--background'] : [] });
          rebuild();
        }
      },
      { label: 'Check for updates', click: () => { void updates?.check(); mainWindow?.show(); } },
      { label: 'Open app-data folder', click: () => shell.openPath(dataRoot()) },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } }
    ]));
  };
  rebuild();
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    frame: false,
    backgroundColor: '#07070b',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (activeUrl && new URL(url).origin === new URL(activeUrl).origin) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  mainWindow.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!app.getLoginItemSettings().wasOpenedAtLogin && Notification.isSupported()) {
      new Notification({ title: 'Unstable Watch is still running', body: 'The bot and notifications stay active in the system tray while your PC is on.' }).show();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!process.argv.includes('--background')) mainWindow.show();
  });

  mainWindow.loadURL(activeUrl);
}

function wireIpc() {
  const trusted = handler => (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== new URL(activeUrl).origin) throw new Error('Untrusted desktop request');
    return handler(event, ...args);
  };
  const handle = (channel, handler) => ipcMain.handle(channel, trusted(handler));
  handle('desktop:get-state', () => desktopState());
  handle('desktop:window', (_event, action) => {
    if (!mainWindow) return false;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
    return true;
  });
  handle('desktop:set-login', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), args: enabled ? ['--background'] : [] });
    return app.getLoginItemSettings().openAtLogin;
  });
  handle('desktop:save-config', (_event, input = {}) => {
    const patch = {
      DISCORD_BOT_TOKEN: input.discordToken,
      DISCORD_CLIENT_ID: input.discordClientId,
      YOUTUBE_API_KEY: input.youtubeApiKey,
      DISCORD_BOT_MODE: ['cloud','local','disabled'].includes(input.botMode) ? input.botMode : 'cloud',
      DISCORD_INVITE: input.discordInvite,
      DISCORD_MESSAGE_CONTENT_INTENT: input.messageContentIntent ? 'true' : 'false',
      POLL_INTERVAL_MS: input.pollIntervalMs
    };
    writeEnvFile(patch);
    return { ok: true, configured: desktopState().configured };
  });
  handle('desktop:open-data', () => shell.openPath(dataRoot()));
  handle('desktop:relaunch', () => {
    quitting = true;
    app.relaunch();
    app.quit();
    return true;
  });
  handle('desktop:update-state', () => updates?.getState());
  handle('desktop:update-check', () => updates?.check());
  handle('desktop:update-restart', () => updates?.restart());
  handle('desktop:quit', () => {
    quitting = true;
    app.quit();
    return true;
  });
}

async function updateTrayHealth() {
  if (!tray || !activeUrl) return;
  try {
    const response = await fetch(`${activeUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
    const health = await response.json();
    const bot = health.discordReady ? 'bot online' : 'bot offline';
    const feed = health.youtubeReady ? 'feed ready' : 'feed syncing';
    tray.setToolTip(`${APP_NAME} · ${bot} · ${feed}`);
  } catch {
    tray.setToolTip(`${APP_NAME} · reconnecting`);
  }
}

app.whenReady().then(async () => {
  wireIpc();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'notifications');
  });
  createTray();
  await startLocalRuntime();
  const enabled = canUpdate({isPackaged:app.isPackaged, platform:process.platform, portable:Boolean(process.env.PORTABLE_EXECUTABLE_DIR), installed:fs.existsSync(path.join(path.dirname(process.execPath),'Uninstall Unstable Watch.exe'))});
  try {
  const updater = enabled ? (await import('electron-updater')).default.autoUpdater : null;
  updates = createUpdater({updater,enabled,version:app.getVersion(),
    publish: state => { if(state.status==='error') quitting=false; if(mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:update-state',state); },
    beforeInstall:async()=> { runtime?.store.save(); quitting=true; }
  });
  } catch {
    console.warn('[desktop] Updates are unavailable; the application can still be used.');
    updates = createUpdater({enabled:false, version:app.getVersion()});
  }
  createWindow();
  updates.start();
  await updateTrayHealth();
  healthTimer = setInterval(updateTrayHealth, 30_000);
  healthTimer.unref?.();
}).catch(error => {
  console.error('[desktop] Startup failed; check app-data configuration and local port availability.');
  if (Notification.isSupported()) new Notification({ title: 'Unstable Watch could not start', body: 'Check the app-data configuration and try restarting.' }).show();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});

app.on('before-quit', () => { quitting = true; updates?.stop(); });
app.on('will-quit', async event => {
  if (!runtime) return;
  event.preventDefault();
  const current = runtime;
  runtime = null;
  clearInterval(healthTimer);
  await current.close().catch(error => console.error('[desktop] shutdown:', error));
  app.exit(0);
});

