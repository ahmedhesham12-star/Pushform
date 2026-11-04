/**
 * Opening and saving files on the user's device. Uses the File System Access
 * API where the browser has it (save writes back to the opened file); falls
 * back to a file input to open and a download to save. Nothing leaves the
 * device.
 */

/** The part of a File System Access file handle we use. */
export interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
}

export interface FileType {
  /** Shown in the system dialog. */
  description: string;
  mime: string;
  /** With the dot: '.pushform'. */
  extension: string;
}

interface Pickers {
  showOpenFilePicker?: (options: object) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: object) => Promise<FileHandle>;
}

const pickers = () => window as unknown as Pickers;
const pickerTypes = (type: FileType) => [{ description: type.description, accept: { [type.mime]: [type.extension] } }];
const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** A file name without its extension: "Kitchen.pushform" gives "Kitchen". */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export interface OpenedFile {
  /** File name with its extension. */
  name: string;
  text: string;
  /** Where Save writes back to, when the browser allows it. */
  handle: FileHandle | null;
}

/** Ask for a file to open. Null when the user cancels. */
export async function openFile(type: FileType): Promise<OpenedFile | null> {
  const p = pickers();
  if (p.showOpenFilePicker) {
    try {
      const [handle] = await p.showOpenFilePicker({ types: pickerTypes(type), multiple: false });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${type.extension},${type.mime}`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ name: file.name, text, handle: null }), reject);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export interface SavedFile {
  /** The name the file was saved under, with its extension. */
  name: string;
  handle: FileHandle | null;
}

/**
 * Save data. With a handle (a file opened or saved before), writes back to
 * it; otherwise asks where to save, suggesting `suggestedName`. Without the
 * File System Access API the browser downloads the file instead. Null when
 * the user cancels.
 */
export async function saveFile(data: BlobPart, type: FileType, suggestedName: string, handle: FileHandle | null = null): Promise<SavedFile | null> {
  const p = pickers();
  try {
    let target = handle;
    if (!target && p.showSaveFilePicker) target = await p.showSaveFilePicker({ suggestedName, types: pickerTypes(type) });
    if (target) {
      const w = await target.createWritable();
      await w.write(data);
      await w.close();
      return { name: target.name, handle: target };
    }
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
  const url = URL.createObjectURL(new Blob([data], { type: type.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { name: suggestedName, handle: null };
}
