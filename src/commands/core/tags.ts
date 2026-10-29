import { z } from 'zod';
import { t } from '../../i18n';
import { addTag as addSceneTag, deleteTag as deleteSceneTag, getDefinition, setTags, TAG_COLORS, updateTag, type Scene, type Tag } from '../../scene';
import type { PushformDocument } from '../document';
import type { CommandDef, RunResult } from '../types';
import { definitionId } from './schemas';

const tagId = z.string().min(1);
const tagName = z.string().trim().min(1).max(200);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((c) => c.toLowerCase());

const noSuchTag = (id: string) => ({ ok: false as const, error: { code: 'noSuchTag', detail: id } });

/** A document with a new scene; the same document when the scene did not change. */
function done<O>(doc: PushformDocument, scene: Scene, output: O): RunResult<O> {
  return { ok: true, doc: scene === doc.scene ? doc : { ...doc, scene }, output };
}

/** "Tag 1", "Tag 2", ...: the first such name no tag has yet. */
function freshName(s: Scene): string {
  const names = new Set([...s.tags.values()].map((x) => x.name));
  for (let n = 1; ; n++) {
    const name = t('tags.newName', { number: n });
    if (!names.has(name)) return name;
  }
}

export const addTagInput = z.strictObject({ name: tagName.optional(), color: color.optional() });
export type AddTagInput = z.infer<typeof addTagInput>;

/** A new tag, shown; the name and color are picked when not given. */
export const addTag: CommandDef<AddTagInput, { tagId: string }> = {
  id: 'core.addTag',
  title: () => t('command.addTag'),
  input: addTagInput,
  run(doc, input) {
    const tag: Tag = { name: input.name ?? freshName(doc.scene), color: input.color ?? TAG_COLORS[doc.scene.tags.size % TAG_COLORS.length]!, visible: true };
    const [id, scene] = addSceneTag(doc.scene, tag);
    return done(doc, scene, { tagId: id });
  },
};

function update(doc: PushformDocument, id: string, patch: Partial<Tag>): RunResult<Record<string, never>> {
  if (!doc.scene.tags.has(id)) return noSuchTag(id);
  return done(doc, updateTag(doc.scene, id, patch), {});
}

export const renameTagInput = z.strictObject({ tagId, name: tagName });
export type RenameTagInput = z.infer<typeof renameTagInput>;

export const renameTag: CommandDef<RenameTagInput, Record<string, never>> = {
  id: 'core.renameTag',
  title: () => t('command.renameTag'),
  input: renameTagInput,
  run: (doc, input) => update(doc, input.tagId, { name: input.name }),
};

export const setTagColorInput = z.strictObject({ tagId, color });
export type SetTagColorInput = z.infer<typeof setTagColorInput>;

export const setTagColor: CommandDef<SetTagColorInput, Record<string, never>> = {
  id: 'core.setTagColor',
  title: () => t('command.setTagColor'),
  input: setTagColorInput,
  run: (doc, input) => update(doc, input.tagId, { color: input.color }),
};

export const setTagVisibleInput = z.strictObject({ tagId, visible: z.boolean() });
export type SetTagVisibleInput = z.infer<typeof setTagVisibleInput>;

/** Show or hide a tag. Saved in the file and undoable, like any other change. */
export const setTagVisible: CommandDef<SetTagVisibleInput, Record<string, never>> = {
  id: 'core.setTagVisible',
  title: () => t('command.setTagVisible'),
  input: setTagVisibleInput,
  run: (doc, input) => update(doc, input.tagId, { visible: input.visible }),
};

export const deleteTagInput = z.strictObject({ tagId });
export type DeleteTagInput = z.infer<typeof deleteTagInput>;

/** Delete a tag; everything on it moves to Untagged. */
export const deleteTag: CommandDef<DeleteTagInput, Record<string, never>> = {
  id: 'core.deleteTag',
  title: () => t('command.deleteTag'),
  input: deleteTagInput,
  run(doc, input) {
    if (!doc.scene.tags.has(input.tagId)) return noSuchTag(input.tagId);
    return done(doc, deleteSceneTag(doc.scene, input.tagId), {});
  },
};

const ids = z.array(z.string().min(1)).optional();
export const setTagInput = z.strictObject({
  definitionId,
  instanceIds: ids,
  guideIds: ids,
  annotationIds: ids,
  /** Loose geometry stays Untagged: faces and edges are counted, never tagged. */
  faceIds: ids,
  edgeIds: ids,
  /** The tag, or null for Untagged. */
  tagId: tagId.nullable(),
});
export type SetTagInput = z.infer<typeof setTagInput>;

export interface SetTagOutput {
  /** Faces and edges left Untagged, so the app can say why. */
  looseSkipped: number;
}

/**
 * Put groups, components, guides and annotations of one definition (the
 * open editing context) on a tag, or on Untagged. Loose geometry stays
 * Untagged, as SketchUp recommends: given only faces and edges, the command
 * is refused with `looseGeometryUntagged`.
 */
export const setTag: CommandDef<SetTagInput, SetTagOutput> = {
  id: 'core.setTag',
  title: () => t('command.setTag'),
  input: setTagInput,
  run(doc, input) {
    const id = input.definitionId ?? doc.scene.rootId;
    if (!getDefinition(doc.scene, id)) return { ok: false, error: { code: 'noSuchDefinition', detail: id } };
    if (input.tagId !== null && !doc.scene.tags.has(input.tagId)) return noSuchTag(input.tagId);
    const looseSkipped = (input.faceIds?.length ?? 0) + (input.edgeIds?.length ?? 0);
    const taggable = (input.instanceIds?.length ?? 0) + (input.guideIds?.length ?? 0) + (input.annotationIds?.length ?? 0);
    if (!taggable) return { ok: false, error: { code: looseSkipped ? 'looseGeometryUntagged' : 'nothingSelected' } };
    const scene = setTags(doc.scene, id, { instanceIds: input.instanceIds ?? [], guideIds: input.guideIds ?? [], annotationIds: input.annotationIds ?? [] }, input.tagId);
    return done(doc, scene, { looseSkipped });
  },
};
