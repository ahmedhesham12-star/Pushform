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

export interface Material {
  readonly name: string;
  /** #rrggbb; with a texture, the color shown where the image cannot be (and in lists). */
  readonly color: string;
  readonly texture?: Texture;
}

export const MATERIAL_COLOR = /^#[0-9a-f]{6}$/;

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
