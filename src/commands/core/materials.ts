import { z } from 'zod';
import { t, type MessageKey } from '../../i18n';
import { paintFaces, replacePaint, snapLength } from '../../kernel';
import { addMaterial as addSceneMaterial, getDefinition, putInstance, setModel, updateMaterial, type Material, type Scene, type Stock } from '../../scene';
import type { PushformDocument } from '../document';
import type { CommandDef, RunResult } from '../types';
import { definitionId } from './schemas';

/**
 * The starter set: built in, copied into a file the first time it is used.
 * Plain colors, no textures; the woods and boards come with common stock
 * (no prices: those depend on the supplier). Painted colors are paint only.
 */
export const STARTER_MATERIALS: Record<string, { readonly color: string; readonly stock?: Stock }> = {
  birchPly: { color: '#e3cfa2', stock: { kind: 'sheet', thickness: 12, length: 1525, width: 1525, grain: true } },
  oak: { color: '#c8a165', stock: { kind: 'solid', thickness: 18, per: 'cubicMeter', grain: true } },
  walnut: { color: '#6b4a33', stock: { kind: 'solid', thickness: 20, per: 'cubicMeter', grain: true } },
  whiteMdf: { color: '#efeee9', stock: { kind: 'sheet', thickness: 18, length: 2440, width: 1220, grain: false } },
  whiteMelamine: { color: '#f7f7f4', stock: { kind: 'sheet', thickness: 18, length: 2440, width: 1220, grain: false } },
  paintedSage: { color: '#9aab8f' },
  paintedNavy: { color: '#2f3e57' },
  paintedCharcoal: { color: '#3b3f42' },
  paintedCream: { color: '#ece3cf' },
};
const STARTERS = ['birchPly', 'oak', 'walnut', 'whiteMdf', 'whiteMelamine', 'paintedSage', 'paintedNavy', 'paintedCharcoal', 'paintedCream'] as const;
export type StarterMaterial = (typeof STARTERS)[number];

/** A starter material as it comes into a file. */
function fromStarter(key: StarterMaterial): Material {
  const s = STARTER_MATERIALS[key]!;
  return { name: starterName(key), color: s.color, ...(s.stock ? { stock: s.stock } : {}) };
}

/** The name a starter material gets in the file, in the current language. */
export const starterName = (key: StarterMaterial) => t(`materials.starter.${key}` as MessageKey);

const materialId = z.string().min(1);
const materialName = z.string().trim().min(1).max(200);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .transform((c) => c.toLowerCase());
/** An image's file as base64, and the size of one tile in mm. */
const texture = z.strictObject({
  data: z.string().min(1),
  mime: z.enum(['image/png', 'image/jpeg']),
  width: z.number().positive(),
  height: z.number().positive(),
});

const noSuchMaterial = (id: string) => ({ ok: false as const, error: { code: 'noSuchMaterial', detail: id } });

/** A document with a new scene; the same document when the scene did not change. */
function done<O>(doc: PushformDocument, scene: Scene, output: O): RunResult<O> {
  return { ok: true, doc: scene === doc.scene ? doc : { ...doc, scene }, output };
}

/** "Material 1", "Material 2", ...: the first such name no material has yet. */
function freshName(s: Scene): string {
  const names = new Set([...s.materials.values()].map((m) => m.name));
  for (let n = 1; ; n++) {
    const name = t('materials.newName', { number: n });
    if (!names.has(name)) return name;
  }
}

export const addMaterialInput = z.strictObject({ starter: z.enum(STARTERS).optional(), name: materialName.optional(), color: color.optional() });
export type AddMaterialInput = z.infer<typeof addMaterialInput>;

/** Add a material: a copy of a starter one, or a new one (picked name, gray unless a color is given). */
export const addMaterial: CommandDef<AddMaterialInput, { materialId: string }> = {
  id: 'core.addMaterial',
  title: () => t('command.addMaterial'),
  input: addMaterialInput,
  run(doc, input) {
    const base: Material = input.starter ? fromStarter(input.starter) : { name: freshName(doc.scene), color: '#b4b4b0' };
    const material: Material = { ...base, ...(input.name ? { name: input.name } : {}), ...(input.color ? { color: input.color } : {}) };
    const [id, scene] = addSceneMaterial(doc.scene, material);
    return done(doc, scene, { materialId: id });
  },
};

function update(doc: PushformDocument, id: string, patch: (m: Material) => Material): RunResult<Record<string, never>> {
  const m = doc.scene.materials.get(id);
  if (!m) return noSuchMaterial(id);
  return done(doc, updateMaterial(doc.scene, id, patch(m)), {});
}

export const renameMaterialInput = z.strictObject({ materialId, name: materialName });
export type RenameMaterialInput = z.infer<typeof renameMaterialInput>;

export const renameMaterial: CommandDef<RenameMaterialInput, Record<string, never>> = {
  id: 'core.renameMaterial',
  title: () => t('command.renameMaterial'),
  input: renameMaterialInput,
  run: (doc, input) => update(doc, input.materialId, (m) => ({ ...m, name: input.name })),
};

export const setMaterialColorInput = z.strictObject({ materialId, color });
export type SetMaterialColorInput = z.infer<typeof setMaterialColorInput>;

export const setMaterialColor: CommandDef<SetMaterialColorInput, Record<string, never>> = {
  id: 'core.setMaterialColor',
  title: () => t('command.setMaterialColor'),
  input: setMaterialColorInput,
  run: (doc, input) => update(doc, input.materialId, (m) => ({ ...m, color: input.color })),
};

