// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { TextEditor } from '../src/ui/textEditor';

const tick = () => new Promise((r) => setTimeout(r));

async function setup() {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = new TextEditor(container);
  const results: (string | null)[] = [];
  editor.open({ x: 10, y: 20 }, 'Corner', (text) => results.push(text));
  const field = container.querySelector('textarea')!;
  await tick();
  const key = (key: string, shiftKey = false) => field.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
  return { container, editor, results, field, key };
}

describe('text editor', () => {
  test('opens with the text selected; Enter finishes it, trimmed, and closes', async () => {
    const { container, editor, results, field, key } = await setup();
    expect(document.activeElement).toBe(field);
    expect(editor.isOpen).toBe(true);
    expect(field.value).toBe('Corner');
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 6]);
    field.value = '  Shelf 1  ';
    key('Enter');
    expect(results).toEqual(['Shelf 1']);
    expect(container.querySelector('textarea')).toBeNull();
    expect(editor.isOpen).toBe(false);
  });

  test('Shift+Enter is a new line, not the end', async () => {
    const { results, key } = await setup();
    expect(key('Enter', true)).toBe(true);
    expect(results).toEqual([]);
  });

  test('Escape drops the change; an empty text counts as dropped', async () => {
    const a = await setup();
    a.key('Escape');
    expect(a.results).toEqual([null]);
    const b = await setup();
    b.field.value = '   ';
    b.key('Enter');
    expect(b.results).toEqual([null]);
  });

  test('leaving the field finishes the text once', async () => {
    const { results, field } = await setup();
    field.blur();
    field.blur();
    expect(results).toEqual(['Corner']);
  });

  test('closing finishes it, even before it took the focus', () => {
    const container = document.createElement('div');
    const editor = new TextEditor(container);
    const results: (string | null)[] = [];
    editor.open({ x: 0, y: 0 }, 'Corner', (text) => results.push(text));
    editor.close();
    editor.close();
    expect(results).toEqual(['Corner']);
    expect(editor.isOpen).toBe(false);
  });

  test('keys typed in it do not reach the page', async () => {
    const { key } = await setup();
    let reached = false;
    window.addEventListener('keydown', () => (reached = true), { once: true });
    key('m');
    expect(reached).toBe(false);
  });
});
