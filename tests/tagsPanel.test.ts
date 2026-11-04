// @vitest-environment happy-dom
import { describe, expect, test, vi } from 'vitest';
import { createSession, definitionModel, type CommandSession } from '../src/commands';
import { listFaces } from '../src/kernel';
import { pathTag, type Scene } from '../src/scene';
import { EntityInfo, type EntityInfoData } from '../src/ui/entityInfo';
import { TagsPanel, type TagsHost } from '../src/ui/tagsPanel';
import { Tray } from '../src/ui/tray';
import { InstancesView } from '../src/viewport/instancesView';
import type { MeshLambertMaterial } from 'three';

/* The Tags panel, the panel tray, the Tag field of Entity Info, and Color by Tag (milestone 5, step 2). */

function ok<O>(r: { ok: true; output: O } | { ok: false; error: { code: string } }): O {
  if (!r.ok) throw new Error(r.error.code);
  return r.output;
}

function panel(s: CommandSession) {
  let byTag = false;
  const host: TagsHost = {
    scene: () => s.doc.scene,
    colorByTag: () => byTag,
    add: vi.fn(() => void ok(s.execute('core.addTag', {}))),
    rename: vi.fn((tagId, name) => void ok(s.execute('core.renameTag', { tagId, name }))),
    setColor: vi.fn((tagId, color) => void ok(s.execute('core.setTagColor', { tagId, color }))),
    setVisible: vi.fn((tagId, visible) => void ok(s.execute('core.setTagVisible', { tagId, visible }))),
    remove: vi.fn((tagId) => void ok(s.execute('core.deleteTag', { tagId }))),
    setColorByTag: vi.fn((on: boolean) => void (byTag = on)),
  };
  const p = new TagsPanel(host);
  document.body.replaceChildren(p.element);
  p.sync();
  const rows = () => [...p.element.querySelectorAll('.tags-row')].map((r) => r.querySelector('.tags-name')!.textContent);
  const row = (name: string) => [...p.element.querySelectorAll<HTMLElement>('.tags-row')].find((r) => r.querySelector('.tags-name')?.textContent === name)!;
  return { p, host, rows, row };
}

describe('the Tags panel', () => {
  test('lists Untagged first, then the tags by name; Untagged cannot be hidden, renamed or deleted', () => {
    const s = createSession();
    ok(s.execute('core.addTag', { name: 'Shelves' }));
    ok(s.execute('core.addTag', { name: 'Doors' }));
    ok(s.execute('core.addTag', { name: 'Tag 10' }));
    ok(s.execute('core.addTag', { name: 'Tag 9' }));
    const { rows, row } = panel(s);
    expect(rows()).toEqual(['Untagged', 'Doors', 'Shelves', 'Tag 9', 'Tag 10']);
    const untagged = row('Untagged');
    expect(untagged.querySelector('button')!.disabled).toBe(true);
    expect(untagged.querySelectorAll('button').length).toBe(1);
    expect(untagged.querySelector('input')).toBeNull();
  });

  test('add, hide and show, recolor, rename and delete go through the host', () => {
    const s = createSession();
    const { p, host, rows, row } = panel(s);
    (p.element.querySelector('.tags-add') as HTMLButtonElement).click();
    p.sync();
    expect(rows()).toEqual(['Untagged', 'Tag 1']);
    const id = [...s.doc.scene.tags.keys()][0]!;

    const eye = row('Tag 1').querySelector('button')!;
    expect(eye.getAttribute('aria-label')).toBe('Hide Tag 1');
    eye.click();
    p.sync();
    expect(host.setVisible).toHaveBeenCalledWith(id, false);
    expect(row('Tag 1').classList.contains('hidden-tag')).toBe(true);
    expect(row('Tag 1').querySelector('button')!.getAttribute('aria-pressed')).toBe('false');

    const swatch = row('Tag 1').querySelector<HTMLInputElement>('input[type=color]')!;
    swatch.value = '#123456';
    swatch.dispatchEvent(new Event('change'));
    expect(s.doc.scene.tags.get(id)!.color).toBe('#123456');

    row('Tag 1').querySelector('.tags-name')!.dispatchEvent(new MouseEvent('dblclick'));
    const input = p.element.querySelector<HTMLInputElement>('.tags-input')!;
    input.value = 'Drawers';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    p.sync();
    expect(host.rename).toHaveBeenCalledWith(id, 'Drawers');
    expect(rows()).toEqual(['Untagged', 'Drawers']);

    const buttons = row('Drawers').querySelectorAll('button');
    buttons[buttons.length - 1]!.click();
    p.sync();
    expect(host.remove).toHaveBeenCalledWith(id);
    expect(rows()).toEqual(['Untagged']);
  });

  test('Escape leaves a name as it was; the Color by Tag box follows the host', () => {
    const s = createSession();
    ok(s.execute('core.addTag', { name: 'Doors' }));
    const { p, host, rows, row } = panel(s);
    row('Doors').querySelector('.tags-name')!.dispatchEvent(new MouseEvent('dblclick'));
    const input = p.element.querySelector<HTMLInputElement>('.tags-input')!;
    input.value = 'Other';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.rename).not.toHaveBeenCalled();
    expect(rows()).toEqual(['Untagged', 'Doors']);
    const box = p.element.querySelector<HTMLInputElement>('.tags-color-by input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(host.setColorByTag).toHaveBeenCalledWith(true);
    p.sync();
    expect(box.checked).toBe(true);
  });
});

