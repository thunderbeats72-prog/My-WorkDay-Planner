/* My Workday Planner — app shell plus local reminders.
 *
 * There is no push server. Notifications are computed on this device from the
 * planner's own IndexedDB, either when the page asks the worker to show one or
 * — on Android, for an installed app — during a periodic background check.
 */

const CACHE = 'workday-shell-v8';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-48.png',
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
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Web Share Target: the system share sheet POSTs the shared title/text/url
  // here when the installed app is chosen. Park the payload where the page
  // half (src/lib/shareInbox.ts) can pick it up on the next open — a cold
  // start included — then redirect into the app. No page is open to talk to,
  // so a message channel alone would drop the share.
  if (request.method === 'POST' && url.pathname === '/share') {
    event.respondWith(
      (async () => {
        try {
          const form = await request.formData();
          const payload = {
            text: String(form.get('text') ?? ''),
            title: String(form.get('title') ?? ''),
            url: String(form.get('url') ?? ''),
            at: Date.now(),
          };
          const cache = await caches.open(CACHE);
          await cache.put(
            '/share/pending',
            new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }),
          );
        } catch {
          // A malformed share must still land the user in the app.
        }
        return Response.redirect('/', 303);
      })(),
    );
    return;
  }

  if (request.method !== 'GET') return;

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

  // Icons and the manifest are network-first: an outdated logo is worse than
  // a slightly slower icon request.
  const isBrandAsset =
    /\.(png|svg|ico)$/i.test(url.pathname) || url.pathname.endsWith('manifest.webmanifest');

  if (isBrandAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Built assets are network-first, cache-second.
  //
  // They used to be cache-first, which is right for an icon and wrong for the
  // application bundle: a phone could keep running last week's code and report
  // last week's bugs while the laptop was fixed. A file whose name is a content
  // hash can never be stale, so asking the network first costs one round trip
  // and buys correctness.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
  );
});

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

const ICON = '/icon-192.png?v=5';
const BADGE = '/favicon-32.png?v=5';

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
  const reminderRows = await readAll(db, 'reminderRecords');
  db.close();

  const due = computeDue(tasks, settings, now, { fired: await firedKeys(), reminders: reminderRows });
  if (due.length === 0) return;

  for (const { task, at, key, slot } of due) {
    await rememberFired(key);
    const overdue = at.getTime() < now.getTime();
    await showNotification(task.title || 'Task due', {
      body: slot > 0
        ? `Still open · ${task.client || 'No client'} · due ${task.dueTime || '17:00'}`
        : overdue
          ? `Overdue · ${task.client || 'No client'} · ${Math.round((now.getTime() - at.getTime()) / 60000)} min ago`
          : `Due at ${task.dueTime || '17:00'} · ${task.client || 'No client'}`,
      /* One tag per nudge, so a repeat is a new banner (and a new buzz) rather
         than a silent replacement of the previous one. */
      tag: key,
      data: { url: '/#tasks', taskId: task.id },
      vibrate: [90, 40, 90],
    });
  }
}

/**
 * Which alerts are due right now — the same rule the page uses.
 *
 * A task enters its lead window once and then keeps nudging every
 * `reminderRepeatMinutes` for as long as it is open. The day boundary restarts
 * the cadence, and `slot` (the step within today's window) is part of the key,
 * so a repeat is never mistaken for one already shown. Kept pure so the rule
 * can be tested without a browser.
 */
function computeDue(tasks, settings, now, options = {}) {
  const fired = options.fired ?? new Set();
  const reminders = options.reminders ?? [];
  const lead = Number(settings.reminderLeadMinutes ?? 60);
  const repeatMinutes = Number(settings.reminderRepeatMinutes ?? 30);
  const repeatMs = repeatMinutes > 0 ? Math.max(repeatMinutes, 5) * 60000 : 0;
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  /* Dismissed and snoozed tasks stay quiet until something changes — the same
     promise the in-app list makes, so closing the app does not undo it. */
  const silenced = new Set();
  for (const record of reminders) {
    const snoozed = record.snoozedUntil && new Date(record.snoozedUntil).getTime() > now.getTime();
    if (record.status === 'dismissed' || record.status === 'done' || snoozed) {
      silenced.add(`${record.taskId}|${record.dueAt}`);
    }
  }

  return tasks
    .filter((task) => task.status !== 'completed' && !task.deletedAt && task.dueDate)
    .map((task) => {
      const at = new Date(`${task.dueDate}T${task.dueTime || '17:00'}:00`);
      if (Number.isNaN(at.getTime())) return null;
      const firstAlertAt = at.getTime() - lead * 60000;
      if (now.getTime() < firstAlertAt) return null;
      const windowStart = Math.max(firstAlertAt, dayStart);
      const slot = repeatMs > 0 ? Math.floor((now.getTime() - windowStart) / repeatMs) : 0;
      const nudgeAt = new Date(windowStart + slot * repeatMs);
      const key = slot === 0
        ? `${task.id}|${at.toISOString()}`
        : `${task.id}|${at.toISOString()}|${nudgeAt.toISOString()}`;
      return { task, at, slot, key, overdue: at.getTime() < now.getTime() };
    })
    .filter((entry) => entry !== null)
    .filter((entry) => !silenced.has(`${entry.task.id}|${entry.at.toISOString()}`))
    .filter((entry) => !fired.has(entry.key))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 3);
}

/* Exposed for the unit test that runs this file in Node; a worker has no other
   way to make its own logic reachable. */
self.__workdayInternals = { computeDue, isQuiet };

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'workday-reminders') event.waitUntil(checkReminders());
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'workday-reminders') event.waitUntil(checkReminders());
});
