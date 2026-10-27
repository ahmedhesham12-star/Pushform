import { z } from 'zod';
import { t } from '../../i18n';
import { addAnnotation, attachAnchor, getDefinition, setAnnotationText } from '../../scene';
import type { CommandDef } from '../types';
import { definitionId, point3 } from './schemas';

/** Ends closer than this (mm) make no dimension. */
const MIN_LENGTH = 0.01;

export const addDimensionInput = z.strictObject({
  definitionId,
  /** The ends measured between, in the context's coordinates. Each attaches to the vertex or edge there. */
  start: point3,
  end: point3,
  /** From the measured points to the dimension line. */
  offset: z.tuple([z.number(), z.number(), z.number()]),
});
export type AddDimensionInput = z.infer<typeof addDimensionInput>;
export interface AnnotationOutput {
  annotationId: string;
}

/**
 * An aligned dimension between two points of the editing context. Ends on a
 * vertex or an edge (of the context or a group or component in it) follow
 * that geometry from then on.
 */
export const addDimension: CommandDef<AddDimensionInput, AnnotationOutput> = {
  id: 'core.addDimension',
  title: () => t('command.addDimension'),
  input: addDimensionInput,
  run(doc, input) {
    const contextId = input.definitionId ?? doc.scene.rootId;
    if (!getDefinition(doc.scene, contextId)) return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId ?? '' } };
    const [s, e] = [input.start, input.end];
    if (Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]) < MIN_LENGTH) return { ok: false, error: { code: 'tooSmall' } };
    const [annotationId, scene] = addAnnotation(doc.scene, contextId, {
      kind: 'dimension',
      start: attachAnchor(doc.scene, contextId, s),
      end: attachAnchor(doc.scene, contextId, e),
      offset: input.offset,
    });
    return { ok: true, doc: { ...doc, scene }, output: { annotationId } };
  },
};

/** What a text holds: any non-empty text, line breaks included. */
const text = z.string().min(1).max(10_000);

export const addTextInput = z.strictObject({
  definitionId,
  /** The point the leader points at, in the context's coordinates; it attaches to the vertex or edge there. */
  point: point3,
  /** From that point to the text. */
  leader: z.tuple([z.number(), z.number(), z.number()]),
  text,
});
export type AddTextInput = z.infer<typeof addTextInput>;

/** Text with a leader line to a point of the editing context, following it when it is on a vertex or an edge. */
export const addText: CommandDef<AddTextInput, AnnotationOutput> = {
  id: 'core.addText',
  title: () => t('command.addText'),
  input: addTextInput,
  run(doc, input) {
    const contextId = input.definitionId ?? doc.scene.rootId;
    if (!getDefinition(doc.scene, contextId)) return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId ?? '' } };
    const anchor = attachAnchor(doc.scene, contextId, input.point);
    const [annotationId, scene] = addAnnotation(doc.scene, contextId, { kind: 'text', anchor, leader: input.leader, text: input.text });
    return { ok: true, doc: { ...doc, scene }, output: { annotationId } };
  },
};

const fraction = z.number().min(0).max(1);
export const addScreenTextInput = z.strictObject({
  definitionId,
  /** Where the text's top left corner is, as fractions of the view's width and height. */
  position: z.tuple([fraction, fraction]),
  text,
});
export type AddScreenTextInput = z.infer<typeof addScreenTextInput>;

/** Text fixed on the screen, held by the editing context's definition. */
export const addScreenText: CommandDef<AddScreenTextInput, AnnotationOutput> = {
  id: 'core.addScreenText',
  title: () => t('command.addText'),
  input: addScreenTextInput,
  run(doc, input) {
    const contextId = input.definitionId ?? doc.scene.rootId;
    if (!getDefinition(doc.scene, contextId)) return { ok: false, error: { code: 'noSuchDefinition', detail: input.definitionId ?? '' } };
    const [annotationId, scene] = addAnnotation(doc.scene, contextId, { kind: 'screenText', position: input.position, text: input.text });
    return { ok: true, doc: { ...doc, scene }, output: { annotationId } };
  },
};

export const editTextInput = z.strictObject({ definitionId, annotationId: z.string().min(1), text });
export type EditTextInput = z.infer<typeof editTextInput>;

/** Change what a leader or screen text says. The same document when the text is unchanged. */
export const editText: CommandDef<EditTextInput, Record<string, never>> = {
  id: 'core.editText',
  title: () => t('command.editText'),
  input: editTextInput,
  run(doc, input) {
    const contextId = input.definitionId ?? doc.scene.rootId;
    const a = getDefinition(doc.scene, contextId)?.annotations.get(input.annotationId);
    if (!a || a.kind === 'dimension') return { ok: false, error: { code: 'noSuchText', detail: input.annotationId } };
    const scene = setAnnotationText(doc.scene, contextId, input.annotationId, input.text);
    return { ok: true, doc: scene === doc.scene ? doc : { ...doc, scene }, output: {} };
  },
};
