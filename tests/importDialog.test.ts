// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { ImportDialog, type ImportChoice } from '../src/ui/importDialog';

const size = (c: ImportChoice) => `${c.unit} ${c.zUp ? 'z' : 'y'}`;

describe('the import dialog', () => {
  test('asks for units and the up axis when the file states neither; the size follows the choice', () => {
    const d = new ImportDialog();
    document.body.replaceChildren(d.element);
    const done = vi.fn();
    d.open({ name: 'Slide.stl', triangles: '12', unit: null, suggested: 'in', zUp: true }, size, done);
    const text = () => d.element.querySelector('.import-dialog-size')!.textContent;
    expect(d.element.querySelector('h2')!.textContent).toBe('Import Slide.stl');
    expect(text()).toBe('Size: in z');
    const select = d.element.querySelector('select')!;
    select.value = 'mm';
    select.dispatchEvent(new Event('change'));
    const box = d.element.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(text()).toBe('Size: mm y');
    d.element.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(done).toHaveBeenCalledWith({ unit: 'mm', zUp: false });
    expect(d.isOpen).toBe(false);
  });

  test('a GLB states its units and axes, so only its size shows; Escape gives nothing', () => {
    const d = new ImportDialog();
    document.body.replaceChildren(d.element);
    const done = vi.fn();
    d.open({ name: 'Hinge.glb', triangles: '2,400', unit: 'm', suggested: 'mm', zUp: null }, size, done);
    expect(d.element.querySelector('select')).toBeNull();
    expect(d.element.querySelector('input')).toBeNull();
    expect(d.element.textContent).toContain('Units: Meters, from the file');
    d.element.querySelector('form')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(done).toHaveBeenCalledWith(null);
  });
});
