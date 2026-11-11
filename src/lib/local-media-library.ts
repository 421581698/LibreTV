const DB_NAME = 'libretv-local-media-library';
const STORE_NAME = 'resources';
const DB_VERSION = 1;

function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本地影视库缓存。'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地影视库。'));
  });
}

export async function readLocalMediaLibrary<T>(): Promise<T[]> {
  const database = await openLibrary();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as T[] : []);
      request.onerror = () => reject(request.error || new Error('读取本地影视库失败。'));
    });
  } finally {
    database.close();
  }
}

export async function replaceLocalMediaLibrary<T extends { id: string }>(resources: T[]): Promise<void> {
  const database = await openLibrary();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      for (const resource of resources) store.put(resource);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('保存本地影视库失败。'));
      transaction.onabort = () => reject(transaction.error || new Error('保存本地影视库已中断。'));
    });
  } finally {
    database.close();
  }
}
