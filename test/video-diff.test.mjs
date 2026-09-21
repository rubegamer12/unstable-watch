import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnseenVideos } from '../src/video-diff.mjs';

const videos = ['newest', 'middle', 'old', 'seen'].map(id => ({ id }));

test('returns every unseen upload in oldest-to-newest notification order', () => {
  assert.deepEqual(getUnseenVideos(videos, 'seen').map(v => v.id), ['old', 'middle', 'newest']);
});

test('returns nothing when newest is already seen', () => {
  assert.deepEqual(getUnseenVideos(videos, 'newest'), []);
});

test('limits unknown history to newest item to avoid notification storms', () => {
  assert.deepEqual(getUnseenVideos(videos, 'missing').map(v => v.id), ['newest']);
});
