// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSession, documentFromText, documentToText, serializeDocument } from '../src/commands';
import { baseName, openFile, saveFile, type FileHandle } from '../src/files';
import { loadFileState, saveFileState } from '../src/storage';

const TYPE = { description: 'Pushform model', mime: 'application/json', extension: '.pushform' };

/** A file handle that remembers what was written to it. */
function handle(name: string, text = '') {
  const written: string[] = [];
  const h: FileHandle = {
    name,
    getFile: async () => new File([text], name),
    createWritable: async () => ({
      write: async (data: BlobPart) => {
        written.push(typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array));
      },
      close: async () => {},
    }),
  };
  return { h, written };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
});

describe('.pushform files', () => {
  test('a document survives the file text unchanged', () => {
    const s = createSession();
    s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 600, depth: 400 });
    const text = documentToText(s.doc);
    expect(JSON.parse(text).version).toBe(4);
    expect(serializeDocument(documentFromText(text)!)).toEqual(serializeDocument(s.doc));
  });

  test('text that is not a model is refused', () => {
    expect(documentFromText('not json')).toBeNull();
    expect(documentFromText('{"format":"something else"}')).toBeNull();
  });

  test('file names lose their extension', () => {
    expect(baseName('Kitchen.pushform')).toBe('Kitchen');
    expect(baseName('a.b.pushform')).toBe('a.b');
    expect(baseName('.pushform')).toBe('.pushform');
    expect(baseName('Plain')).toBe('Plain');
  });
});

describe('with the File System Access API', () => {
  test('save as asks where, then writes there', async () => {
    const { h, written } = handle('Cabinet.pushform');
    const picker = vi.fn(async () => h);
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;
    const r = await saveFile('{"x":1}', TYPE, 'Untitled.pushform');
    expect(picker).toHaveBeenCalledOnce();
    expect(r).toEqual({ name: 'Cabinet.pushform', handle: h });
    expect(written).toEqual(['{"x":1}']);
  });

  test('save writes back to the open file without asking', async () => {
    const { h, written } = handle('Cabinet.pushform');
    const picker = vi.fn();
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;
    await saveFile('second', TYPE, 'Cabinet.pushform', h);
    expect(picker).not.toHaveBeenCalled();
    expect(written).toEqual(['second']);
  });

  test('cancelling the dialog saves nothing', async () => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async () => {
      throw new DOMException('cancelled', 'AbortError');
    };
    expect(await saveFile('x', TYPE, 'a.pushform')).toBeNull();
  });

  test('open reads the chosen file and keeps its handle', async () => {
    const { h } = handle('Desk.pushform', '{"y":2}');
    (window as unknown as Record<string, unknown>).showOpenFilePicker = async () => [h];
    expect(await openFile(TYPE)).toEqual({ name: 'Desk.pushform', text: '{"y":2}', handle: h });
  });
});

describe('without it', () => {
  test('save downloads the file under the suggested name', async () => {
    const clicks: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ download: this.download, href: this.href });
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
    const r = await saveFile('data', TYPE, 'Untitled.pushform');
    expect(r).toEqual({ name: 'Untitled.pushform', handle: null });
    expect(clicks).toEqual([{ download: 'Untitled.pushform', href: 'blob:test' }]);
  });

  test('open uses a file input', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      const file = new File(['{"z":3}'], 'Shelf.pushform');
      Object.defineProperty(this, 'files', { value: [file] });
      this.dispatchEvent(new Event('change'));
    });
    expect(await openFile(TYPE)).toEqual({ name: 'Shelf.pushform', text: '{"z":3}', handle: null });
  });
});

describe('recovery', () => {
  test('the file name and unsaved state are remembered with the autosave', () => {
    localStorage.clear();
    expect(loadFileState()).toEqual({ name: null, unsaved: true });
    saveFileState({ name: 'Cabinet', unsaved: false });
    expect(loadFileState()).toEqual({ name: 'Cabinet', unsaved: false });
    localStorage.setItem('pushform.file.v1', '{"name":3}');
    expect(loadFileState()).toEqual({ name: null, unsaved: true });
  });
});
