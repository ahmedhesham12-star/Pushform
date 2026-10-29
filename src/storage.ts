import { deserializeDocument, serializeDocument, type PushformDocument } from './commands';

/** Autosave slot in this browser's local storage. Models never leave the device. */
const AUTOSAVE_KEY = 'pushform.autosave.v1';
/** The open file's name and whether the autosaved document has changes not saved to it. */
const FILE_KEY = 'pushform.file.v1';
/** View settings of this device (not saved in files), such as whether guides are shown. */
const VIEW_KEY = 'pushform.view.v1';

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
