// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { MeasurementsBox } from '../src/ui/measurements';

function setup() {
  const submit = vi.fn();
  const cancel = vi.fn();
  const box = new MeasurementsBox({ submit, cancel });
  document.body.append(box.element);
  return { box, submit, cancel };
}

const enter = (input: HTMLInputElement) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

describe('measurements box', () => {
  test('starts read-only: not focusable by tab, styled as plain text', () => {
    const { box } = setup();
    expect(box.isEditable).toBe(false);
    expect(box.input.readOnly).toBe(true);
    expect(box.input.tabIndex).toBe(-1);
    expect(box.element.classList.contains('readonly')).toBe(true);
  });

  test('shows a value such as an area while read-only, and Enter does nothing', () => {
    const { box, submit } = setup();
    box.set('Area', '6.00 m²');
    expect(box.input.value).toBe('6.00 m²');
    enter(box.input);
    expect(submit).not.toHaveBeenCalled();
  });

  test('does not start typing while read-only', () => {
    const { box } = setup();
    box.set('Area', '6.00 m²');
    box.startTyping('5');
    expect(box.input.value).toBe('6.00 m²');
    expect(document.activeElement).not.toBe(box.input);
  });

  test('accepts and submits typed input when editable', () => {
    const { box, submit } = setup();
    box.setEditable(true);
    expect(box.input.readOnly).toBe(false);
    expect(box.input.tabIndex).toBe(0);
    expect(box.element.classList.contains('readonly')).toBe(false);
    box.startTyping('6');
    box.input.value = '600mm';
    enter(box.input);
    expect(submit).toHaveBeenCalledWith('600mm');
  });

  test('becoming read-only drops focus and an unfinished entry', () => {
    const { box } = setup();
    box.setEditable(true);
    box.startTyping('6');
    expect(document.activeElement).toBe(box.input);
    box.setEditable(false);
    expect(document.activeElement).not.toBe(box.input);
    box.set('Area', '1.00 m²');
    expect(box.input.value).toBe('1.00 m²');
  });
});
