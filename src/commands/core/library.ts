import { z } from 'zod';
import { t } from '../../i18n';
import { newId, putInstance, snapTransform } from '../../scene';
import { mergeItem, readItem } from '../library';
import type { CommandDef } from '../types';
import { definitionId, point3, targetModel } from './schemas';

export const insertItemInput = z.strictObject({
  /** The editing context to place it in (the root when omitted). */
  definitionId,
  /** The item, as the library keeps it (see `libraryItem`). */
  item: z.string().min(1),
  /** Where its origin goes, in the context's coordinates (mm). */
  position: point3,
});
export type InsertItemInput = z.infer<typeof insertItemInput>;
export interface InsertItemOutput {
  definitionId: string;
  instanceId: string;
}

/** The last item read, by its text: placing previews the insert on every pointer move. */
let lastRead: { text: string; item: ReturnType<typeof readItem> } | null = null;
function read(text: string): ReturnType<typeof readItem> {
  if (lastRead?.text !== text) lastRead = { text, item: readItem(text) };
  return lastRead.item;
}

/**
 * Insert a library item (milestone 6): another copy of its definitions, one
 * instance placed unturned with its origin at `position`, painted as it
 * was when saved. Refused (`invalidItem`) when the text is not an item.
 */
export const insertItem: CommandDef<InsertItemInput, InsertItemOutput> = {
  id: 'core.insertItem',
  title: () => t('command.insertItem'),
  input: insertItemInput,
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    const item = read(input.item);
    if (!item) return { ok: false, error: { code: 'invalidItem', detail: '' } };
    let [defId, scene, materials] = mergeItem(doc.scene, item.doc.scene, item.definitionId);
    const material = item.material && materials.get(item.material);
    let instanceId: string;
    [instanceId, scene] = newId(scene, 'i');
    const transform = snapTransform({ rotation: [0, 0, 0, 1], translation: input.position, scale: [1, 1, 1] });
    scene = putInstance(scene, input.definitionId ?? doc.scene.rootId, { id: instanceId, definitionId: defId, name: '', transform, ...(material ? { material } : {}) });
    return { ok: true, doc: { ...doc, scene }, output: { definitionId: defId, instanceId } };
  },
};
