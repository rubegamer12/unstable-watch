import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Window} from 'happy-dom';
function fixture(){
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
    playVideo(){this.plays=(this.plays||0)+1;this.emit(1);} pauseVideo(){this.emit(2);} getPlayerState(){return this.status;}
    getCurrentTime(){return this.time;}getDuration(){return 600;}seekTo(t){this.time=t;(this.seeks??=[]).push(t);}
    setVolume(v){this.volume=v;}getVolume(){return this.volume;}isMuted(){return this.muted;}mute(){this.muted=true;}unMute(){this.muted=false;}
    getAvailablePlaybackRates(){return [1,1.25,1.5,2];}getPlaybackRate(){return this.rate;}setPlaybackRate(r){this.rate=r;}
    getOptions(){return ['captions'];}getOption(){return {languageCode:'en'};}setOption(_a,_b,v){this.cc=Boolean(v.languageCode);}loadModule(){this.cc=true;}unloadModule(){this.cc=false;}
    destroy(){this.destroyed=true;}
  }
  w.YT={Player,PlayerState:{PLAYING:1,PAUSED:2,ENDED:0}};
  w.eval(fs.readFileSync('public/app.js','utf8').replace(/\ninit\(\);\s*$/,'')+'\nwindow.testApp={state,wireUI,openPlayer,closePlayer,seekRelative,seekFromClientX,togglePlay,toggleMute,toggleCaptions,cycleSpeed,toggleFullscreen,getProgress,renderUpdateState,setPlaybackStatus,retryPlayback,chronologicalVideos,creatorPlaylist,allVideosContext,renderStoryOrder,getNextVideo,getPrevVideo};');
  const a=w.testApp;const d=w.document;const video={id:'video123456',creatorId:'spoke',creator:'Spoke',title:'Unstable story',watchUrl:'https://www.youtube.com/watch?v=video123456',publishedAt:'2026-09-22',thumbnail:'https://example.com/image.png'};
  a.state.videos=[video];a.state.feed={creators:[{id:'spoke',name:'Spoke',videos:[video]}]};

 a.wireUI();return {w,a,d,video,players,async close(){a.closePlayer();await w.happyDOM.close();}};
}
test('loading, buffering, autoplay blocking, retry and stale callbacks have distinct states',async()=>{
 const f=fixture();const {a,w,d,video,players}=f;
 try {
  let stalled;const nativeTimer=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>ms===12000?(stalled=fn,98765):nativeTimer(fn,ms,...args);
  await a.openPlayer(video);assert.equal(d.querySelector('#playerModal').dataset.playback,'loading');
  assert.equal(d.querySelector('#pauseStatus').hidden,true);assert.equal(d.querySelector('#playPause').disabled,true);
  const p=players[0];p.ready();assert.equal(p.plays,1);assert.equal(p.options.playerVars.autoplay,0);
  p.emit(3);assert.equal(d.querySelector('#playerModal').dataset.playback,'buffering');assert.equal(d.querySelector('#pauseStatus').hidden,true);
  stalled();assert.equal(d.querySelector('#retryPlayback').hidden,false);
  assert.equal(p.plays,1,'Buffering must not trigger repeated play commands');
  a.togglePlay();assert.equal(p.status,2,'Pause works while buffering');
  p.options.events.onAutoplayBlocked();assert.match(d.querySelector('#playbackStatus').textContent,/Press Play/);
  assert.equal(d.querySelector('#playPause').disabled,false);
  p.time=123;await a.retryPlayback();assert.ok(p.destroyed);const next=players[1];next.ready();assert.equal(next.time,123);
  p.emit(3);assert.equal(d.querySelector('#playerModal').dataset.playback,'playing');
  const moduleCalls=[];next.unloadModule=()=>moduleCalls.push('unload');next.loadModule=()=>moduleCalls.push('load');
  next.options.events.onApiChange();assert.deepEqual(moduleCalls,[],'Caption API notifications must never create a module reload loop');
  a.closePlayer();assert.equal(a.state.playbackTimer,null);stalled();assert.equal(d.querySelector('#playerModal').classList.contains('open'),false);
 } finally {await f.close();}
});

