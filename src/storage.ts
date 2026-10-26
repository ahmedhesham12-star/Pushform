import { deserializeDocument, serializeDocument, type PushformDocument } from './commands';

/** Autosave slot in this browser's local storage. Models never leave the device. */
const AUTOSAVE_KEY = 'pushform.autosave.v1';
/** The open file's name and whether the autosaved document has changes not saved to it. */
const FILE_KEY = 'pushform.file.v1';

export function loadAutosave(): PushformDocument | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return raw ? deserializeDocument(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveAutosave(doc: PushformDocument): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeDocument(doc)));
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
