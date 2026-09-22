import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import { canUpdate, isNewStableVersion, createUpdater, UPDATE_PROVIDER } from '../desktop/updater.mjs';

test('updater only enables for packaged installed Windows, never development or portable',()=>{
  const installed={isPackaged:true,platform:'win32',portable:false,installed:true};
  assert.equal(canUpdate(installed),true);
  for(const patch of [{isPackaged:false},{platform:'linux'},{portable:true},{installed:false}]) assert.equal(canUpdate({...installed,...patch}),false);
});
test('only strictly newer stable versions are eligible',()=>{
  for(const info of [{version:'4.1.0'},{version:'4.0.9'},{version:'4.2.0-beta.1'},{version:'4.2.0',draft:true},{version:'4.2.0',prerelease:true},{version:'bad'}]) assert.equal(isNewStableVersion('4.1.0',info),false);
  assert.equal(isNewStableVersion('4.9.0',{version:'4.10.0'}),true);
});
function fixture(info={version:'4.2.0'}) {
  const updater=new EventEmitter(); let checks=0,downloads=0,installs=0,saved=0;
  updater.setFeedURL=p=>assert.deepEqual(p,UPDATE_PROVIDER);
  updater.checkForUpdates=async()=>{checks++;return {updateInfo:info};};
  updater.downloadUpdate=async()=>{downloads++;updater.emit('download-progress',{percent:63});updater.emit('update-downloaded',info);};
  updater.quitAndInstall=(silent,restart)=>{assert.equal(silent,false);assert.equal(restart,true);assert.equal(saved,1);installs++;};
  const states=[];const controller=createUpdater({updater,enabled:true,version:'4.1.0',publish:s=>states.push(s),beforeInstall:async()=>{saved++;}});
  return {controller,updater,states,counts:()=>({checks,downloads,installs})};
}
test('manual check downloads, reports progress and waits for explicit restart after saving data',async()=>{
  const f=fixture(); await f.controller.check();
  assert.deepEqual(f.states.map(s=>s.status),['checking','available','downloading','downloading','ready']);
  assert.equal(f.states[3].percent,63); assert.equal(f.updater.autoInstallOnAppQuit,false);
  assert.equal(f.updater.allowPrerelease,false); assert.equal(f.updater.allowDowngrade,false);
  assert.equal(f.counts().installs,0);
  await f.controller.check();assert.equal(f.counts().checks,1);
  assert.equal(await f.controller.restart(),true);assert.equal(await f.controller.restart(),false);
  assert.equal(f.counts().installs,1);
});
test('same, older and prerelease updates are never downloaded',async()=>{
  for(const version of ['4.1.0','4.0.0','4.2.0-beta.1']) {
    const f=fixture({version});await f.controller.check();await f.controller.check();
    assert.equal(f.controller.getState().status,'current'); assert.equal(f.counts().downloads,0); assert.equal(f.counts().checks,1);
  }
});
test('updater errors are safe and development never calls updater',async()=>{
  const disabled=createUpdater({enabled:false,version:'4.1.0'}); disabled.start();await disabled.check();assert.equal(await disabled.restart(),false);
  const f=fixture();f.updater.checkForUpdates=async()=>{throw new Error('token=SECRET');};await f.controller.check();
  assert.equal(f.controller.getState().status,'error');assert.ok(!JSON.stringify(f.states).includes('SECRET'));
  f.updater.emit('error',new Error('SECRET'));assert.ok(!JSON.stringify(f.states).includes('SECRET'));
});
test('preload exposes narrow update IPC and strips Electron event objects',async()=>{
  let bridge;const handlers=new Map();const calls=[];
  const ipc={invoke:(...args)=>calls.push(args),on:(c,f)=>handlers.set(c,f),removeListener:c=>handlers.delete(c)};
  vm.runInNewContext(fs.readFileSync('desktop/preload.cjs','utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_n,b)=>bridge=b},ipcRenderer:ipc})});
  bridge.checkForUpdates('https://untrusted.example');assert.deepEqual(calls[0],['desktop:update-check']);
  let received;const unsubscribe=bridge.onUpdateState(s=>received=s);
  handlers.get('desktop:update-state')({sender:'private'},{status:'ready'});assert.deepEqual(received,{status:'ready'});
  unsubscribe();assert.equal(handlers.size,0);
});
test('Windows release uploads generated metadata and blockmap and validates checksum',()=>{
  const workflow=fs.readFileSync('.github/workflows/windows-installer.yml','utf8');
  assert.match(workflow,/dist\/latest.yml/);assert.match(workflow,/exe.blockmap/);
  assert.match(workflow,/verify-update-artifacts.mjs/);assert.match(workflow,/release upload.*\$metadata.FullName.*\$blockmap.FullName/);
  assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
  const pkg=JSON.parse(fs.readFileSync('package.json'));assert.equal(pkg.dependencies['electron-updater'],'6.8.9');
  assert.equal(pkg.build.publish.owner,'rubegamer12');assert.equal(pkg.build.publish.repo,'unstable-watch');
});