test('scrubbing previews locally and commits exactly one seek; keyboard controls do not double fire',async()=>{
 const f=fixture();const {a,w,d,video,players}=f;
 try {
  await a.openPlayer(video);const p=players[0];p.ready();const timeline=d.querySelector('#timeline');
  const pointer=(type,x)=>timeline.dispatchEvent(new w.PointerEvent(type,{clientX:x,button:0,pointerId:7,bubbles:true}));
  pointer('pointerdown',10);for(let x=20;x<=80;x+=10)pointer('pointermove',x);
  assert.equal(p.seeks?.length||0,0);assert.match(d.querySelector('#timecode').textContent,/8:00/);
  pointer('pointerup',80);assert.deepEqual(p.seeks,[480]);assert.equal(a.state.seekDrag,null);
  pointer('pointerdown',20);pointer('pointercancel',30);assert.deepEqual(p.seeks,[480]);
  timeline.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(p.time,485);
  d.querySelector('#volumeRange').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.equal(p.time,485);
  d.querySelector('#playPause').dispatchEvent(new w.KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true,cancelable:true}));assert.equal(p.status,1,'Button keyboard activation must not also fire global shortcuts');
  a.closePlayer();assert.equal(a.state.seekDrag,null);
 } finally {await f.close();}
});

test('episode info is safe text, queue navigation works, and autoplay choice persists',async()=>{
 const f=fixture();const {a,w,d,video,players}=f;
 try {
  video.description='<img src=x onerror=alert(1)> Story details';const second={...video,id:'second12345',title:'Next perspective',creator:'Parrot',publishedAt:'2026-09-23'};
  a.state.videos.push(second);await a.openPlayer(video,{id:'test',title:'Test collection',videos:[video,second]});players[0].ready();
  d.querySelector('#playerInfoToggle').click();assert.equal(d.querySelector('#playerDetails').hidden,false);
  assert.match(d.querySelector('#episodeInfoTitle').textContent,/Unstable story/);assert.equal(d.querySelector('#episodeDescription img'),null);
  assert.equal(d.querySelectorAll('.episode-choice').length,2);
  const auto=d.querySelector('#autoplayNext');auto.checked=false;auto.dispatchEvent(new w.Event('change'));players[0].emit(0);
  assert.equal(a.state.upNextTimer,null);assert.equal(w.localStorage.getItem('unstable-autoplay-next'),'false');
  d.querySelectorAll('.episode-choice')[1].click();await Promise.resolve();assert.equal(a.state.currentVideo.id,second.id);
  players[1].ready();d.querySelector('#restartEpisode').click();assert.equal(players[1].time,0);
 } finally {await f.close();}
});


test('all episode queues are complete, deduplicated and deterministic in upload order',async()=>{
 const f=fixture();const {a,w,d,video,players}=f;
 try {
  const episodes=Array.from({length:40},(_,i)=>({...video,id:'episode-'+String(i).padStart(2,'0'),publishedAt:new Date(Date.UTC(2025,0,i+1)).toISOString(),creatorId:i%2?'parrot':'spoke',creator:i%2?'Parrot':'Spoke'}));
  a.state.videos=[...episodes].reverse();a.state.watchOrder=a.chronologicalVideos(a.state.videos);a.renderStoryOrder();
  assert.equal(a.allVideosContext().videos.length,40);assert.deepEqual(Array.from(a.allVideosContext().videos,v=>v.id),episodes.map(v=>v.id));
  assert.equal(a.creatorPlaylist('spoke').videos.length,20);
  const tied=[{...video,id:'b'},{...video,id:'a'}, {...video,id:'a'}, {...video,id:'unknown',publishedAt:'invalid'}];
  assert.deepEqual(Array.from(a.chronologicalVideos(tied),v=>v.id),['a','b','unknown']);
  d.querySelector('#browseWatchOrder').click();assert.equal(d.querySelectorAll('#arcVideoGrid .video-card').length,40,'All episodes are available beyond the 24-card preview');
  await a.openPlayer(episodes[20],a.allVideosContext());players[0].ready();assert.equal(a.getNextVideo().id,episodes[21].id);assert.equal(a.getPrevVideo().id,episodes[19].id);
  const scope=d.querySelector('#playlistScope');scope.value='creator-spoke';scope.dispatchEvent(new w.Event('change'));
  assert.equal(d.querySelectorAll('.episode-choice').length,20);assert.equal(a.getNextVideo().id,episodes[22].id);
  scope.value='all-order';scope.dispatchEvent(new w.Event('change'));assert.equal(d.querySelectorAll('.episode-choice').length,40);
 } finally {await f.close();}
});
