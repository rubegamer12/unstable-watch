const CACHE = 'unstable-watch-v4-0-0';
const SHELL = ['/', '/styles.css', '/app.js', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('/', copy));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }

  if (['/app.js', '/styles.css'].includes(url.pathname)) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    data = { title: 'Unstable Watch', body: event.data?.text() || 'New update' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Unstable Watch', {
    body: data.body || 'New Unstable update',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    image: data.image || undefined,
    tag: data.tag || 'unstable-update',
    renotify: true,
    data: { url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
    const existing = list.find(client => client.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(url);
      return existing.focus();
    }
    return clients.openWindow(url);
  }));
});
