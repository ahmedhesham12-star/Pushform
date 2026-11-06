import { z } from 'zod';
import { t } from '../../i18n';
import { createModel } from '../../kernel';
import { addDefinition, loadMesh, newId, putInstance, snapTransform, type MeshData } from '../../scene';
import type { CommandDef } from '../types';
import { definitionId, point3, targetModel } from './schemas';

/** A reference mesh as `saveMesh` writes it (base64 arrays), so even a large one is a short input. */
export const serializedMesh = z.strictObject({
  positions: z.string(),
  triangles: z.string(),
  edges: z.string(),
  parts: z.array(z.strictObject({ triangles: z.number().int().positive(), color: z.string() })).min(1),
});

export const insertMeshInput = z.strictObject({
  /** The editing context to place it in (the root when omitted). */
  definitionId,
  /** The new definition's name, usually the file's. */
  name: z.string().trim().min(1).max(200),
  mesh: serializedMesh,
  /** Where its origin goes, in the context's coordinates (mm). */
  position: point3,
});
export type InsertMeshInput = z.infer<typeof insertMeshInput>;
export interface InsertMeshOutput {
  definitionId: string;
  instanceId: string;
}

/**
 * The last mesh read, by its positions text: placing previews the insert on
 * every pointer move, and reading a large mesh each time would be slow. The
 * same text (the same string, compared by reference first) gives the same,
 * immutable mesh.
 */
let lastRead: { text: string; triangles: string; mesh: MeshData | null } | null = null;
function readMesh(input: z.infer<typeof serializedMesh>): MeshData | null {
  if (lastRead && lastRead.text === input.positions && lastRead.triangles === input.triangles) return lastRead.mesh;
  const mesh = loadMesh(input);
  lastRead = { text: input.positions, triangles: input.triangles, mesh };
  return mesh;
}

/**
 * Place an imported mesh (milestone 6) as a new reference mesh definition with
 * one instance, unturned, its origin at `position`. Refused (`invalidMesh`)
 * when the mesh data is not valid.
 */
export const insertMesh: CommandDef<InsertMeshInput, InsertMeshOutput> = {
  id: 'core.insertMesh',
  title: () => t('command.insertMesh'),
  input: insertMeshInput,
  run(doc, input) {
    const target = targetModel(doc, input.definitionId);
    if (!target.ok) return target;
    const mesh = readMesh(input.mesh);
    if (!mesh) return { ok: false, error: { code: 'invalidMesh', detail: input.name } };
    const parent = input.definitionId ?? doc.scene.rootId;
    let [defId, scene] = addDefinition(doc.scene, { kind: 'mesh', name: input.name, model: createModel(), instances: new Map(), mesh });
    let instanceId: string;
    [instanceId, scene] = newId(scene, 'i');
    const transform = snapTransform({ rotation: [0, 0, 0, 1], translation: input.position, scale: [1, 1, 1] });
    scene = putInstance(scene, parent, { id: instanceId, definitionId: defId, name: '', transform });
    return { ok: true, doc: { ...doc, scene }, output: { definitionId: defId, instanceId } };
  },
};
