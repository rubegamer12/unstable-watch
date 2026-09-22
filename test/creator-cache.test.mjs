import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeService } from '../src/youtube.mjs';

test('legacy and cross-channel cached uploads never leak into a creator section', () => {
 const owner='UCabcdefghijklmnopqrstuv';
 const service=new YouTubeService({state:{latestVideos:{spoke:[
 {id:'legacy',creatorId:'spoke'},
 {id:'wrong',creatorId:'spoke',channelId:'UC1234567890123456789012'},
 {id:'right',creatorId:'spoke',channelId:owner}
 ]},arcPlaylists:{}}});
 assert.equal(service.getFeed().find(c=>c.id==='spoke').videos.length,0);
 service.resolved.set('spoke',{channelId:owner});
 assert.deepEqual(service.getFeed().find(c=>c.id==='spoke').videos.map(v=>v.id),['right']);
});
