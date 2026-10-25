import { deserializeDocument, serializeDocument, type PushformDocument } from './commands';

/** Autosave slot in this browser's local storage. Models never leave the device. */
const AUTOSAVE_KEY = 'pushform.autosave.v1';

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
