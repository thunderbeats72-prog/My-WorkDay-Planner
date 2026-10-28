/** Only a scoped, revocable renewal capability lives here — never a session or VAPID private key. */
export interface WorkerRenewalConfig { token: string; endpoint: string; publicKey: string }

function workerDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('workday-sw', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('fired')) db.createObjectStore('fired', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkerRenewal(config: WorkerRenewalConfig | null): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await workerDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('config', 'readwrite');
      const store = tx.objectStore('config');
      if (config) store.put({ key: 'push-renewal', ...config });
      else store.delete('push-renewal');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

/** Clear only the capability for the subscription being removed. */
export async function clearWorkerRenewalForEndpoint(endpoint: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await workerDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('config', 'readwrite');
      const store = tx.objectStore('config');
      const request = store.get('push-renewal');
      request.onsuccess = () => { if (request.result?.endpoint === endpoint) store.delete('push-renewal'); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
