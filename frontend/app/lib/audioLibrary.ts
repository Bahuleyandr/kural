export type StoredAudioFormat = "wav" | "mp3";

export interface StoredAudioItem {
  id: string;
  text: string;
  voiceLabel: string;
  format: StoredAudioFormat;
  createdAt: string;
  bytes: number;
  blob: Blob;
}

const DB_NAME = "kural-audio-library";
const DB_VERSION = 1;
const STORE_NAME = "items";
const CREATED_AT_INDEX = "createdAt";

function canUseIndexedDb() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDb(): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "id" });

      if (store && !store.indexNames.contains(CREATED_AT_INDEX)) {
        store.createIndex(CREATED_AT_INDEX, "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open audio library"));
  });
}

export async function loadAudioItems(limit: number): Promise<StoredAudioItem[]> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const items: StoredAudioItem[] = [];
    const transaction = db.transaction(STORE_NAME, "readonly");
    const index = transaction.objectStore(STORE_NAME).index(CREATED_AT_INDEX);
    const request = index.openCursor(null, "prev");

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || items.length >= limit) return;
      items.push(cursor.value as StoredAudioItem);
      cursor.continue();
    };

    transaction.oncomplete = () => {
      db.close();
      resolve(items);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not load audio library"));
    };
  });
}

export async function saveAudioItem(
  item: StoredAudioItem,
  limit: number
): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    let seen = 0;
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index(CREATED_AT_INDEX);

    store.put(item);
    const request = index.openCursor(null, "prev");

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      seen += 1;
      if (seen > limit) cursor.delete();
      cursor.continue();
    };

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not save audio item"));
    };
  });
}

export async function deleteAudioItem(id: string): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not delete audio item"));
    };
  });
}
