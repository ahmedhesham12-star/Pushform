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
import { isValidSettings, LENGTH_UNITS, type LengthUnit, type UnitSettings } from '../units';
import { WORKSPACES, workspaceUnits, type Workspace } from './workspaces';

/** Everything saved in a Pushform file. Immutable; commands return new documents. */
export interface PushformDocument {
  /** Definitions (each with its own geometry) and the instances placed in them. */
  readonly scene: Scene;
  /** Per-file display units and precision. */
  readonly units: UnitSettings;
  /** What the file is for (milestone 6): which materials, panels and tools are offered. */
  readonly workspace: Workspace;
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
  /** Cutting diagrams (milestone 6): saw kerf and the trim off each sheet edge and board end, in mm. */
  readonly kerf: number;
  readonly trim: number;
  /** Only layouts a panel saw can cut. */
  readonly guillotine: boolean;
  /** Which way the first full cuts run, or whichever gives the better layout. */
  readonly firstCut: 'length' | 'width' | 'best';
  /** Leftovers with a short side at least this long (mm) are listed as offcuts. */
  readonly minOffcut: number;
  /** Show each part's cut size, before edge banding, and lay parts out at it. */
  readonly cutSize: boolean;
}

export const DEFAULT_CUT_LIST: CutListSettings = { waste: 0.15, currency: null, includeHidden: false, kerf: 3, trim: 10, guillotine: true, firstCut: 'best', minOffcut: 100, cutSize: false };
const FIRST_CUTS = ['length', 'width', 'best'] as const;

export const cutListSettings = (doc: PushformDocument): CutListSettings => doc.cutList ?? DEFAULT_CUT_LIST;

/** Settings read from a file, or null when they are not valid. */
function readCutList(v: unknown): CutListSettings | null {
  if (typeof v !== 'object' || v === null) return null;
  const x = v as Record<string, unknown>;
  if (typeof x.waste !== 'number' || !(x.waste >= 0 && x.waste < 10)) return null;
  if (x.currency !== null && (typeof x.currency !== 'string' || !/^[A-Z]{3}$/.test(x.currency))) return null;
  if (typeof x.includeHidden !== 'boolean') return null;
  // The diagram and cut size settings came in milestone 6; files without them take the defaults.
  const d = DEFAULT_CUT_LIST;
  const kerf = x.kerf ?? d.kerf;
  const trim = x.trim ?? d.trim;
  const minOffcut = x.minOffcut ?? d.minOffcut;
  const guillotine = x.guillotine ?? d.guillotine;
  const firstCut = x.firstCut ?? d.firstCut;
  const cutSize = x.cutSize ?? d.cutSize;
  const mm = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1000;
  if (!mm(kerf) || !mm(trim) || !mm(minOffcut) || typeof guillotine !== 'boolean' || !FIRST_CUTS.includes(firstCut as CutListSettings['firstCut'])) return null;
  if (typeof cutSize !== 'boolean') return null;
  return { waste: x.waste, currency: x.currency, includeHidden: x.includeHidden, kerf, trim, guillotine, firstCut: firstCut as CutListSettings['firstCut'], minOffcut, cutSize };
}

/**
 * Version 6 (milestone 6) adds the workspace. Version 5 (milestone 5) holds a
 * scene of definitions and instances, with guides, dimensions and text, and
 * tags. Version 4 (milestone 4) is the same without tags, and version 3
 * (milestone 3) without guides. Version 2 (milestone 2) held one topology
 * model and version 1 (milestone 1) a face-loop model; both are converted
 * when loaded, becoming the root definition.
 */
export interface SerializedDocument {
  format: 'pushform';
  version: 6;
  units: UnitSettings;
  workspace: Workspace;
  scene: SerializedScene;
  cutList?: CutListSettings;
}

/** An empty document for a workspace, in its units (`region`, such as US, picks feet and inches for architecture). */
export function newDocument(workspace: Workspace = 'general', region: string | null = null): PushformDocument {
  return { scene: createScene(createModel()), units: workspaceUnits(workspace, region), workspace };
}

/** Files from before workspaces: Woodworking when they hold woodworking data (stock or cut list settings), else General. */
function guessWorkspace(scene: Scene, cutList: CutListSettings | undefined): Workspace {
  return cutList || [...scene.materials.values()].some((m) => m.stock) ? 'woodworking' : 'general';
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
  return {
    format: 'pushform',
    version: 6,
    units: { ...doc.units },
    workspace: doc.workspace,
    scene: serializeScene(doc.scene),
    ...(doc.cutList ? { cutList: { ...doc.cutList } } : {}),
  };
}

/** Validate and load a saved document (version 1 to 6). Returns null when the data is not a valid document. */
export function deserializeDocument(data: unknown): PushformDocument | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as { format?: unknown; version?: unknown; model?: unknown; scene?: unknown; units?: Partial<UnitSettings>; workspace?: unknown; cutList?: unknown };
  if (d.format !== 'pushform' || ![1, 2, 3, 4, 5, 6].includes(d.version as number)) return null;
  let scene: Scene | null;
  if ((d.version as number) >= 3) {
    scene = deserializeScene(d.scene);
  } else {
    const model = deserialize(d.model);
    scene = model && sceneFromModel(model);
  }
  const u = d.units;
  if (!scene || !u || !LENGTH_UNITS.includes(u.unit as LengthUnit)) return null;
  const units = { unit: u.unit, precision: u.precision } as UnitSettings;
  if (!isValidSettings(units)) return null;
  let cutList: CutListSettings | undefined;
  if (d.cutList !== undefined) {
    const read = readCutList(d.cutList);
    if (!read) return null;
    cutList = read;
  }
  if (d.version === 6 && !WORKSPACES.includes(d.workspace as Workspace)) return null;
  const workspace = d.version === 6 ? (d.workspace as Workspace) : guessWorkspace(scene, cutList);
  return { scene, units, workspace, ...(cutList ? { cutList } : {}) };
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
