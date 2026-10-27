import { createModel, deserialize, type Model } from '../kernel';
import {
  createScene,
  deserializeScene,
  followAnchors,
  getDefinition,
  rootDefinition,
  sceneFromModel,
  serializeScene,
  setModel,
  type DefinitionId,
  type Scene,
  type SerializedScene,
} from '../scene';
import { DEFAULT_UNIT_SETTINGS, isValidSettings, LENGTH_UNITS, type LengthUnit, type UnitSettings } from '../units';

/** Everything saved in a Pushform file. Immutable; commands return new documents. */
export interface PushformDocument {
  /** Definitions (each with its own geometry) and the instances placed in them. */
  readonly scene: Scene;
  /** Per-file display units and precision. */
  readonly units: UnitSettings;
}

/**
 * Version 4 (milestone 4) holds a scene of definitions and instances, with
 * guides and dimensions. Version 3 (milestone 3) is the same without guides. Version 2
 * (milestone 2) held one topology model and version 1 (milestone 1) a
 * face-loop model; both are converted when loaded, becoming the root
 * definition.
 */
export interface SerializedDocument {
  format: 'pushform';
  version: 4;
  units: UnitSettings;
  scene: SerializedScene;
}

export function newDocument(): PushformDocument {
  return { scene: createScene(createModel()), units: { ...DEFAULT_UNIT_SETTINGS } };
}

/** The root definition's geometry: the model outside any group or component. */
export function rootModel(doc: PushformDocument): Model {
  return rootDefinition(doc.scene).model;
}

/** The geometry of a definition (the root when id is omitted), or undefined when it does not exist. */
export function definitionModel(doc: PushformDocument, id?: DefinitionId): Model | undefined {
  return getDefinition(doc.scene, id ?? doc.scene.rootId)?.model;
}

/** The document with a definition's geometry replaced; the same document when nothing changed. */
export function withDefinitionModel(doc: PushformDocument, id: DefinitionId | undefined, model: Model): PushformDocument {
  const scene = setModel(doc.scene, id ?? doc.scene.rootId, model);
  return scene === doc.scene ? doc : { ...doc, scene };
}

/** The document with every dimension following its geometry; the same document when none moved. */
export function followDocument(doc: PushformDocument): PushformDocument {
  const scene = followAnchors(doc.scene);
  return scene === doc.scene ? doc : { ...doc, scene };
}

export function serializeDocument(doc: PushformDocument): SerializedDocument {
  return { format: 'pushform', version: 4, units: { ...doc.units }, scene: serializeScene(doc.scene) };
}

/** Validate and load a saved document (version 1 to 4). Returns null when the data is not a valid document. */
export function deserializeDocument(data: unknown): PushformDocument | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as { format?: unknown; version?: unknown; model?: unknown; scene?: unknown; units?: Partial<UnitSettings> };
  if (d.format !== 'pushform' || ![1, 2, 3, 4].includes(d.version as number)) return null;
  let scene: Scene | null;
  if (d.version === 3 || d.version === 4) {
    scene = deserializeScene(d.scene);
  } else {
    const model = deserialize(d.model);
    scene = model && sceneFromModel(model);
  }
  const u = d.units;
  if (!scene || !u || !LENGTH_UNITS.includes(u.unit as LengthUnit)) return null;
  const units = { unit: u.unit, precision: u.precision } as UnitSettings;
  if (!isValidSettings(units)) return null;
  return { scene, units };
}

/** The contents of a .pushform file: the serialized document as JSON. */
export function documentToText(doc: PushformDocument): string {
  return JSON.stringify(serializeDocument(doc));
}

/** A document read from a .pushform file, or null when the text is not one this version can open. */
export function documentFromText(text: string): PushformDocument | null {
  try {
    return deserializeDocument(JSON.parse(text));
  } catch {
    return null;
  }
}
