/* My Workday Planner — app shell plus local reminders.
 *
 * There is no push server. Notifications are computed on this device from the
 * planner's own IndexedDB, either when the page asks the worker to show one or
 * — on Android, for an installed app — during a periodic background check.
 */

const CACHE = 'workday-shell-v3';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached ?? caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const ICON = '/icon-192.png';
const BADGE = '/favicon-32.png';

async function showNotification(title, options) {
  try {
    await self.registration.showNotification(title, {
      icon: ICON,
      badge: BADGE,
      ...options,
    });
    return true;
  } catch {
    return false;
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'workday:notify') return;
  const payload = data.payload ?? {};
  event.waitUntil(
    showNotification(payload.title ?? 'Workday Planner', {
      body: payload.body ?? '',
      tag: payload.tag ?? 'workday',
      data: { url: payload.url ?? '/#tasks', taskId: payload.taskId ?? null },
      vibrate: [90, 40, 90],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const target = data.url ?? '/#tasks';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        client.postMessage({ type: 'workday:notification-click', taskId: data.taskId ?? null, url: target });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/* ------------------------------------------------------------------ */
/* Local background check (Android PWA, best effort)                   */
/* ------------------------------------------------------------------ */

function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = version ? indexedDB.open(name, version) : indexedDB.open(name);
    if (upgrade) request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAll(db, store) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) {
      resolve([]);
      return;
    }
    const request = db.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => resolve([]);
  });
}

function readOne(db, store, key) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(store)) {
      resolve(null);
      return;
    }
    const request = db.transaction(store, 'readonly').objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

async function firedKeys() {
  try {
    const db = await openDB('workday-sw', 1, (database) => {
      if (!database.objectStoreNames.contains('fired')) database.createObjectStore('fired', { keyPath: 'key' });
    });
    const rows = await readAll(db, 'fired');
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const set = new Set(rows.filter((row) => row.at > cutoff).map((row) => row.key));
    db.close();
    return set;
  } catch {
    return new Set();
  }
}

async function rememberFired(key) {
  try {
    const db = await openDB('workday-sw', 1, (database) => {
      if (!database.objectStoreNames.contains('fired')) database.createObjectStore('fired', { keyPath: 'key' });
    });
    await new Promise((resolve) => {
      const tx = db.transaction('fired', 'readwrite');
      tx.objectStore('fired').put({ key, at: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    db.close();
  } catch {
    /* best effort */
  }
}

function minutesOf(value) {
  const [h, m] = String(value ?? '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isQuiet(settings, now) {
  if (!settings.quietHoursEnabled) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesOf(settings.quietStart);
  const end = minutesOf(settings.quietEnd);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

async function checkReminders() {
  if (!self.Notification || self.Notification.permission !== 'granted') return;
  let db;
  try {
    db = await openDB('bd-command-center');
  } catch {
    return;
  }
  const settings = await readOne(db, 'settings', 'app');
  if (!settings || !settings.notificationsEnabled) {
    db.close();
    return;
  }
  const now = new Date();
  if (isQuiet(settings, now)) {
    db.close();
    return;
  }
  const tasks = await readAll(db, 'tasks');
  db.close();

  const lead = Number(settings.reminderLeadMinutes ?? 60);
  const due = tasks
    .filter((task) => task.status !== 'completed' && !task.deletedAt && task.dueDate)
    .map((task) => {
      const at = new Date(`${task.dueDate}T${task.dueTime || '17:00'}:00`);
      return { task, at };
    })
    .filter((item) => !Number.isNaN(item.at.getTime()))
    .filter((item) => (item.at.getTime() - now.getTime()) / 60000 <= lead)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 3);

  if (due.length === 0) return;
  const fired = await firedKeys();

  for (const { task, at } of due) {
    const key = `${task.id}|${at.toISOString()}`;
    if (fired.has(key)) continue;
    await rememberFired(key);
    const overdue = at.getTime() < now.getTime();
    await showNotification(task.title || 'Task due', {
      body: overdue
        ? `Overdue · ${task.client || 'No client'} · ${Math.round((now.getTime() - at.getTime()) / 60000)} min ago`
        : `Due at ${task.dueTime || '17:00'} · ${task.client || 'No client'}`,
      tag: key,
      data: { url: '/#tasks', taskId: task.id },
      vibrate: [90, 40, 90],
    });
  }
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'workday-reminders') event.waitUntil(checkReminders());
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'workday-reminders') event.waitUntil(checkReminders());
});
