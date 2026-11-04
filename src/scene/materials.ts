/**
 * Materials (milestone 5): the model's own list, as SketchUp's "In Model".
 * Faces carry material ids on their front and back (kernel paint); a group
 * or component instance can carry one too, which shows on the faces inside
 * it that have none, as in SketchUp.
 */
import { getFace, type FaceSide, type Model } from '../kernel';
import { newId, type InstanceId, type Scene } from './scene';

export type MaterialId = string;

/** An image tiled across faces: its file (base64) and the real size of one tile in mm. */
export interface Texture {
  readonly data: string;
  readonly mime: 'image/png' | 'image/jpeg';
  readonly width: number;
  readonly height: number;
}

/**
 * What a material is bought as, for the cut list (milestone 5): sheet goods
 * (thickness and sheet size in mm, a price per sheet) or solid wood (a
 * thickness, a price per board foot or per cubic meter, and the length of
 * its boards for the cutting diagrams, milestone 6), or edge band (a
 * thickness and width, and a price per meter, milestone 6), painted on the
 * side faces of parts. Prices are in the file's currency. `grain` says the
 * material has a grain direction.
 */
export type Stock =
  | { readonly kind: 'sheet'; readonly thickness: number; readonly length: number; readonly width: number; readonly price?: number; readonly grain: boolean }
  | { readonly kind: 'solid'; readonly thickness: number; readonly length?: number; readonly price?: number; readonly per: 'boardFoot' | 'cubicMeter'; readonly grain: boolean }
  | { readonly kind: 'band'; readonly thickness: number; readonly width: number; readonly price?: number };

export interface Material {
  readonly name: string;
  /** #rrggbb; with a texture, the color shown where the image cannot be (and in lists). */
  readonly color: string;
  readonly texture?: Texture;
  readonly stock?: Stock;
}

/** A stock read from a file or typed, or null when it is not one: positive sizes, a price of zero or more. */
export function validStock(v: unknown): Stock | null {
  if (typeof v !== 'object' || v === null) return null;
  const x = v as Record<string, unknown>;
  const size = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const price = x.price === undefined || (typeof x.price === 'number' && Number.isFinite(x.price) && x.price >= 0);
  if (!size(x.thickness) || !price) return null;
  const priced = x.price === undefined ? {} : { price: x.price as number };
  if (x.kind === 'band') return size(x.width) ? { kind: 'band', thickness: x.thickness as number, width: x.width as number, ...priced } : null;
  if (typeof x.grain !== 'boolean') return null;
  const base = { thickness: x.thickness as number, grain: x.grain, ...priced };
  if (x.kind === 'sheet' && size(x.length) && size(x.width)) return { kind: 'sheet', ...base, length: x.length as number, width: x.width as number };
  if (x.kind === 'solid' && (x.per === 'boardFoot' || x.per === 'cubicMeter') && (x.length === undefined || size(x.length)))
    return { kind: 'solid', ...base, ...(x.length === undefined ? {} : { length: x.length as number }), per: x.per };
  return null;
}

export const MATERIAL_COLOR = /^#[0-9a-f]{6}$/;

/** Whether a material is edge band, which parts are banded with rather than made of. */
export const isEdgeBand = (s: Scene, id: MaterialId | null | undefined): boolean => !!id && s.materials.get(id)?.stock?.kind === 'band';

/** Add a material; returns its id and the new scene. */
export function addMaterial(s: Scene, material: Material): [MaterialId, Scene] {
  const [id, next] = newId(s, 'm');
  return [id, { ...next, materials: new Map(next.materials).set(id, material) }];
}

/** Replace a material's fields; the same scene when nothing changed or there is no such material. */
export function updateMaterial(s: Scene, id: MaterialId, material: Material): Scene {
  const old = s.materials.get(id);
  if (!old || JSON.stringify(old) === JSON.stringify(material)) return s;
  return { ...s, materials: new Map(s.materials).set(id, material) };
}

/**
 * The material instances along a path pass down to unpainted faces: the
 * nearest painted instance, innermost first. Undefined when none is painted.
 */
export function inheritedMaterial(s: Scene, path: readonly InstanceId[]): MaterialId | undefined {
  let material: MaterialId | undefined;
  let parent = s.rootId;
  for (const id of path) {
    const i = s.definitions.get(parent)?.instances.get(id);
    if (!i) break;
    if (i.material && s.materials.has(i.material)) material = i.material;
    parent = i.definitionId;
  }
  return material;
}

/** The material a face side shows at the end of a path: its own paint, else what its instances pass down. */
export function shownMaterial(s: Scene, path: readonly InstanceId[], model: Model, faceId: string, side: FaceSide): MaterialId | undefined {
  const own = getFace(model, faceId)?.paint?.[side];
  return own && s.materials.has(own) ? own : inheritedMaterial(s, path);
}
