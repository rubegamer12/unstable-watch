import test from 'node:test';
import assert from 'node:assert/strict';
import { eventFromMessage, detectEventCreators, newestLocalEvent, INACCESSIBLE_EXTERNAL_SOURCE } from '../src/events.mjs';
import { DiscordBot, commands, eventEmbed } from '../src/discord-bot.mjs';

const message = patch => ({id:'1', guildId:'guild', channelId:'source', channel:{name:'unstable-event-feed'}, author:{id:'user',username:'Forwarder'}, content:'Wemmbu: Kingdom War', createdAt:new Date('2026-09-22T00:00:00Z'), url:'https://discord.com/channels/guild/source/1', ...patch});
for (const name of ['Spoke','Parrot','Wemmbu','FlameFrags']) test(`event target: ${name}`, () => assert.deepEqual(detectEventCreators(`${name} is hosting an event`),[name]));
test('multiple names are supported; unclear targets are Unspecified', () => {
  assert.deepEqual(detectEventCreators('Spoke and Parrot'),['Spoke','Parrot']);
  assert.deepEqual(detectEventCreators('Kingdom War tomorrow'),['Unspecified']);
  assert.deepEqual(detectEventCreators('outspoken parrots'),['Unspecified']);
});
test('normal, embed-only, webhook and forwarded messages normalize consistently', () => {
  assert.equal(eventFromMessage(message()).title,'Wemmbu: Kingdom War');
  const embed = eventFromMessage(message({content:'', embeds:[{title:'Kingdom War',description:'Spoke joins',fields:[{name:'Opponent',value:'Parrot'}],image:{url:'https://example.com/event.png'}}]}));
  assert.deepEqual(embed.targetCreators,['Spoke','Parrot']);
  assert.equal(embed.image,'https://example.com/event.png');
  assert.ok(eventFromMessage(message({webhookId:'hook',author:{id:'hook',bot:true}}),'bot'));
  const forwarded=eventFromMessage(message({content:'',messageSnapshots:new Map([['original',{content:'FlameFrags fight',attachments:new Map([['a',{contentType:'image/png',url:'https://example.com/forward.png'}]])}]])}));
  assert.deepEqual(forwarded.targetCreators,['FlameFrags']);
  assert.equal(forwarded.image,'https://example.com/forward.png');
  assert.equal(eventFromMessage(message({author:{id:'bot'}}),'bot'),null);
  assert.equal(eventFromMessage(message({content:''})),null);
});
function fixture() {
  const settings={eventSourceChannelId:'source',eventChannelId:'destination',eventsEnabled:true,enabledCreators:[]};
  const state={guilds:{guild:settings},recentEvents:[],latestVideos:{}};
  const store={state,getGuild:()=>settings,patchGuild:(_id,p)=>Object.assign(settings,p),addEvent:e=>{if(state.recentEvents.some(x=>x.id===e.id))return false;state.recentEvents.push(e);return true;}};
  const messages=new Map(); const sent=[]; const fetched=[];
  const source={id:'source',guildId:'guild',isTextBased:()=>true,permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>messages}};
  const destination={guildId:'guild',isTextBased:()=>true,send:async p=>sent.push(p)};
  const guild={members:{me:{}},channels:{fetch:async id=>{fetched.push(id);return id==='source'?source:destination;}}};
  const bot=new DiscordBot(store);
  bot.client={isReady:()=>true,user:{id:'bot'},guilds:{cache:new Map([['guild',guild]])},channels:{fetch:async()=>destination}};
  const replies=[];
  const interaction={guildId:'guild',guild,isChatInputCommand:()=>true,options:{getString:()=> 'events',getChannel:()=>source},reply:async p=>replies.push(p)};
  return {bot,store,settings,messages,sent,fetched,interaction,replies,source};
}
test('setsource validates a local channel and status reports the relay', async()=>{
  assert.ok(commands.some(c=>c.name==='setsource'));
  const f=fixture(); f.settings.eventSourceChannelId=null;
  await f.bot.handleInteraction({...f.interaction,commandName:'setsource'});
  assert.equal(f.settings.eventSourceChannelId,'source');
  await f.bot.handleInteraction({...f.interaction,commandName:'status'});
  assert.ok(f.replies[1].embeds[0].toJSON().fields.some(f=>f.name==='Event source'&&f.value==='<#source>'));
  f.source.guildId='elsewhere'; await f.bot.handleInteraction({...f.interaction,commandName:'setsource'});
  assert.match(f.replies[2].content,/Choose a channel in this server/);
});
test('newest legitimate local event is cached and testnotify sends that exact event',async()=>{
  const f=fixture();
  f.messages.set('old',message({id:'old',createdAt:new Date('2026-09-21')}));
  f.messages.set('new',message({id:'new',content:'Parrot: new event'}));
  f.messages.set('own',message({id:'own',author:{id:'bot'}}));
  await f.bot.handleInteraction({...f.interaction,commandName:'testnotify'});
  assert.equal(f.store.state.recentEvents[0].id,'new');
  assert.deepEqual(f.sent[0].embeds[0].toJSON(),eventEmbed(f.store.state.recentEvents[0],{test:true}).toJSON());
  f.messages.clear(); assert.equal((await f.bot.getLatestEventForTest('guild')).id,'new');
  assert.equal(newestLocalEvent(f.store.state.recentEvents,'another','source'),null);
});
test('live local source ingestion dedupes and ignores own bot and unrelated source',async()=>{
  const f=fixture();
  await f.bot.handleSourceEvent(message()); await f.bot.handleSourceEvent(message());
  await f.bot.handleSourceEvent(message({id:'own',author:{id:'bot'}}));
  await f.bot.handleSourceEvent(message({id:'other',channelId:'other'}));
  assert.equal(f.store.state.recentEvents.length,1); assert.equal(f.sent.length,1);
});
test('unconfigured or inaccessible external source is never fetched',async()=>{
  const f=fixture(); f.settings.eventSourceChannelId=null;
  await f.bot.handleInteraction({...f.interaction,commandName:'testnotify'});
  assert.match(f.replies[0].content,/No local event source.*\/setsource/);
  f.settings.eventSourceChannelId=INACCESSIBLE_EXTERNAL_SOURCE;
  assert.equal(await f.bot.getLatestEventForTest('guild'),null);
  assert.deepEqual(f.fetched,[]);
});
