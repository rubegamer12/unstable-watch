import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeXml, extractChannelId, parseYouTubeAtomFeed } from '../src/youtube-public-feed.mjs';

test('extractChannelId supports common YouTube handle page shapes', () => {
  assert.equal(extractChannelId('{"channelId":"UC1234567890123456789012"}'), 'UC1234567890123456789012');
  assert.equal(extractChannelId('{"externalId":"UCabcdefghijklmnopqrstuv"}'), 'UCabcdefghijklmnopqrstuv');
  assert.equal(extractChannelId('<meta itemprop="channelId" content="UCzyxwvutsrqponmlkjihgfe">'), 'UCzyxwvutsrqponmlkjihgfe');
});

test('decodeXml decodes named and numeric XML entities', () => {
  assert.equal(decodeXml('Spoke &amp; Parrot &#33;'), 'Spoke & Parrot !');
});

test('parseYouTubeAtomFeed maps public feed entries into app videos', () => {
  const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
    <entry>
      <yt:videoId>abc123xyz00</yt:videoId>
      <title>Unstable &amp; chaotic</title>
      <published>2026-09-20T10:00:00+00:00</published>
      <media:group>
        <media:description>Episode description</media:description>
        <media:thumbnail url="https://i.ytimg.com/vi/abc123xyz00/hqdefault.jpg" />
      </media:group>
    </entry>
  </feed>`;
  const videos = parseYouTubeAtomFeed(xml, { id: 'spoke', name: 'Spoke' });
  assert.equal(videos.length, 1);
  assert.equal(videos[0].id, 'abc123xyz00');
  assert.equal(videos[0].title, 'Unstable & chaotic');
  assert.equal(videos[0].source, 'public-feed');
  assert.equal(videos[0].creator, 'Spoke');
});
