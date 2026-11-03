// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { createSession, newDocument, showsWoodworking, WORKSPACE_STARTERS, WORKSPACE_TOOL_GROUPS, type CommandSession } from '../src/commands';
import { loadViewSettings, saveViewSettings } from '../src/storage';
import type { PaintChoice } from '../src/tools';
import { EntityInfo, type EntityInfoData } from '../src/ui/entityInfo';
import { MaterialsPanel } from '../src/ui/materialsPanel';
import { ToolBar } from '../src/ui/toolbar';
import { WorkspaceDialog } from '../src/ui/workspaceDialog';

/* What each workspace shows (milestone 6, step 1): the chooser, the Materials panel, Entity Info and the tool bar. */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

describe('the workspace chooser', () => {
  test('offers the three workspaces with the last one focused; a click picks one, Escape or Cancel picks none', () => {
    const dialog = new WorkspaceDialog();
    document.body.replaceChildren(dialog.element);
    const done = vi.fn();
    dialog.open('architecture', done);
    expect(dialog.isOpen).toBe(true);
    const choices = [...dialog.element.querySelectorAll<HTMLButtonElement>('.workspace-choice')];
    expect(choices.map((b) => b.querySelector('b')!.textContent)).toEqual(['Woodworking', 'Architecture', 'General']);
    expect(document.activeElement).toBe(choices[1]);
    choices[2]!.click();
    expect(done).toHaveBeenLastCalledWith('general');
    expect(dialog.isOpen).toBe(false);

    dialog.open('woodworking', done);
    dialog.element.querySelector('[role=dialog]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(done).toHaveBeenLastCalledWith(null);
    dialog.open('woodworking', done);
    [...dialog.element.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(done).toHaveBeenLastCalledWith(null);
    expect(done).toHaveBeenCalledTimes(3);
  });

  test('the last workspace chosen is kept on the device; unknown values read as never asked', () => {
    localStorage.clear();
    expect(loadViewSettings().workspace).toBeNull();
    saveViewSettings({ ...loadViewSettings(), workspace: 'architecture' });
    expect(loadViewSettings().workspace).toBe('architecture');
    localStorage.setItem('pushform.view.v1', JSON.stringify({ guides: false, workspace: 'kitchen' }));
    expect(loadViewSettings()).toMatchObject({ guides: false, workspace: null });
  });
});

function materialsPanel(s: CommandSession) {
  let choice: PaintChoice = { materialId: null };
  const panel = new MaterialsPanel({
    scene: () => s.doc.scene,
    units: () => s.doc.units,
    starters: () => WORKSPACE_STARTERS[s.doc.workspace],
    stock: () => showsWoodworking(s.doc.workspace),
    current: () => choice,
    choose: (c) => void (choice = c),
    add: () => {},
    rename: () => {},
    setColor: () => {},
    setTexture: () => {},
    setStock: () => {},
    duplicate: () => {},
    remove: () => {},
    flash: () => {},
  });
  document.body.replaceChildren(panel.element);
  panel.sync();
  const starters = () => [...panel.element.querySelectorAll('.materials-swatches')[1]!.querySelectorAll('.materials-swatch')].map((b) => b.getAttribute('aria-label'));
  const stockField = () => [...panel.element.querySelectorAll('.materials-field')].some((f) => f.firstChild!.textContent === 'Bought as');
  return { panel, starters, stockField, choose: (c: PaintChoice) => void (choice = c) };
}

describe('the Materials panel follows the workspace', () => {
  test('starters and the stock form change with a switch; the file keeps its materials and stock', () => {
    const s = createSession(newDocument('general'));
    const oak = ok(s.execute('core.addMaterial', { starter: 'oak' })).materialId;
    const m = materialsPanel(s);
    m.choose({ materialId: oak });
    m.panel.sync();
    expect(m.starters()).toEqual(['White', 'Light grey', 'Dark grey', 'Black', 'Wood']);
    expect(m.stockField()).toBe(false);

    ok(s.execute('core.setWorkspace', { workspace: 'woodworking' }));
    m.panel.sync();
    expect(m.starters()).toEqual(['Birch ply', 'Walnut', 'White MDF', 'White melamine', 'Painted sage', 'Painted navy', 'Painted charcoal', 'Painted cream']);
    expect(m.stockField()).toBe(true);

    ok(s.execute('core.setWorkspace', { workspace: 'architecture' }));
    m.panel.sync();
    expect(m.starters()![0]).toBe('Concrete');
    expect(m.stockField()).toBe(false);
    expect(s.doc.scene.materials.get(oak)!.stock).toBeDefined();
  });
});

describe('Entity Info and the tool bar follow the workspace', () => {
  const instance = (grain?: 'red' | null): EntityInfoData => ({
    kind: 'instance',
    type: 'component',
    definitionId: 'd2',
    instanceId: 'i1',
    definitionName: 'Side',
    instanceName: '',
    copies: 1,
    volume: null,
    scale: null,
    stretched: false,
    tag: { value: null, options: [] },
    material: 'Default',
    ...(grain !== undefined ? { grain } : {}),
  });

  test('the grain menu shows only when the data has a grain (Woodworking)', () => {
    const info = new EntityInfo({ renameDefinition: () => {}, renameInstance: () => {}, setTag: () => {}, setGrain: () => {} });
    const labels = () => [...info.element.querySelectorAll('dt, label')].map((x) => x.textContent);
    info.show(instance(null));
    expect(labels()).toContain('Grain');
    info.show(instance());
    expect(labels()).not.toContain('Grain');
  });

  test('a tool bar shows only the workspace groups, with their separators', () => {
    const bar = new ToolBar(
      [
        { id: 'select', label: 'tool.select', icon: 'select', group: 'select' },
        { id: 'line', label: 'tool.line', icon: 'line', group: 'draw' },
        { id: 'rectangle', label: 'tool.rectangle', icon: 'rectangle', group: 'draw' },
        { id: 'orbit', label: 'tool.orbit', icon: 'orbit', group: 'view' },
      ],
      () => {},
    );
    const shown = () => [...bar.element.children].filter((x) => !(x as HTMLElement).hidden).map((x) => (x.tagName === 'HR' ? '|' : x.getAttribute('aria-label')));
    expect(shown()).toEqual(['Select', '|', 'Line', 'Rectangle', '|', 'Orbit']);
    bar.showGroups(['select', 'view']);
    expect(shown()).toEqual(['Select', '|', 'Orbit']);
    bar.showGroups(WORKSPACE_TOOL_GROUPS.woodworking);
    expect(shown()).toEqual(['Select', '|', 'Line', 'Rectangle', '|', 'Orbit']);
  });
});