describe('the panel tray', () => {
  test('a heading folds its panel and remembers which are folded', () => {
    const onFold = vi.fn();
    const tray = new Tray(new Set(['tags']), onFold);
    const section = (name: string) => {
      const s = document.createElement('section');
      const h = document.createElement('h2');
      h.textContent = name;
      s.append(h, document.createElement('p'));
      return s;
    };
    const info = section('Entity Info');
    const tags = section('Tags');
    tray.add('entityInfo', info);
    tray.add('tags', tags);
    document.body.replaceChildren(tray.element);
    const toggle = (s: HTMLElement) => s.querySelector<HTMLButtonElement>('.panel-toggle')!;
    expect(toggle(info).textContent).toBe('Entity Info');
    expect([toggle(info).getAttribute('aria-expanded'), toggle(tags).getAttribute('aria-expanded')]).toEqual(['true', 'false']);
    expect(tags.classList.contains('folded')).toBe(true);
    toggle(info).click();
    expect(info.classList.contains('folded')).toBe(true);
    expect([...onFold.mock.calls.at(-1)![0]].sort()).toEqual(['entityInfo', 'tags']);
    toggle(tags).click();
    expect([...onFold.mock.calls.at(-1)![0]]).toEqual(['entityInfo']);
  });
});

describe('the Tag field of Entity Info', () => {
  const options = [
    { id: 't2', name: 'Doors' },
    { id: 't3', name: 'Shelves' },
  ];
  const selection = (tag: Extract<EntityInfoData, { kind: 'selection' }>['tag'], looseOnly = false): EntityInfoData => ({
    kind: 'selection',
    total: '2',
    counts: [],
    area: null,
    length: null,
    tag,
    looseOnly,
  });

  test('shows the common tag, or Mixed; picking one sets it on the selection', () => {
    const setTag = vi.fn();
    const info = new EntityInfo({ renameDefinition: vi.fn(), renameInstance: vi.fn(), setTag, setGrain: vi.fn(), setEdgeBand: vi.fn(), previewEdge: vi.fn() });
    document.body.replaceChildren(info.element);
    info.show(selection({ value: 't3', options }));
    const select = info.element.querySelector('select')!;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Untagged', 'Doors', 'Shelves']);
    expect(select.selectedOptions[0]!.textContent).toBe('Shelves');
    select.value = '-';
    select.dispatchEvent(new Event('change'));
    expect(setTag).toHaveBeenLastCalledWith(null);
    info.show(selection({ options }));
    const mixed = info.element.querySelector('select')!;
    expect(mixed.selectedOptions[0]!.textContent).toBe('Mixed');
    mixed.value = 't2';
    mixed.dispatchEvent(new Event('change'));
    expect(setTag).toHaveBeenLastCalledWith('t2');
  });

  test('loose geometry alone gets the hint instead of a Tag field', () => {
    const info = new EntityInfo({ renameDefinition: vi.fn(), renameInstance: vi.fn(), setTag: vi.fn(), setGrain: vi.fn(), setEdgeBand: vi.fn(), previewEdge: vi.fn() });
    info.show(selection(null, true));
    expect(info.element.querySelector('select')).toBeNull();
    expect(info.element.querySelector('.entity-info-hint')!.textContent).toBe('Loose geometry stays Untagged; group it to tag it.');
  });
});

describe('Color by Tag', () => {
  /** A tagged group holding an untagged group, and an untagged group beside it. */
  function scene(): { s: CommandSession; tag: string; outer: string; inner: string; plain: string } {
    const s = createSession();
    const tag = ok(s.execute('core.addTag', { name: 'Red', color: '#cc0000' })).tagId;
    const box = (x: number, definitionId?: string) => {
      const before = new Set(listFaces(definitionModel(s.doc, definitionId)!).map((f) => f.id));
      const r = ok(s.execute('core.drawRectangle', { definitionId, faceId: null, corner: [x, 0, 0], width: 100, depth: 100 }));
      ok(s.execute('core.pushPull', { definitionId, faceId: r.faceIds[0]!, distance: 100 }));
      const faceIds = listFaces(definitionModel(s.doc, definitionId)!)
        .map((f) => f.id)
        .filter((f) => !before.has(f));
      return ok(s.execute('core.makeGroup', { definitionId, faceIds }));
    };
    const outer = box(0);
    const inner = box(300, outer.definitionId);
    const plain = box(1000);
    ok(s.execute('core.setTag', { instanceIds: [outer.instanceId], tagId: tag }));
    return { s, tag, outer: outer.instanceId, inner: inner.instanceId, plain: plain.instanceId };
  }

  test('untagged geometry takes the nearest tagged group around it, as in SketchUp', () => {
    const { s, tag, outer, inner, plain } = scene();
    const sc: Scene = s.doc.scene;
    expect([pathTag(sc, []), pathTag(sc, [outer]), pathTag(sc, [outer, inner]), pathTag(sc, [plain])]).toEqual([undefined, tag, tag, undefined]);
  });

  test('faces of each placement are drawn in their tag color, both sides; Untagged keeps the face color', () => {
    const { s, outer, inner, plain } = scene();
    const view = new InstancesView();
    view.build(s.doc.scene, [], true);
    const colors = (path: string) =>
      view.pickables.filter((m) => m.userData.placement.path.join('/') === path).flatMap((m) => (m.material as MeshLambertMaterial[]).map((x) => x.color.getHex()));
    expect(colors(outer)).toEqual([0xcc0000, 0xcc0000]);
    expect(colors(`${outer}/${inner}`)).toEqual([0xcc0000, 0xcc0000]);
    expect(colors(plain)).toEqual([0xf3f2ee, 0xf3f2ee]);
    view.build(s.doc.scene, [], false);
    expect(colors(outer)).toEqual([0xf3f2ee, 0x8e9fb2]);
  });
});