export const setMaterialTextureInput = z.strictObject({ materialId, texture: texture.nullable() });
export type SetMaterialTextureInput = z.infer<typeof setMaterialTextureInput>;

/** Give a material an image tiled across faces (its size in mm), or take it away with null. */
export const setMaterialTexture: CommandDef<SetMaterialTextureInput, Record<string, never>> = {
  id: 'core.setMaterialTexture',
  title: () => t('command.setMaterialTexture'),
  input: setMaterialTextureInput,
  run: (doc, input) =>
    update(doc, input.materialId, (m) => {
      const { texture: _old, ...rest } = m;
      return input.texture ? { ...rest, texture: input.texture } : rest;
    }),
};

/** A size in mm, rounded to the model's precision as lengths are (3/4" is 19.05). */
const size = z.number().positive().transform(snapLength);
const price = z.number().nonnegative().optional();
const stock = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sheet'), thickness: size, length: size, width: size, price, grain: z.boolean() }),
  z.strictObject({ kind: z.literal('solid'), thickness: size, price, per: z.enum(['boardFoot', 'cubicMeter']), grain: z.boolean() }),
]);

export const setMaterialStockInput = z.strictObject({ materialId, stock: stock.nullable() });
export type SetMaterialStockInput = z.infer<typeof setMaterialStockInput>;

/** Say what a material is bought as (sheet goods or solid wood, with a thickness, sizes and a price), or null for paint only. */
export const setMaterialStock: CommandDef<SetMaterialStockInput, Record<string, never>> = {
  id: 'core.setMaterialStock',
  title: () => t('command.setMaterialStock'),
  input: setMaterialStockInput,
  run: (doc, input) =>
    update(doc, input.materialId, (m) => {
      const { stock: _old, ...rest } = m;
      return input.stock ? { ...rest, stock: input.stock as Stock } : rest;
    }),
};

export const duplicateMaterialInput = z.strictObject({ materialId });
export type DuplicateMaterialInput = z.infer<typeof duplicateMaterialInput>;

/** A copy of a material, named "... copy". */
export const duplicateMaterial: CommandDef<DuplicateMaterialInput, { materialId: string }> = {
  id: 'core.duplicateMaterial',
  title: () => t('command.duplicateMaterial'),
  input: duplicateMaterialInput,
  run(doc, input) {
    const m = doc.scene.materials.get(input.materialId);
    if (!m) return noSuchMaterial(input.materialId);
    const [id, scene] = addSceneMaterial(doc.scene, { ...m, name: t('materials.copyName', { name: m.name }) });
    return done(doc, scene, { materialId: id });
  },
};

export const deleteMaterialInput = z.strictObject({ materialId });
export type DeleteMaterialInput = z.infer<typeof deleteMaterialInput>;

/** Delete a material; every face and instance painted with it goes back to the default. */
export const deleteMaterial: CommandDef<DeleteMaterialInput, Record<string, never>> = {
  id: 'core.deleteMaterial',
  title: () => t('command.deleteMaterial'),
  input: deleteMaterialInput,
  run(doc, input) {
    const id = input.materialId;
    if (!doc.scene.materials.has(id)) return noSuchMaterial(id);
    const materials = new Map(doc.scene.materials);
    materials.delete(id);
    let scene: Scene = { ...doc.scene, materials };
    for (const d of doc.scene.definitions.values()) {
      scene = setModel(scene, d.id, replacePaint(d.model, id, null));
      for (const i of d.instances.values()) {
        if (i.material !== id) continue;
        const { material: _old, ...rest } = i;
        scene = putInstance(scene, d.id, rest);
      }
    }
    return done(doc, scene, {});
  },
};

const ids = z.array(z.string().min(1)).optional();
export const paintInput = z.strictObject({
  definitionId,
  faceIds: ids,
  /** Which sides of the faces; the front when omitted. */
  sides: z.array(z.enum(['front', 'back'])).min(1).optional(),
  instanceIds: ids,
  /** The material, or null for the default (no paint). */
  materialId: materialId.nullable().optional(),
  /** A starter material instead, copied into the file first, so painting with it is one step. */
  starter: z.enum(STARTERS).optional(),
}).refine((x) => (x.materialId === undefined) !== (x.starter === undefined), 'give a material or a starter');
export type PaintInput = z.infer<typeof paintInput>;

/**
 * Paint faces of one definition (the open editing context) on a side, and
 * groups and components placed in it: their material shows on the faces
 * inside them that have none. Null removes the paint.
 */
export const paint: CommandDef<PaintInput, { materialId: string | null }> = {
  id: 'core.paint',
  title: () => t('command.paint'),
  input: paintInput,
  run(doc, input) {
    const defId = input.definitionId ?? doc.scene.rootId;
    const def = getDefinition(doc.scene, defId);
    if (!def) return { ok: false, error: { code: 'noSuchDefinition', detail: defId } };
    if (!input.faceIds?.length && !input.instanceIds?.length) return { ok: false, error: { code: 'nothingSelected' } };
    let scene = doc.scene;
    let id = input.materialId ?? null;
    if (input.starter) [id, scene] = addSceneMaterial(scene, fromStarter(input.starter));
    else if (id !== null && !scene.materials.has(id)) return noSuchMaterial(id);
    scene = setModel(scene, defId, paintFaces(def.model, input.faceIds ?? [], input.sides ?? ['front'], id));
    for (const instanceId of input.instanceIds ?? []) {
      const i = def.instances.get(instanceId);
      if (!i || (i.material ?? null) === id) continue;
      const { material: _old, ...rest } = i;
      scene = putInstance(scene, defId, id ? { ...rest, material: id } : rest);
    }
    return done(doc, scene, { materialId: id });
  },
};
