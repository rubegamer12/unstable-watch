import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('headless HTTP health, configuration, persistence and restart work without Electron or keys',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unstable-headless-'));
  process.env.DATA_DIR=dir;
  process.env.DISCORD_BOT_MODE='disabled';
  const {startServer}=await import('../src/server.mjs');
  const {config}=await import('../src/config.mjs');
  config.discordBotMode='disabled';config.youtubeApiKey='';
  let runtime;
  try {
    runtime=await startServer({host:'127.0.0.1',port:0,startServices:false});
    const health=await(await fetch(runtime.url+'/api/health')).json();
    assert.equal(health.serverReady,true);assert.equal(health.youtubeMode,'public-feed');assert.equal(health.discordReady,false);
    assert.equal(typeof health.uptime,'number');
    const publicConfig=await(await fetch(runtime.url+'/api/config')).json();
    for(const data of [health,publicConfig]) for(const forbidden of ['discordToken','youtubeApiKey','vapidPrivateKey','env']) assert.ok(!(forbidden in data));
    runtime.store.patchGuild('guild',{eventSourceChannelId:'source',uploadChannelId:'uploads',enabledCreators:['spoke']});
    runtime.store.addEvent({id:'event',guildId:'guild',sourceChannelId:'source',content:'Spoke event',createdAt:'2026-09-22T00:00:00Z'});
    runtime.store.setSeenVideo('spoke','seen');await runtime.close();
    runtime=await startServer({host:'127.0.0.1',port:0,startServices:false});
    assert.equal(runtime.store.getGuild('guild').eventSourceChannelId,'source');assert.equal(runtime.store.state.seenVideos.spoke,'seen');
    assert.equal((await(await fetch(runtime.url+'/api/events')).json()).events[0].id,'event');
  } finally {await runtime?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('production deployment excludes Electron and persists state on always-on host',()=>{
  const pkg=JSON.parse(fs.readFileSync('package.json'));assert.equal(pkg.scripts.start,'node src/server.mjs');assert.ok(!pkg.dependencies.electron);
  const docker=fs.readFileSync('Dockerfile','utf8');const render=fs.readFileSync('render.yaml','utf8');
  assert.match(docker,/npm ci --omit=dev/);assert.match(render,/npm ci --omit=dev/);assert.match(render,/mountPath: \/var\/data/);
  assert.doesNotMatch(render,/1382502803058196612/);assert.doesNotMatch(render,/plan: free/);
});
