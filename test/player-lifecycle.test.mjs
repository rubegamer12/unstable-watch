import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Window } from 'happy-dom';

test('actual player handlers preserve pause, seeking, volume, captions, speed, fullscreen and reopen state',async()=>{
  const w=new Window({url:'http://localhost:3000/',settings:{enableJavaScriptEvaluation:true,disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  w.document.write(fs.readFileSync('public/index.html','utf8').replace(/<script[\s\S]*?<\/script>/g,''));
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.document.getElementById('timeline').getBoundingClientRect=()=>({left:0,width:100});
  let full=null;Object.defineProperty(w.document,'fullscreenElement',{get:()=>full});
  w.document.exitFullscreen=async()=>{full=null;};w.document.getElementById('playerMain').requestFullscreen=async()=>{full=w.document.getElementById('playerMain');};
  const players=[];
  class Player {
    constructor(_id,options){this.options=options;this.time=options.playerVars.start;this.status=2;this.volume=80;this.rate=1;this.muted=false;this.cc=false;players.push(this);}
    ready(){this.options.events.onReady({target:this});}
    emit(status){this.status=status;this.options.events.onStateChange({target:this,data:status});}
    playVideo(){this.emit(1);} pauseVideo(){this.emit(2);} getPlayerState(){return this.status;}
    getCurrentTime(){return this.time;}getDuration(){return 600;}seekTo(t){this.time=t;}
    setVolume(v){this.volume=v;}getVolume(){return this.volume;}isMuted(){return this.muted;}mute(){this.muted=true;}unMute(){this.muted=false;}
    getAvailablePlaybackRates(){return [1,1.25,1.5,2];}getPlaybackRate(){return this.rate;}setPlaybackRate(r){this.rate=r;}
    getOptions(){return ['captions'];}getOption(){return {languageCode:'en'};}setOption(_a,_b,v){this.cc=Boolean(v.languageCode);}loadModule(){this.cc=true;}unloadModule(){this.cc=false;}
    destroy(){this.destroyed=true;}
  }
  w.YT={Player,PlayerState:{PLAYING:1,PAUSED:2,ENDED:0}};
  w.eval(fs.readFileSync('public/app.js','utf8').replace(/\ninit\(\);\s*$/,'')+'\nwindow.testApp={state,wireUI,openPlayer,closePlayer,seekRelative,seekFromClientX,togglePlay,toggleMute,toggleCaptions,cycleSpeed,toggleFullscreen,getProgress,renderUpdateState};');
  const a=w.testApp;const d=w.document;const video={id:'video123456',creatorId:'spoke',creator:'Spoke',title:'Unstable story',watchUrl:'https://www.youtube.com/watch?v=video123456',publishedAt:'2026-09-22',thumbnail:'https://example.com/image.png'};
  a.state.videos=[video];a.state.feed={creators:[{id:'spoke',name:'Spoke',videos:[video]}]};
  try {
    a.wireUI();await a.openPlayer(video);const p=players[0];p.ready();
    assert.equal(p.options.playerVars.controls,0);assert.equal(d.querySelector('#pauseStatus').hidden,true);
    a.togglePlay();assert.equal(p.status,2);assert.ok(d.querySelector('#playerModal').classList.contains('is-paused'));
    assert.ok(d.querySelector('#playerModal').classList.contains('controls-visible'));assert.equal(d.querySelector('#pauseStatus').hidden,false);
    assert.equal(d.querySelector('#playerCreator').textContent,'Spoke');d.querySelector('#pauseResume').click();assert.equal(p.status,1);
    a.seekRelative(10);assert.equal(p.time,10);a.seekRelative(-10);assert.equal(p.time,0);a.seekFromClientX(50);assert.equal(p.time,300);
    const volume=d.querySelector('#volumeRange');volume.value='42';volume.dispatchEvent(new w.Event('input'));assert.equal(p.volume,42);
    a.toggleMute();assert.equal(p.muted,true);a.toggleMute();assert.equal(p.muted,false);
    a.toggleCaptions();assert.equal(p.cc,true);a.toggleCaptions();assert.equal(p.cc,false);
    a.cycleSpeed();assert.equal(p.rate,1.25);await a.toggleFullscreen();assert.ok(full);
    a.togglePlay();assert.equal(p.status,2);a.togglePlay();assert.equal(p.status,1);
    a.closePlayer();assert.equal(full,null);assert.ok(p.destroyed);assert.equal(a.getProgress()[video.id].current,300);
    await a.openPlayer(video);const p2=players[1];p2.ready();assert.equal(p2.time,300);
    p.emit(2);assert.equal(d.querySelector('#playerModal').classList.contains('is-paused'),false,'Stale old-player events cannot pause current UI');
    a.closePlayer();assert.equal(a.state.playerTicker,null);assert.equal(d.body.style.overflow,'');
    a.renderUpdateState({status:'ready',version:'4.1.0',availableVersion:'4.2.0'});assert.equal(d.querySelector('#restartUpdate').hidden,false);
    a.renderUpdateState({status:'downloading',percent:63});assert.equal(d.querySelector('#updateProgress').value,63);
  } finally {a.closePlayer();await w.happyDOM.close();}
});
