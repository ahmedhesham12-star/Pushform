import { STARTER_MATERIALS, type CommandError, type CommandSession, type StarterMaterial } from '../commands';
import { EDGES, partAxes, partEdges, type Edge, type PartEdge } from '../cutlist';
import { t, type MessageKey } from '../i18n';
import { faceArea, listFaces } from '../kernel';
import { isEdgeBand, pathDefinition, pathTransform, type Definition, type InstanceId, type MaterialId, type Scene } from '../scene';

/** An edge band to put on: one in the file, or a starter one, copied into the file first. */
export type BandChoice = { readonly materialId: MaterialId } | { readonly starter: StarterMaterial };

/** Whether a Paint Bucket choice is an edge band, so a click bands an edge instead of painting. */
export function isBandChoice(scene: Scene, choice: { materialId: MaterialId | null } | { starter: StarterMaterial }): choice is BandChoice {
  if ('starter' in choice) return STARTER_MATERIALS[choice.starter]?.stock?.kind === 'band';
  return isEdgeBand(scene, choice.materialId);
}

export interface PlacedPart {
  readonly definition: Definition;
  readonly name: string;
  readonly edges: Record<Edge, PartEdge>;
}

/** The part placed at the end of a path, with its four edges; null for the root or an assembly. */
export function partAt(scene: Scene, path: readonly InstanceId[]): PlacedPart | null {
  const definition = pathDefinition(scene, path);
  if (!path.length || !definition || definition.instances.size) return null;
  const axes = partAxes(definition.model, definition.grain ?? null, pathTransform(scene, path));
  if (!axes) return null;
  const instance = pathDefinition(scene, path.slice(0, -1))?.instances.get(path[path.length - 1]!);
  const name = instance?.name || definition.name || t('scene.group');
  return { definition, name, edges: partEdges(scene, definition.model, axes) };
}

/** The edge a side face of a part is on; null for its broad faces (and anything else). */
export const edgeOf = (part: PlacedPart, faceId: string): Edge | null => EDGES.find((e) => part.edges[e].faceIds.includes(faceId)) ?? null;

/**
 * Band one edge of a part (paint its side faces with the band), or take the
 * band off (null): its faces then get back the paint the part's other faces
 * carry, or none. Says in the status bar what was done.
 */
export function setEdgeBand(
  session: CommandSession,
  part: PlacedPart,
  edge: Edge,
  band: BandChoice | null,
  say: { flash(message: string): void; flashError(error: CommandError): void },
): MaterialId | null {
  const { definition } = part;
  const faceIds = [...part.edges[edge].faceIds];
  if (!faceIds.length) return null;
  const scene = session.doc.scene;
  let paint: { materialId: MaterialId | null } | { starter: StarterMaterial };
  if (band) paint = band;
  else {
    const sides = new Set(faceIds);
    const own = new Map<MaterialId, number>();
    for (const f of listFaces(definition.model)) {
      const p = f.paint?.front;
      if (!sides.has(f.id) && p && !isEdgeBand(scene, p)) own.set(p, (own.get(p) ?? 0) + faceArea(definition.model, f.id));
    }
    paint = { materialId: [...own].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null };
  }
  const r = session.execute('core.paint', { definitionId: definition.id, faceIds, ...paint });
  if (!r.ok) {
    say.flashError(r.error);
    return null;
  }
  const edgeName = t(`cutlist.edge.${edge}` as MessageKey);
  const bandId = band ? r.output.materialId : null;
  const bandName = bandId ? (session.doc.scene.materials.get(bandId)?.name ?? '') : '';
  say.flash(band ? t('message.banded', { part: part.name, edge: edgeName, band: bandName }) : t('message.unbanded', { part: part.name, edge: edgeName }));
  return bandId;
}
