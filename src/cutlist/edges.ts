/**
 * A part's axes and its four edges (milestone 6). The length and width run
 * along two of the part's own axes, as placed; its four edges are the side
 * faces at each end of them. An edge is banded with a material bought as edge
 * band, painted on the front of its side faces: the band belongs to the
 * definition, so component copies share it, and it stays on its edge when the
 * part is resized, as the face does.
 */
import { bounds, faceArea, listFaces, type Bounds, type Model } from '../kernel';
import { isEdgeBand, type Affine, type GrainAxis, type MaterialId, type Scene } from '../scene';

/** The edges along the length (at each side of the width) and across it (at each end of the length). */
export const EDGES = ['length1', 'length2', 'width1', 'width2'] as const;
export type Edge = (typeof EDGES)[number];
export type Bands = Readonly<Record<Edge, MaterialId | null>>;

/** Our axes as SketchUp names them: red is x, green is z, blue is y (up). */
const AXIS_INDEX: Record<GrainAxis, number> = { red: 0, green: 2, blue: 1 };
/** A face this close (mm) to the box's side lies on it. */
const SIDE_TOLERANCE = 0.01;

export interface PartAxes {
  /** The part's own axes its length, width and thickness run along. */
  readonly axes: readonly [number, number, number];
  /** Its length, width and thickness in mm, as placed. */
  readonly sizes: readonly [number, number, number];
  /** Scaled more one way than another, or skewed. */
  readonly stretched: boolean;
  /** Its own box, unscaled. */
  readonly box: Bounds;
}

/**
 * Which of a part's own axes its length, width and thickness run along: the
 * longest first, unless a grain direction picks the length; null without
 * geometry. Each size is the box along the axis, scaled as placed.
 */
export function partAxes(model: Model, grain: GrainAxis | null, world: Affine): PartAxes | null {
  const box = bounds(model);
  if (!box) return null;
  const m = world.m;
  const column = (i: number) => [m[3 * i]!, m[3 * i + 1]!, m[3 * i + 2]!];
  const scales = [0, 1, 2].map((i) => Math.hypot(...column(i)));
  const sizes = [0, 1, 2].map((i) => (box.max[i]! - box.min[i]!) * scales[i]!);
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const skewed = [0, 1, 2].some((i) => Math.abs(dot(column(i), column((i + 1) % 3))) > 1e-9 * scales[i]! * scales[(i + 1) % 3]!);
  const stretched = skewed || scales.some((s) => Math.abs(s - scales[0]!) > 1e-9 * scales[0]!);
  const bySize = (a: number, b: number) => sizes[b]! - sizes[a]!;
  const along = grain ? AXIS_INDEX[grain] : null;
  const order = along === null ? [0, 1, 2].sort(bySize) : [along, ...[0, 1, 2].filter((i) => i !== along).sort(bySize)];
  const axes = order as [number, number, number];
  return { axes, sizes: [sizes[axes[0]]!, sizes[axes[1]]!, sizes[axes[2]]!], stretched, box };
}

export interface PartEdge {
  /** The side faces at this edge, in the part's definition. */
  readonly faceIds: readonly string[];
  /** The edge band on it, or null. */
  readonly band: MaterialId | null;
  /** How long the edge is, in mm (the part's length or width). */
  readonly length: number;
}

/**
 * A part's four edges: the length edges at the low and high side of its
 * width axis, the width edges at the low and high end of its length axis.
 * An edge's band is the one on most of its side face area.
 */
export function partEdges(scene: Scene, model: Model, part: PartAxes): Record<Edge, PartEdge> {
  const faces = listFaces(model);
  const [lengthAxis, widthAxis] = part.axes;
  const side = (axis: number, high: boolean, length: number): PartEdge => {
    const at = high ? part.box.max[axis]! : part.box.min[axis]!;
    const on = faces.filter((f) => Math.abs(f.normal[axis]! - (high ? 1 : -1)) < 1e-6 && Math.abs(f.outer[0]![axis]! - at) <= SIDE_TOLERANCE);
    const area = new Map<MaterialId, number>();
    for (const f of on) {
      const band = f.paint?.front;
      if (isEdgeBand(scene, band)) area.set(band!, (area.get(band!) ?? 0) + faceArea(model, f.id));
    }
    const band = [...area].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { faceIds: on.map((f) => f.id), band, length };
  };
  return {
    length1: side(widthAxis, false, part.sizes[0]),
    length2: side(widthAxis, true, part.sizes[0]),
    width1: side(lengthAxis, false, part.sizes[1]),
    width2: side(lengthAxis, true, part.sizes[1]),
  };
}

/** The bands on a part's edges. */
export const bandsOf = (edges: Record<Edge, PartEdge>): Bands => ({ length1: edges.length1.band, length2: edges.length2.band, width1: edges.width1.band, width2: edges.width2.band });

/** A part's size to cut before banding: each banded edge's band thickness taken off. */
export function cutSize(scene: Scene, length: number, width: number, bands: Bands): { length: number; width: number } {
  const thickness = (id: MaterialId | null) => {
    const stock = id ? scene.materials.get(id)?.stock : undefined;
    return stock?.kind === 'band' ? stock.thickness : 0;
  };
  return { length: length - thickness(bands.width1) - thickness(bands.width2), width: width - thickness(bands.length1) - thickness(bands.length2) };
}
