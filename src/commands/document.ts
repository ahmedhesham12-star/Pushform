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
  /** Cut list settings (milestone 5); the defaults when absent. */
  readonly cutList?: CutListSettings;
}

/** Settings the cut list keeps in the file. */
export interface CutListSettings {
  /** Waste added to sheet area and board volume, as a fraction (0.15 is 15%). */
  readonly waste: number;
  /** An ISO 4217 code (EUR, USD) for prices, or null for plain numbers. */
  readonly currency: string | null;
  /** List parts a hidden tag hides too. */
  readonly includeHidden: boolean;
}

export const DEFAULT_CUT_LIST: CutListSettings = { waste: 0.15, currency: null, includeHidden: false };

export const cutListSettings = (doc: PushformDocument): CutListSettings => doc.cutList ?? DEFAULT_CUT_LIST;

/** Settings read from a file, or null when they are not valid. */
function readCutList(v: unknown): CutListSettings | null {
  if (typeof v !== 'object' || v === null) return null;
  const x = v as Record<string, unknown>;
  if (typeof x.waste !== 'number' || !(x.waste >= 0 && x.waste < 10)) return null;
  if (x.currency !== null && (typeof x.currency !== 'string' || !/^[A-Z]{3}$/.test(x.currency))) return null;
  if (typeof x.includeHidden !== 'boolean') return null;
  return { waste: x.waste, currency: x.currency, includeHidden: x.includeHidden };
}

/**
 * Version 5 (milestone 5) holds a scene of definitions and instances, with
 * guides, dimensions and text, and tags. Version 4 (milestone 4) is the same
 * without tags, and version 3 (milestone 3) without guides. Version 2
 * (milestone 2) held one topology model and version 1 (milestone 1) a
 * face-loop model; both are converted when loaded, becoming the root
 * definition.
 */
export interface SerializedDocument {
  format: 'pushform';
  version: 5;
  units: UnitSettings;
  scene: SerializedScene;
  cutList?: CutListSettings;
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
  return { format: 'pushform', version: 5, units: { ...doc.units }, scene: serializeScene(doc.scene), ...(doc.cutList ? { cutList: { ...doc.cutList } } : {}) };
}

/** Validate and load a saved document (version 1 to 5). Returns null when the data is not a valid document. */
export function deserializeDocument(data: unknown): PushformDocument | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as { format?: unknown; version?: unknown; model?: unknown; scene?: unknown; units?: Partial<UnitSettings>; cutList?: unknown };
  if (d.format !== 'pushform' || ![1, 2, 3, 4, 5].includes(d.version as number)) return null;
  let scene: Scene | null;
  if (d.version === 3 || d.version === 4 || d.version === 5) {
    scene = deserializeScene(d.scene);
  } else {
    const model = deserialize(d.model);
    scene = model && sceneFromModel(model);
  }
  const u = d.units;
  if (!scene || !u || !LENGTH_UNITS.includes(u.unit as LengthUnit)) return null;
  const units = { unit: u.unit, precision: u.precision } as UnitSettings;
  if (!isValidSettings(units)) return null;
  if (d.cutList === undefined) return { scene, units };
  const cutList = readCutList(d.cutList);
  return cutList && { scene, units, cutList };
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
