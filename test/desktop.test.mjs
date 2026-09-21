import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const main = fs.readFileSync('desktop/main.mjs', 'utf8');
const preload = fs.readFileSync('desktop/preload.cjs', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/app.js', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');
const server = fs.readFileSync('src/server.mjs', 'utf8');

 test('Windows desktop build uses Electron + NSIS x64 installer', () => {
  assert.equal(pkg.main, 'desktop/main.mjs');
  assert.equal(pkg.devDependencies.electron, '44.4.3');
  assert.equal(pkg.devDependencies['electron-builder'], '26.15.3');
  assert.equal(pkg.build.appId, 'com.unstable.watch');
  assert.equal(pkg.build.win.target[0].target, 'nsis');
  assert.deepEqual(pkg.build.win.target[0].arch, ['x64']);
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.ok(pkg.build.files.includes('!.env'));
 });

 test('desktop window is sandboxed and external links stay outside the app', () => {
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /shell\.openExternal/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('unstableDesktop'/);
 });

 test('desktop app keeps running in tray and supports launch at login', () => {
  assert.match(main, /new Tray/);
  assert.match(main, /Start with Windows/);
  assert.match(main, /setLoginItemSettings/);
  assert.match(main, /event\.preventDefault\(\);\s*mainWindow\.hide\(\)/s);
 });

 test('desktop config stores secrets outside the packaged app', () => {
  assert.match(main, /path\.join\(dataRoot\(\), '\.env'\)/);
  assert.match(main, /DISCORD_BOT_TOKEN/);
  assert.match(main, /YOUTUBE_API_KEY/);
  assert.match(html, /id="desktopSettingsOverlay"/);
  assert.match(app, /desktopBridge\.saveConfig/);
 });

 test('server can be embedded by Electron instead of always exiting the process', () => {
  assert.match(server, /export async function startServer/);
  assert.match(server, /return \{ app, server, store, push, discord, youtube, url, port: actualPort, close \}/);
 });

 test('v4 desktop UI has custom chrome and wide-screen layout rules', () => {
  assert.match(html, /id="desktopTitlebar"/);
  assert.match(html, /id="windowMinimize"/);
  assert.match(html, /id="windowMaximize"/);
  assert.match(html, /id="windowClose"/);
  assert.match(css, /V4 DESKTOP EXPERIENCE/);
  assert.match(css, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(app, /Ctrl|ctrlKey/);
 });

