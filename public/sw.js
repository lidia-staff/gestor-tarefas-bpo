self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  const { title, body, tag } = data;
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: tag || 'gestor-notif',
        renotify: true,
        vibrate: [200, 100, 200],
        silent: false,
      }),
      // Avisa a página para tocar o som
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
        cs.forEach(c => c.postMessage({ type: 'PLAY_NOTIFICATION_SOUND' }));
      }),
    ])
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      for (const c of cs) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
