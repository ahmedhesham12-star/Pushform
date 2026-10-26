/**
 * Guides: construction lines and points a definition holds next to its
 * geometry, in its local mm (milestone 4). Tape Measure and Protractor make
 * them; every tool snaps to them. They never split or join geometry.
 */
import { cleanNormal, snapPoint, type Point3, type Vec3 } from '../kernel';
import { newId, type DefinitionId, type Scene } from './scene';
import { applyPoint, applyVector, type Transform } from './transform';

export type GuideId = string;

/** An infinite guide line (through `point`, along a unit `direction`) or a guide point. */
export type Guide =
  | { readonly kind: 'line'; readonly point: Point3; readonly direction: Vec3 }
  | { readonly kind: 'point'; readonly point: Point3 };

/** A guide line through a point along a direction (any non-zero length), or null for a zero direction. */
export function guideLine(point: Point3, direction: Vec3): Guide | null {
  const l = Math.hypot(direction[0], direction[1], direction[2]);
  if (l < 1e-9) return null;
  return { kind: 'line', point: snapPoint(point), direction: cleanNormal([direction[0] / l, direction[1] / l, direction[2] / l]) };
}

export const guidePoint = (point: Point3): Guide => ({ kind: 'point', point: snapPoint(point) });

/** A guide placed with a transform (into a parent's space, or the world). */
export function transformGuide(t: Transform, g: Guide): Guide {
  if (g.kind === 'point') return guidePoint(applyPoint(t, g.point));
  return guideLine(applyPoint(t, g.point), applyVector(t, g.direction)) ?? g;
}

/** Add a guide to a definition; returns its id and the new scene. */
export function addGuide(s: Scene, definitionId: DefinitionId, guide: Guide): [GuideId, Scene] {
  const [id, next] = newId(s, 'g');
  const d = next.definitions.get(definitionId)!;
  const guides = new Map(d.guides).set(id, guide);
  return [id, { ...next, definitions: new Map(next.definitions).set(d.id, { ...d, guides }) }];
}

/** Remove guides from a definition (all of them when ids is omitted); the same scene when none go. */
export function removeGuides(s: Scene, definitionId: DefinitionId, ids?: Iterable<GuideId>): Scene {
  const d = s.definitions.get(definitionId);
  if (!d || !d.guides.size) return s;
  const guides = new Map(d.guides);
  for (const id of ids ?? d.guides.keys()) guides.delete(id);
  if (guides.size === d.guides.size) return s;
  return { ...s, definitions: new Map(s.definitions).set(d.id, { ...d, guides }) };
}
