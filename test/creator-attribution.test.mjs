import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChannelId, parseYouTubeAtomFeed, decodeXml } from '../src/youtube-public-feed.mjs';
const spoke = 'UCabcdefghijklmnopqrstuv';
const parrot = 'UC1234567890123456789012';

test('recommended Parrot videos never resolve as the Spoke page owner', () => {
 const html = JSON.stringify({ recommendations: [{channelId:parrot}], metadata: {channelMetadataRenderer: {title:'Spoke',externalId:spoke,vanityChannelUrl:'https://www.youtube.com/@Spokeishere'}} });
 assert.equal(extractChannelId(html, 'Spokeishere'), spoke);
 assert.equal(extractChannelId(html, 'ParrotX2'), null);
 assert.equal(extractChannelId(JSON.stringify({channelId:parrot})), null);
 assert.equal(extractChannelId('<meta content="'+spoke+'" itemprop="channelId">'), spoke);
});

test('feed and entry ownership must match the requested creator', () => {
 const xml = '<feed><yt:channelId>'+spoke+'</yt:channelId><entry><yt:videoId>valid-video</yt:videoId><yt:channelId>'+spoke+'</yt:channelId><title>Spoke upload</title></entry><entry><yt:videoId>wrong-video</yt:videoId><yt:channelId>'+parrot+'</yt:channelId><title>Parrot upload</title></entry></feed>';
 const videos = parseYouTubeAtomFeed(xml, {id:'spoke',name:'Spoke',channelId:spoke});
 assert.equal(videos.length,1);
 assert.equal(videos[0].id,'valid-video');
 assert.equal(videos[0].channelId,spoke);
 assert.throws(()=>parseYouTubeAtomFeed(xml,{channelId:parrot}),/does not match/);
 assert.throws(()=>parseYouTubeAtomFeed('<feed></feed>',{channelId:spoke}),/does not match/);
});

test('invalid XML numeric entities cannot crash a creator sync', () => {
 assert.equal(decodeXml('&#x110000;'),'&#x110000;');
});
