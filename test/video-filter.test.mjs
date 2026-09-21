import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoDuration, isShortFormVideo, filterUnstableVideos } from '../src/video-filter.mjs';

test('parses YouTube ISO durations', () => {
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT17M'), 1020);
});

test('removes Shorts without deleting normal short episodes', () => {
  assert.equal(isShortFormVideo({ title: 'thing #shorts', durationSeconds: 800 }), true);
  assert.equal(isShortFormVideo({ title: 'normal', durationSeconds: 59 }), true);
  assert.equal(isShortFormVideo({ title: 'normal', durationSeconds: 181 }), false);
  assert.equal(isShortFormVideo({ title: 'normal', durationSeconds: 1200 }), false);
});

test('uses known Unstable matches to keep the complete recent story era', () => {
  const videos = [
    { id: 'new-episode', title: 'I Escaped The Kingdom', description: '', durationSeconds: 1200 },
    { id: 'explicit', title: 'The Unstable SMP Changed Forever', description: '', durationSeconds: 1500 },
    { id: 'older-unrelated', title: 'Old unrelated challenge', description: '', durationSeconds: 1400 },
    { id: 'short', title: 'Unstable clip #shorts', description: '', durationSeconds: 40 }
  ];
  const result = filterUnstableVideos(videos, []);
  assert.deepEqual(result.map(video => video.id), ['new-episode', 'explicit']);
  assert.equal(result[0].unstableMetadataMatch, false);
  assert.equal(result[1].unstableMetadataMatch, true);
});

test('falls back to long-form protagonist uploads instead of wiping the library', () => {
  const videos = [
    { id: 'a', title: 'Story episode with no series keyword', description: '', durationSeconds: 1300 },
    { id: 'b', title: 'Another episode', description: '', durationSeconds: 900 },
    { id: 'c', title: 'tiny clip', description: '', durationSeconds: 90 }
  ];
  const result = filterUnstableVideos(videos, []);
  assert.deepEqual(result.map(video => video.id), ['a', 'b']);
  assert.ok(result.every(video => video.isUnstable && !video.isShort));
});

test('arc playlist membership counts as an Unstable match', () => {
  const videos = [
    { id: 'a', title: 'Newest unlabeled episode', description: '', durationSeconds: 1200 },
    { id: 'b', title: 'Arc upload', description: '', durationSeconds: 900 },
    { id: 'c', title: 'Old video', description: '', durationSeconds: 1000 }
  ];
  const result = filterUnstableVideos(videos, [{ videoIds: ['b'] }]);
  assert.deepEqual(result.map(video => video.id), ['a', 'b']);
});
