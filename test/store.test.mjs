import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const source = path.resolve('src/store.mjs');

test('store persists guild settings, push prefs, and dedupes events', async () => {
  const oldCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unstable-store-'));
  process.chdir(dir);
  try {
    const { Store } = await import(`${pathToFileURL(source).href}?test=${Date.now()}`);
    const store = new Store();
    assert.ok(store.getGuild('guild').enabledCreators.includes('spoke'));
    store.patchGuild('guild', { uploadsEnabled: false, mentionRoleId: 'role' });
    const subscription = { endpoint: 'https://push.example/1', keys: { p256dh: 'a', auth: 'b' } };
    store.upsertPushSubscription(subscription, { uploads: true, events: false, creators: ['spoke'] });
    assert.equal(store.getPushEntry(subscription.endpoint).prefs.events, false);
    assert.equal(store.addEvent({ id: 'evt', content: 'hello' }), true);
    assert.equal(store.addEvent({ id: 'evt', content: 'duplicate' }), false);
    store.save();

    const reloaded = new Store();
    assert.equal(reloaded.getGuild('guild').uploadsEnabled, false);
    assert.equal(reloaded.getGuild('guild').mentionRoleId, 'role');
    assert.deepEqual(reloaded.getPushEntry(subscription.endpoint).prefs.creators, ['spoke']);
    assert.equal(reloaded.state.recentEvents.length, 1);
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
