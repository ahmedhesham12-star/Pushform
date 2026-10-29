import { deserializeDocument, serializeDocument, type PushformDocument } from './commands';

/**
 * The autosave lives in this browser's IndexedDB, which holds image textures
 * (local storage's few megabytes do not); where IndexedDB is missing, in local
 * storage. Models never leave the device.
 */
const DATABASE = 'pushform';
const STORE = 'autosave';
const RECORD = 'document';
/** Autosave slot in local storage: the fallback, and where versions before milestone 5 kept it. */
const AUTOSAVE_KEY = 'pushform.autosave.v1';
/** The open file's name and whether the autosaved document has changes not saved to it. */
const FILE_KEY = 'pushform.file.v1';
/** View settings of this device (not saved in files), such as whether guides are shown. */
const VIEW_KEY = 'pushform.view.v1';

let database: Promise<IDBDatabase | null> | null = null;

/** The autosave database, or null where IndexedDB is missing or refused (some private modes). */
function openDatabase(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const r = indexedDB.open(DATABASE, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}

/** Run one request in a transaction on the autosave store; rejects when it fails. */
function request<T>(db: IDBDatabase, mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const r = make(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The recovery copy, or null when there is none (or it cannot be read). */
export async function loadAutosave(): Promise<PushformDocument | null> {
  const db = await openDatabase();
  if (db) {
    try {
      const saved = await request(db, 'readonly', (s) => s.get(RECORD));
      if (saved !== undefined) return deserializeDocument(saved);
    } catch {
      // Unreadable: try the older copy.
    }
  }
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? deserializeDocument(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Write the recovery copy. Once IndexedDB holds it, the older local storage copy goes, so it is never recovered instead. */
export async function saveAutosave(doc: PushformDocument): Promise<void> {
  const data = serializeDocument(doc);
  const db = await openDatabase();
  if (db) {
    try {
      await request(db, 'readwrite', (s) => s.put(data, RECORD));
      localStorage.removeItem(AUTOSAVE_KEY);
      return;
    } catch {
      // Fall back to local storage.
    }
  }
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be full or disabled (private mode). Modeling still works.
  }
}

export interface FileState {
  /** File name without extension, or null for a model never saved. */
  name: string | null;
  /** The autosaved document has changes the file does not have. */
  unsaved: boolean;
}

/** What the autosave recovers besides the document; a model with changes and no name when unknown. */
export function loadFileState(): FileState {
  try {
    const raw = JSON.parse(localStorage.getItem(FILE_KEY) ?? 'null') as Partial<FileState> | null;
    if (raw && (typeof raw.name === 'string' || raw.name === null) && typeof raw.unsaved === 'boolean') return { name: raw.name, unsaved: raw.unsaved };
  } catch {
    // Unreadable: fall through.
  }
  return { name: null, unsaved: true };
}

export function saveFileState(state: FileState): void {
  try {
    localStorage.setItem(FILE_KEY, JSON.stringify(state));
  } catch {
    // As for the autosave.
  }
}

export interface ViewSettings {
  guides: boolean;
  /** Faces in their tag's color (milestone 5). */
  colorByTag: boolean;
  /** Panels folded shut in the tray, by name. */
  collapsed: string[];
}

const DEFAULT_VIEW: ViewSettings = { guides: true, colorByTag: false, collapsed: [] };

export function loadViewSettings(): ViewSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<ViewSettings> | null;
    // Each setting on its own, so one saved by an older version keeps its value.
    if (raw && typeof raw === 'object') {
      return {
        guides: typeof raw.guides === 'boolean' ? raw.guides : DEFAULT_VIEW.guides,
        colorByTag: typeof raw.colorByTag === 'boolean' ? raw.colorByTag : DEFAULT_VIEW.colorByTag,
        collapsed: Array.isArray(raw.collapsed) ? raw.collapsed.filter((x): x is string => typeof x === 'string') : [],
      };
    }
  } catch {
    // Unreadable: fall through.
  }
  return { ...DEFAULT_VIEW, collapsed: [] };
}

export function saveViewSettings(settings: ViewSettings): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(settings));
  } catch {
    // As for the autosave.
  }
}
