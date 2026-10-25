import { createModel, deserialize, serialize, type Model, type SerializedTopology } from '../kernel';
import { DEFAULT_UNIT_SETTINGS, isValidSettings, LENGTH_UNITS, type LengthUnit, type UnitSettings } from '../units';

/** Everything saved in a Pushform file. Immutable; commands return new documents. */
export interface PushformDocument {
  readonly model: Model;
  /** Per-file display units and precision. */
  readonly units: UnitSettings;
}

/**
 * Version 2 holds a topology model (shared vertices and edges). Version 1
 * (milestone 1) held a face-loop model; it is converted when loaded.
 */
export interface SerializedDocument {
  format: 'pushform';
  version: 2;
  units: UnitSettings;
  model: SerializedTopology;
}

export function newDocument(): PushformDocument {
  return { model: createModel(), units: { ...DEFAULT_UNIT_SETTINGS } };
}

export function serializeDocument(doc: PushformDocument): SerializedDocument {
  return { format: 'pushform', version: 2, units: { ...doc.units }, model: serialize(doc.model) };
}

/** Validate and load a saved document (version 1 or 2). Returns null when the data is not a valid document. */
export function deserializeDocument(data: unknown): PushformDocument | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as { format?: unknown; version?: unknown; model?: unknown; units?: Partial<UnitSettings> };
  if (d.format !== 'pushform' || (d.version !== 1 && d.version !== 2)) return null;
  const model = deserialize(d.model);
  const u = d.units;
  if (!model || !u || !LENGTH_UNITS.includes(u.unit as LengthUnit)) return null;
  const units = { unit: u.unit, precision: u.precision } as UnitSettings;
  if (!isValidSettings(units)) return null;
  return { model, units };
}
