import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { config } from '../src/config.mjs';
import { DiscordBot } from '../src/discord-bot.mjs';
import { YouTubeService } from '../src/youtube.mjs';
import { safeError } from '../src/safe-error.mjs';

test('cloud and disabled desktop modes cannot create a local Discord connection',async()=>{
  const previous=config.discordBotMode;
  try {for(const mode of ['cloud','disabled']) {config.discordBotMode=mode;const bot=new DiscordBot({state:{guilds:{}}});await bot.start();assert.equal(bot.client,null);}}
  finally {config.discordBotMode=previous;}
});
test('known credentials and query-string tokens are redacted from diagnostics',()=>{
  const previous=config.youtubeApiKey;config.youtubeApiKey='test-private-value';
  try {assert.equal(safeError(new Error('test-private-value key=other-value')), '[redacted] key=[redacted]');}
  finally {config.youtubeApiKey=previous;}
});
test('shutdown aborts in-flight public requests and prevents a late poll timer',async()=>{
  const key=config.youtubeApiKey;config.youtubeApiKey='';const original=globalThis.fetch;
  globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));
  const service=new YouTubeService({state:{latestVideos:{},arcPlaylists:{}}});
  try {const started=service.start();await Promise.resolve();await service.stop();await started;assert.equal(service.timer,null);assert.equal(service.polling,false);}
  finally{globalThis.fetch=original;config.youtubeApiKey=key;}
});
test('desktop IPC is limited to the trusted main frame and has no arbitrary update URL',()=>{
  const main=fs.readFileSync('desktop/main.mjs','utf8');
  assert.match(main,/event.senderFrame !== mainWindow.webContents.mainFrame/);
  assert.match(main,/event.sender !== mainWindow.webContents/);
  assert.match(main,/handle\('desktop:update-check', \(\) => updates\?\.check\(\)\)/);
});
