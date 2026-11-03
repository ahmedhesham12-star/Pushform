// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { createSession, defaultComponentName, definitionModel } from '../src/commands';
import { listFaces } from '../src/kernel';
import { NameDialog } from '../src/ui/nameDialog';
import { Tray } from '../src/ui/tray';

/* Create Component asks for a name first (milestone 5, checkpoint (c) feedback). */

const KEYS = { title: 'dialog.componentTitle', field: 'dialog.componentName', action: 'dialog.create' } as const;

function open(value = 'Component#1') {
  const d = new NameDialog();
  document.body.replaceChildren(d.element);
  const done = vi.fn();
  d.open(KEYS, value, done);
  const input = d.element.querySelector('input')!;
  const buttons = [...d.element.querySelectorAll('button')];
  const create = buttons.find((b) => b.textContent === 'Create')!;
  const cancel = buttons.find((b) => b.textContent === 'Cancel')!;
  return { d, done, input, create, cancel };
}

describe('the name dialog', () => {
  test('opens with the suggestion selected, so typing replaces it; Create or Enter gives the name', () => {
    const { d, done, input, create } = open();
    expect(d.isOpen).toBe(true);
    expect(d.element.querySelector('h2')!.textContent).toBe('Create Component');
    expect(document.activeElement).toBe(input);
    expect([input.value, input.selectionStart, input.selectionEnd]).toEqual(['Component#1', 0, 11]);
    input.value = 'Drawer';
    input.dispatchEvent(new Event('input'));
    input.form!.requestSubmit(create);
    expect(done).toHaveBeenCalledWith('Drawer');
    expect(d.isOpen).toBe(false);
  });

  test('Escape or Cancel gives nothing; an empty name cannot be created', () => {
    const a = open();
    a.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(a.done).toHaveBeenCalledWith(null);
    const b = open();
    b.cancel.click();
    expect(b.done).toHaveBeenCalledWith(null);
    const c = open();
    c.input.value = '   ';
    c.input.dispatchEvent(new Event('input'));
    expect(c.create.disabled).toBe(true);
    c.input.form!.requestSubmit();
    expect(c.done).not.toHaveBeenCalled();
    expect(c.d.isOpen).toBe(true);
  });

  test('the suggestion is the next free Component#n', () => {
    const s = createSession();
    expect(defaultComponentName(s.doc.scene)).toBe('Component#1');
    const r = s.execute('core.drawRectangle', { faceId: null, corner: [0, 0, 0], width: 100, depth: 100 });
    if (!r.ok) throw new Error(r.error.code);
    s.execute('core.makeComponent', { faceIds: listFaces(definitionModel(s.doc)!).map((f) => f.id) });
    expect(defaultComponentName(s.doc.scene)).toBe('Component#2');
  });
});

describe('the tray opens a folded panel on request', () => {
  test('open unfolds it', () => {
    const tray = new Tray(new Set(['materials']), vi.fn());
    const section = document.createElement('section');
    section.append(Object.assign(document.createElement('h2'), { textContent: 'Materials' }));
    tray.add('materials', section);
    document.body.replaceChildren(tray.element);
    expect(section.classList.contains('folded')).toBe(true);
    tray.open('materials');
    expect(section.classList.contains('folded')).toBe(false);
  });
});
