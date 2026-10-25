import { createModel, deserialize, serialize, type Model, type SerializedModel } from '../kernel';
import { DEFAULT_UNIT_SETTINGS, isValidSettings, LENGTH_UNITS, type LengthUnit, type UnitSettings } from '../units';

/** Everything saved in a Pushform file. Immutable; commands return new documents. */
export interface PushformDocument {
  readonly model: Model;
  /** Per-file display units and precision. */
  readonly units: UnitSettings;
}

export interface SerializedDocument {
  format: 'pushform';
  version: 1;
  units: UnitSettings;
  model: SerializedModel;
}

export function newDocument(): PushformDocument {
  return { model: createModel(), units: { ...DEFAULT_UNIT_SETTINGS } };
}

export function serializeDocument(doc: PushformDocument): SerializedDocument {
  return { format: 'pushform', version: 1, units: { ...doc.units }, model: serialize(doc.model) };
}

/** Validate and load a saved document. Returns null when the data is not a valid document. */
export function deserializeDocument(data: unknown): PushformDocument | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Partial<SerializedDocument>;
  if (d.format !== 'pushform' || d.version !== 1) return null;
  const model = deserialize(d.model);
  const u = d.units;
  if (!model || !u || !LENGTH_UNITS.includes(u.unit as LengthUnit)) return null;
  const units: UnitSettings = { unit: u.unit, precision: u.precision };
  if (!isValidSettings(units)) return null;
  return { model, units };
}
