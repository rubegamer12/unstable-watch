import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));

test('HTML has no duplicate ids', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('simple JS id selectors exist in the HTML', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const selectors = [...app.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map(match => match[1]);
  const missing = [...new Set(selectors.filter(id => !ids.has(id)))];
  assert.deepEqual(missing, []);
});

test('PWA manifest includes required basics', () => {
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});


test('player uses only the custom control surface', () => {
  assert.match(html, /id="ccBtn"/);
  assert.match(html, /id="mediaControls"/);
  assert.doesNotMatch(html, /id="playerQueue"/);
  assert.doesNotMatch(html, /id="queueToggle"/);
  assert.match(app, /controls:\s*0/);
  assert.match(app, /disablekb:\s*1/);
  assert.match(app, /host:\s*'https:\/\/www\.youtube-nocookie\.com'/);
  assert.match(app, /function toggleCaptions\(/);
});

test('Discord Message Content intent is opt-in', () => {
  const bot = fs.readFileSync('src/discord-bot.mjs', 'utf8');
  const config = fs.readFileSync('src/config.mjs', 'utf8');
  assert.match(config, /discordMessageContentIntent:/);
  assert.match(bot, /if \(config\.discordMessageContentIntent\) intents\.push\(GatewayIntentBits\.MessageContent\)/);
  assert.match(bot, /const intents = \[GatewayIntentBits\.Guilds, GatewayIntentBits\.GuildMessages\]/);
});


test('player CSS is valid text and blocks YouTube hover chrome', () => {
  const css = fs.readFileSync('public/styles.css', 'utf8');
  assert.doesNotMatch(css, /\\n\\n\/\* v3\.1 player/);
  assert.match(css, /#ytPlayer iframe\{pointer-events:none!important\}/);
  assert.match(css, /\.media-controls\{/);
});

test('test notification uses latest real upload/event data', () => {
  const bot = fs.readFileSync('src/discord-bot.mjs', 'utf8');
  assert.match(bot, /latestUploadFromStore/);
  assert.match(bot, /getLatestEventForTest/);
  assert.match(bot, /uploadEmbed\(latest, \{ test: true \}\)/);
  assert.match(bot, /eventEmbed\(latestEvent, \{ test: true \}\)/);
});

test('project includes always-on deployment configuration', () => {
  const render = fs.readFileSync('render.yaml', 'utf8');
  const store = fs.readFileSync('src/store.mjs', 'utf8');
  assert.match(render, /plan: 0\.5c-512mb/);
  assert.match(render, /healthCheckPath: \/api\/health/);
  assert.match(render, /mountPath: \/var\/data/);
  assert.match(store, /process\.env\.DATA_DIR/);
});


test('v3.3.1 UI removes the episode rail and keeps a fail-safe filtered feed', () => {
  const youtube = fs.readFileSync('src/youtube.mjs', 'utf8');
  const filter = fs.readFileSync('src/video-filter.mjs', 'utf8');
  assert.doesNotMatch(html, /class="player-queue"/);
  assert.match(youtube, /filterUnstableVideos/);
  assert.match(filter, /durationSeconds.*180/s);
  assert.match(app, /isUnstableLongform/);
  assert.match(filter, /fall back to the creator's long-form/);
});


test('live feed cannot block the library and SSE is proxy-safe', () => {
  const server = fs.readFileSync('src/server.mjs', 'utf8');
  assert.match(server, /req\.path === '\/api\/live' \? false : compression\.filter/);
  assert.match(server, /X-Accel-Buffering/);
  assert.match(server, /Content-Encoding', 'identity'/);
  assert.match(server, /res\.flush\?\.\(\)/);
  assert.match(app, /startFeedPollingFallback/);
  assert.match(app, /Library ready · background sync active/);
  assert.match(app, /setTimeout\(\(\) => \{[\s\S]*5_000\)/);
});
