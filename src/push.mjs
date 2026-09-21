import webpush from 'web-push';
import { config } from './config.mjs';
import { loadVapidFile, saveVapidFile } from './store.mjs';

function shouldDeliver(entry, payload) {
  const prefs = entry.prefs || {};
  if (payload.kind === 'event') return prefs.events !== false;
  if (payload.kind === 'upload') {
    if (prefs.uploads === false) return false;
    if (!payload.creatorId) return true;
    return !Array.isArray(prefs.creators) || prefs.creators.includes(payload.creatorId);
  }
  return true;
}

export class PushService {
  constructor(store) {
    this.store = store;
    let publicKey = config.vapidPublicKey;
    let privateKey = config.vapidPrivateKey;

    if (!publicKey || !privateKey) {
      const saved = loadVapidFile();
      if (saved?.publicKey && saved?.privateKey) {
        ({ publicKey, privateKey } = saved);
      } else {
        const generated = webpush.generateVAPIDKeys();
        publicKey = generated.publicKey;
        privateKey = generated.privateKey;
        saveVapidFile({ publicKey, privateKey });
      }
    }

    this.publicKey = publicKey;
    webpush.setVapidDetails(config.baseUrl.startsWith('https://') ? config.baseUrl : 'https://unstable.local', publicKey, privateKey);
  }

  async send(payload) {
    const body = JSON.stringify(payload);
    const entries = [...this.store.state.pushSubscriptions].filter(entry => shouldDeliver(entry, payload));
    const results = await Promise.allSettled(entries.map(async entry => {
      try {
        await webpush.sendNotification(entry.subscription, body, { TTL: 300 });
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          this.store.removePushSubscription(entry.subscription.endpoint);
          return;
        }
        throw error;
      }
    }));
    return results;
  }
}
