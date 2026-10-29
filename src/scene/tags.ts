/**
 * Tags (milestone 5), SketchUp's layers: named, colored and shown or hidden
 * for the whole model. Groups, components, guides and annotations carry an
 * optional tag; loose geometry stays Untagged, which is no tag at all and is
 * always shown. A hidden tag hides what carries it and, for an instance,
 * everything inside it.
 */
import type { AnnotationId } from './annotations';
import type { GuideId } from './guides';
import { newId, type DefinitionId, type InstanceId, type Scene } from './scene';

export type TagId = string;

export interface Tag {
  readonly name: string;
  /** #rrggbb, for Color by Tag. */
  readonly color: string;
  readonly visible: boolean;
}

/** Colors new tags take in turn: plain and distinct from one another and from the faces. */
export const TAG_COLORS = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f79646', '#4bacc6', '#b5a33a', '#7f6a5a'] as const;

/** Whether something with this tag is shown: Untagged always is. */
export const tagShown = (s: Scene, tag: TagId | undefined): boolean => !tag || s.tags.get(tag)?.visible !== false;

/** Add a tag; returns its id and the new scene. */
export function addTag(s: Scene, tag: Tag): [TagId, Scene] {
  const [id, next] = newId(s, 't');
  return [id, { ...next, tags: new Map(next.tags).set(id, tag) }];
}

/** Change a tag's name, color or visibility; the same scene when nothing changed or there is no such tag. */
export function updateTag(s: Scene, id: TagId, patch: Partial<Tag>): Scene {
  const tag = s.tags.get(id);
  if (!tag || (Object.keys(patch) as (keyof Tag)[]).every((k) => patch[k] === undefined || patch[k] === tag[k])) return s;
  return { ...s, tags: new Map(s.tags).set(id, { ...tag, ...patch }) };
}

/** The things in one definition to tag. */
export interface TagTargets {
  readonly instanceIds?: readonly InstanceId[];
  readonly guideIds?: readonly GuideId[];
  readonly annotationIds?: readonly AnnotationId[];
}

/** Put things of a definition on a tag (or on Untagged, with null); the same scene when nothing changed. */
export function setTags(s: Scene, definitionId: DefinitionId, targets: TagTargets, tag: TagId | null): Scene {
  const d = s.definitions.get(definitionId);
  if (!d) return s;
  const retag = <T extends { readonly tag?: TagId }>(items: ReadonlyMap<string, T>, ids: readonly string[] = []): ReadonlyMap<string, T> => {
    let out: Map<string, T> | null = null;
    for (const id of ids) {
      const item = items.get(id);
      if (!item || (item.tag ?? null) === tag) continue;
      out ??= new Map(items);
      out.set(id, withTag(item, tag));
    }
    return out ?? items;
  };
  const instances = retag(d.instances, targets.instanceIds);
  const guides = retag(d.guides, targets.guideIds);
  const annotations = retag(d.annotations, targets.annotationIds);
  if (instances === d.instances && guides === d.guides && annotations === d.annotations) return s;
  return { ...s, definitions: new Map(s.definitions).set(d.id, { ...d, instances, guides, annotations }) };
}

/** Delete a tag; everything on it moves to Untagged. */
export function deleteTag(s: Scene, id: TagId): Scene {
  if (!s.tags.has(id)) return s;
  const tags = new Map(s.tags);
  tags.delete(id);
  let next: Scene = { ...s, tags };
  for (const d of s.definitions.values()) {
    const on = <T extends { readonly tag?: TagId }>(items: ReadonlyMap<string, T>) => [...items].filter(([, x]) => x.tag === id).map(([k]) => k);
    next = setTags(next, d.id, { instanceIds: on(d.instances), guideIds: on(d.guides), annotationIds: on(d.annotations) }, null);
  }
  return next;
}

/** An item with its tag set, or cleared (Untagged) by null. */
export function withTag<T extends { readonly tag?: TagId }>(item: T, tag: TagId | null | undefined): T {
  const { tag: _old, ...rest } = item;
  return (tag ? { ...rest, tag } : rest) as T;
}
