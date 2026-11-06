/**
 * The personal library (milestone 6): components saved on this device, to
 * insert into any file. It lives in its own IndexedDB database, apart from
 * the autosave; where IndexedDB is missing it lasts until the page closes.
 * Items never leave the device.
 */

export interface LibraryEntry {
  readonly id: string;
  readonly name: string;
  /** When it was saved (ms since 1970). */
  readonly savedAt: number;
  /** The item, as `libraryItem` makes it. */
  readonly text: string;
}

export interface LibraryStore {
  /** Every item, by name. */
  list(): Promise<LibraryEntry[]>;
  save(name: string, text: string): Promise<LibraryEntry>;
  remove(id: string): Promise<void>;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a: LibraryEntry, b: LibraryEntry) => collator.compare(a.name, b.name) || a.savedAt - b.savedAt;
const newEntryId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A library kept in memory: for tests, and where IndexedDB is missing. */
export function memoryLibrary(): LibraryStore {
  const items = new Map<string, LibraryEntry>();
  return {
    list: async () => [...items.values()].sort(byName),
    async save(name, text) {
      const entry = { id: newEntryId(), name, savedAt: Date.now(), text };
      items.set(entry.id, entry);
      return entry;
    },
    async remove(id) {
      items.delete(id);
    },
  };
}

const DATABASE = 'pushform-library';
const STORE = 'items';

/** This device's library, in IndexedDB. */
export function deviceLibrary(): LibraryStore {
  let opened: Promise<IDBDatabase | null> | null = null;
  const fallback = memoryLibrary();
  const open = () =>
    (opened ??= new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') return resolve(null);
      try {
        const r = indexedDB.open(DATABASE, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const request = <T>(db: IDBDatabase, mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const r = make(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  return {
    async list() {
      const db = await open();
      if (!db) return fallback.list();
      return ((await request(db, 'readonly', (s) => s.getAll())) as LibraryEntry[]).sort(byName);
    },
    async save(name, text) {
      const db = await open();
      if (!db) return fallback.save(name, text);
      const entry = { id: newEntryId(), name, savedAt: Date.now(), text };
      await request(db, 'readwrite', (s) => s.put(entry));
      return entry;
    },
    async remove(id) {
      const db = await open();
      if (!db) return fallback.remove(id);
      await request(db, 'readwrite', (s) => s.delete(id));
    },
  };
}
