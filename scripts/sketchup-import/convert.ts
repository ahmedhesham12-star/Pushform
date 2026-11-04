/**
 * A SketchUp model, read by dump.rb, as a Pushform document. A developer tool
 * for testing with real models; not part of the app.
 *
 * SketchUp works in inches with Z up; Pushform in millimeters with Y up. Each
 * definition's geometry becomes a kernel topology that must pass the
 * invariant checker: geometry the checker refuses is repaired where the fix is
 * exact (a vertex lying inside an edge splits the edge) and skipped otherwise,
 * and everything skipped or changed is listed in the report.
 */
import { documentFromText, documentToText, type PushformDocument, type SerializedDocument } from '../../src/commands';
import { checkModel, type SerializedTopology } from '../../src/kernel';
import { decompose, type SerializedScene, type SerializedTransform } from '../../src/scene';
import type { UnitSettings } from '../../src/units';

/* ---------- the dump written by dump.rb ---------- */

type Vec = [number, number, number];

interface DumpEdge {
  v: [number, number];
  soft: boolean;
  smooth: boolean;
  hidden: boolean;
  curve: number | null;
  layer: string | null;
}
interface DumpCurve {
  arc: boolean;
  segments: number;
  center?: Vec;
  normal?: Vec;
  radius?: number;
  xaxis?: Vec;
  yaxis?: Vec;
  start?: number;
  end?: number;
  polygon?: boolean;
}
interface DumpFace {
  outer: number[];
  holes: number[][];
  normal: Vec;
  front: number | null;
  back: number | null;
  hidden: boolean;
  layer: string | null;
}
interface DumpInstance {
  definition: number;
  name: string;
  transform: number[];
  layer: string | null;
  material: number | null;
  hidden: boolean;
}
interface DumpEntities {
  vertices: Vec[];
  edges: DumpEdge[];
  curves: DumpCurve[];
  faces: DumpFace[];
  instances: DumpInstance[];
  guides: ({ kind: 'line'; point: Vec; direction: Vec; layer: string | null } | { kind: 'point'; point: Vec; layer: string | null })[];
  dimensions: { start: Vec; end: Vec; offset: Vec; layer: string | null }[];
  texts: { point: Vec; leader: Vec; text: string; hasLeader: boolean; layer: string | null }[];
  other: Record<string, number>;
}
export interface Dump {
  format: 'pushform-sketchup-dump';
  version: 1;
  sketchup: string;
  title: string;
  path: string;
  units: { unit: number; format: number; precision: number };
  root: DumpEntities;
  definitions: { id: number; name: string; group: boolean; entities: DumpEntities }[];
  materials: {
    id: number;
    name: string;
    color: Vec;
    alpha: number;
    texture: { file: string | null; width: number; height: number; source: string } | null;
  }[];
  layers: { name: string; visible: boolean; color: Vec; default: boolean }[];
  unused: number;
}

/* ---------- the report ---------- */

export interface Report {
  readonly converted: Record<string, number>;
  /** What was skipped, changed or approximated, by place and reason, with how often. */
  readonly issues: { where: string; what: string; count: number }[];
}

class Issues {
  private readonly counts = new Map<string, { where: string; what: string; count: number }>();
  add(where: string, what: string, count = 1): void {
    if (count <= 0) return;
    const key = `${where}\n${what}`;
    const item = this.counts.get(key) ?? { where, what, count: 0 };
    item.count += count;
    this.counts.set(key, item);
  }
  list() {
    return [...this.counts.values()];
  }
}

/** The report as plain text lines. */
export function reportText(r: Report): string {
  const lines = ['Converted:'];
  for (const [k, v] of Object.entries(r.converted)) lines.push(`  ${k}: ${v}`);
  lines.push(r.issues.length ? 'Skipped or changed:' : 'Skipped or changed: nothing');
  for (const i of r.issues) lines.push(`  ${i.where}: ${i.what}${i.count > 1 ? ` (${i.count})` : ''}`);
  return lines.join('\n');
}

/* ---------- geometry ---------- */

const MM = 25.4;
/** The kernel's vertex tolerance, in mm. */
const TOLERANCE = 1e-3;
const snap = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** SketchUp (inches, Z up) to Pushform (mm, Y up): (x, y, z) becomes (x, z, -y). */
const point = (p: readonly number[]): Vec => [snap(p[0]! * MM), snap(p[2]! * MM), snap(-p[1]! * MM)];
const direction = (v: readonly number[]): Vec => [v[0]!, v[2]!, -v[1]!];
const vector = (v: readonly number[]): Vec => [v[0]! * MM, v[2]! * MM, -v[1]! * MM];

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: readonly number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const unit = (a: Vec): Vec | null => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : null;
};
function newell(loop: readonly Vec[]): Vec {
  const n: Vec = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** SketchUp's 4x4 (column by column, a uniform scale in the last entry) as a Pushform transform; null when it skews. */
function transformOf(a: readonly number[]): SerializedTransform | null {
  if (a.length !== 16 || !a.every(Number.isFinite) || a[15] === 0) return null;
  const w = a[15]!;
  const col = (i: number): Vec => direction([a[i]! / w, a[i + 1]! / w, a[i + 2]! / w]);
  // Pushform axes in SketchUp terms: x is x, y is z, z is -y.
  const x = col(0);
  const y = col(8);
  const z = col(4).map((c) => -c) as Vec;
  const t = vector([a[12]! / w, a[13]! / w, a[14]! / w]).map(snap) as Vec;
  const r = decompose({ m: [...x, ...y, ...z], t });
  if (!r) return null;
  return { rotation: [...r.rotation], translation: [...r.translation], scale: [...r.scale] };
}

/* ---------- one definition's geometry ---------- */

interface Built {
  topology: SerializedTopology;
  faces: number;
  edges: number;
  curves: number;
}

type Topo = SerializedTopology;

/** The faces and edges of one SketchUp entities collection as a topology that passes the checker. */
function buildTopology(
  e: DumpEntities,
  where: string,
  materialId: (id: number | null) => string | undefined,
  isDefaultLayer: (name: string) => boolean,
  issues: Issues,
): Built {
  let next = 1;
  const id = (prefix: string) => `${prefix}${next++}`;
  const t: Topo = { kind: 'topology', version: 2, next: 0, vertices: {}, edges: {}, faces: {}, curves: {} };
  const vid = e.vertices.map((p) => {
    const v = id('v');
    t.vertices[v] = point(p);
    return v;
  });
  const P = (v: string): Vec => t.vertices[v] as Vec;

  const curveIds = e.curves.map((c) => {
    if (!c.arc) return null;
    const normal = unit(direction(c.normal!));
    if (!normal) return null;
    const round = Math.abs(len(c.xaxis!) - len(c.yaxis!)) <= 1e-6 * Math.max(1, len(c.xaxis!));
    const full = Math.abs(Math.abs(c.end! - c.start!) - 2 * Math.PI) < 1e-6;
    const cid = id('c');
    t.curves[cid] = {
      kind: c.polygon ? 'polygon' : full ? 'circle' : 'arc',
      edges: [],
      segments: c.segments,
      center: point(c.center!),
      normal,
      ...(round ? { radius: snap(c.radius! * MM) } : {}),
    };
    return cid;
  });
  const welded = e.curves.filter((c) => !c.arc).length;
  issues.add(where, 'welded curves (not arcs or circles) kept as separate edges', welded);
  const ellipses = Object.values(t.curves).filter((c) => c.radius === undefined).length;
  issues.add(where, 'ellipses kept as curves without a radius', ellipses);

  const pairs = new Map<string, string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  let hiddenEdges = 0;
  let taggedGeometry = 0;
  for (const d of e.edges) {
    const [a, b] = [vid[d.v[0]]!, vid[d.v[1]]!];
    if (a === b || pairs.has(pairKey(a, b))) continue;
    const eid = id('e');
    pairs.set(pairKey(a, b), eid);
    const curve = d.curve === null ? null : curveIds[d.curve] ?? null;
    if (curve) t.curves[curve]!.edges.push(eid);
    if (d.hidden && !d.soft) hiddenEdges++;
    if (d.layer !== null && !isDefaultLayer(d.layer)) taggedGeometry++;
    t.edges[eid] = { v: [a, b], ...(d.soft || d.hidden ? { soft: true as const } : {}), ...(curve ? { curve } : {}) };
  }
  issues.add(where, 'hidden edges made soft (Pushform has no hidden edges)', hiddenEdges);

  let hiddenFaces = 0;
  for (const f of e.faces) {
    const loops = [f.outer, ...f.holes].map((l) => {
      const ids = l.map((i) => vid[i]!);
      return ids.filter((v, i) => v !== ids[(i + 1) % ids.length]);
    });
    if (loops.some((l) => l.length < 3 || new Set(l).size !== l.length)) {
      issues.add(where, 'faces skipped: a loop visits a vertex twice or has fewer than 3 corners');
      continue;
    }
    if (loops.some((l) => l.some((v, i) => !pairs.has(pairKey(v, l[(i + 1) % l.length]!))))) {
      issues.add(where, 'faces skipped: a loop side has no edge');
      continue;
    }
    const sketchupNormal = direction(f.normal);
    let outer = loops[0]!;
    if (dot(newell(outer.map(P)), sketchupNormal) < 0) outer = [...outer].reverse();
    const normal = unit(newell(outer.map(P)));
    if (!normal) {
      issues.add(where, 'faces skipped: no area');
      continue;
    }
    const d = dot(normal, P(outer[0]!));
    const holes = loops.slice(1).map((h) => (dot(newell(h.map(P)), normal) >= 0 ? [...h].reverse() : h));
    if ([outer, ...holes].flat().some((v) => Math.abs(dot(normal, P(v)) - d) > TOLERANCE)) {
      issues.add(where, 'faces skipped: not planar within 0.001 mm');
      continue;
    }
    if (f.hidden) hiddenFaces++;
    if (f.layer !== null && !isDefaultLayer(f.layer)) taggedGeometry++;
    const front = materialId(f.front);
    const back = materialId(f.back);
    t.faces[id('f')] = { normal, outer, holes, ...(front || back ? { paint: { ...(front ? { front } : {}), ...(back ? { back } : {}) } } : {}) };
  }
  issues.add(where, 'hidden faces shown (Pushform has no hidden faces)', hiddenFaces);
  issues.add(where, 'faces and edges with a tag left untagged (Pushform tags groups and components only)', taggedGeometry);

  repair(t, where, issues, () => id('e'));
  // After the repair, which names new edges.
  t.next = next;
  return { topology: t, faces: Object.keys(t.faces).length, edges: Object.keys(t.edges).length, curves: Object.keys(t.curves).length };
}

/** Drop curves without edges and vertices without edges. */
function tidy(t: Topo): void {
  const used = new Set(Object.values(t.edges).flatMap((e) => e.v));
  for (const v of Object.keys(t.vertices)) if (!used.has(v)) delete t.vertices[v];
  for (const [cid, c] of Object.entries(t.curves)) {
    c.edges = c.edges.filter((e) => t.edges[e]?.curve === cid);
    if (!c.edges.length) delete t.curves[cid];
  }
}

function removeFace(t: Topo, f: string, where: string, why: string, issues: Issues): void {
  if (!t.faces[f]) return;
  delete t.faces[f];
  issues.add(where, `faces skipped: ${why}`);
}

/** Faces that run along the edge a-b. */
const facesOnEdge = (t: Topo, a: string, b: string) =>
  Object.entries(t.faces).filter(([, f]) => [f.outer, ...f.holes].some((l) => l.some((v, i) => (v === a && l[(i + 1) % l.length] === b) || (v === b && l[(i + 1) % l.length] === a))));

/** Fix what the kernel's checker finds, or skip the geometry involved, until it finds nothing. */
function repair(t: Topo, where: string, issues: Issues, newEdge: () => string): void {
  tidy(t);
  for (let round = 0; round < 50; round++) {
    const problems = check(t);
    if (!problems.length) return;
    let changed = false;
    for (const p of problems) {
      let m: RegExpMatchArray | null;
      if ((m = p.match(/^vertex (\S+) lies inside edge (\S+)$/))) {
        // Split the edge at the vertex, and every face loop along it.
        const [v, eid] = [m[1]!, m[2]!];
        const edge = t.edges[eid];
        if (!edge || !t.vertices[v]) continue;
        const [a, b] = edge.v;
        for (const [, f] of facesOnEdge(t, a, b)) {
          for (const l of [f.outer, ...f.holes]) {
            for (let i = 0; i < l.length; i++) {
              const j = (i + 1) % l.length;
              if ((l[i] === a && l[j] === b) || (l[i] === b && l[j] === a)) {
                l.splice(i + 1, 0, v);
                break;
              }
            }
          }
        }
        delete t.edges[eid];
        const halves = [newEdge(), newEdge()];
        t.edges[halves[0]!] = { ...edge, v: [a, v] };
        t.edges[halves[1]!] = { ...edge, v: [v, b] };
        if (edge.curve) t.curves[edge.curve]?.edges.push(...halves);
        issues.add(where, 'edges split where a vertex lay inside them');
        changed = true;
        break; // Ids changed; check again.
      } else if ((m = p.match(/^faces (\S+) and (\S+) overlap$/))) {
        removeFace(t, m[2]!, where, 'overlapped another face in its plane', issues);
        changed = true;
        break;
      } else if ((m = p.match(/^edges (\S+) and (\S+) cross$/))) {
        const edge = t.edges[m[2]!];
        if (!edge) continue;
        for (const [f] of facesOnEdge(t, edge.v[0], edge.v[1])) removeFace(t, f, where, 'bounded by an edge that crosses another edge in its plane', issues);
        delete t.edges[m[2]!];
        issues.add(where, 'edges skipped: crossed another edge in their plane without meeting it');
        changed = true;
        break;
      } else if ((m = p.match(/^face (\S+) /))) {
        removeFace(t, m[1]!, where, p.slice(m[0].length), issues);
        changed = true;
      }
    }
    if (!changed) throw new Error(`${where}: cannot repair: ${problems.slice(0, 5).join('; ')}`);
    tidy(t);
  }
  throw new Error(`${where}: still invalid after 50 rounds of repair`);
}

/** The kernel's invariant check of a topology, through the same loading path a .pushform file takes. */
function check(t: Topo): string[] {
  const model = Object.fromEntries(Object.entries(t.faces).map(([id, f]) => [id, { normal: f.normal, outer: f.outer, holes: f.holes }]));
  const doc = load({ ...t, faces: model }, {});
  if (!doc) throw new Error('the topology did not load');
  return checkModel(doc.scene.definitions.get('r')!.model);
}

function load(topology: Topo, materials: SerializedScene['materials']): PushformDocument | null {
  const scene: SerializedScene = { root: 'r', next: 1, materials: materials ?? {}, definitions: { r: { kind: 'root', name: '', model: topology, instances: {} } } };
  const data: SerializedDocument = { format: 'pushform', version: 6, units: { unit: 'mm', precision: 0 }, workspace: 'general', scene };
  return documentFromText(JSON.stringify(data));
}

/* ---------- units ---------- */

/** SketchUp's length settings as Pushform's, with a note when there is no exact match. */
function unitsOf(u: Dump['units'], issues: Issues): UnitSettings {
  const fraction = Math.min(64, 2 ** Math.max(0, u.precision));
  const decimals = Math.min(4, Math.max(0, u.precision));
  // LengthFormat: 0 decimal, 1 architectural, 2 engineering, 3 fractional. LengthUnit: 0 in, 1 ft, 2 mm, 3 cm, 4 m, 5 yd.
  if (u.format === 1) return { unit: 'ft-in', precision: fraction };
  if (u.format === 3) return { unit: 'in-frac', precision: fraction };
  if (u.format === 0 && u.unit === 0) return { unit: 'in', precision: decimals };
  if (u.format === 0 && (u.unit === 2 || u.unit === 3 || u.unit === 4)) {
    if (u.precision > 4) issues.add('Units', `precision of ${u.precision} decimals shown as 4`);
    return { unit: u.unit === 2 ? 'mm' : u.unit === 3 ? 'cm' : 'm', precision: decimals };
  }
  issues.add('Units', `SketchUp units (format ${u.format}, unit ${u.unit}) have no Pushform match; feet and inches used`);
  return { unit: 'ft-in', precision: 16 };
}

/* ---------- the whole model ---------- */

const hex = (c: readonly number[]) => `#${c.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Convert a dump. `texture` reads a texture file written next to the dump, as
 * base64 PNG, or null when it is missing.
 */
export function convert(dump: Dump, texture: (file: string) => string | null): { document: PushformDocument; text: string; report: Report } {
  if (dump.format !== 'pushform-sketchup-dump' || dump.version !== 1) throw new Error('not a dump from dump.rb version 1');
  const issues = new Issues();
  let next = 1;
  const sid = (prefix: string) => `${prefix}${next++}`;
  const defaultLayers = new Set(dump.layers.filter((l) => l.default).map((l) => l.name));
  const isDefaultLayer = (name: string) => defaultLayers.has(name);

  /* tags */
  const tags: NonNullable<SerializedScene['tags']> = {};
  const tagByLayer = new Map<string, string>();
  for (const l of dump.layers) {
    if (l.default) continue;
    const tid = sid('t');
    tags[tid] = { name: l.name.trim() || 'Tag', color: hex(l.color), visible: l.visible };
    tagByLayer.set(l.name, tid);
  }
  const tagOf = (layer: string | null) => {
    const tid = layer === null ? undefined : tagByLayer.get(layer);
    return tid ? { tag: tid } : {};
  };

  /* materials */
  const materials: NonNullable<SerializedScene['materials']> = {};
  const materialById = new Map<number, string>();
  for (const m of dump.materials) {
    const mid = sid('m');
    materialById.set(m.id, mid);
    const name = m.name.trim() || 'Material';
    let tex: { data: string; mime: string; width: number; height: number } | undefined;
    if (m.texture) {
      const data = m.texture.file ? texture(m.texture.file) : null;
      if (data && m.texture.width > 0 && m.texture.height > 0) tex = { data, mime: 'image/png', width: snap(m.texture.width * MM), height: snap(m.texture.height * MM) };
      else issues.add(`Material ${name}`, 'texture image could not be read; color kept');
    }
    if (m.alpha < 1) issues.add(`Material ${name}`, `opacity ${Math.round(m.alpha * 100)}% shown opaque (Pushform has no opacity yet)`);
    materials[mid] = { name, color: hex(m.color), ...(tex ? { texture: tex } : {}) };
  }
  if (dump.materials.some((m) => m.texture)) issues.add('Materials', 'texture positions on faces not converted; textures restart at each face');
  const materialId = (id: number | null) => (id === null ? undefined : materialById.get(id));

  /* geometry, once per SketchUp definition */
  const sketchupDefs = new Map(dump.definitions.map((d) => [d.id, d]));
  const built = new Map<number | 'root', Built>();
  const geometry = (key: number | 'root', e: DumpEntities, where: string) => {
    let b = built.get(key);
    if (!b) {
      b = buildTopology(e, where, materialId, isDefaultLayer, issues);
      built.set(key, b);
    }
    return b;
  };

  /* definitions and instances */
  const definitions: SerializedScene['definitions'] = {};
  const componentIds = new Map<number, string>();
  const counts = { groups: 0, components: 0, instances: 0, guides: 0, dimensions: 0, texts: 0 };

  const fill = (pid: string, e: DumpEntities, where: string) => {
    const def = definitions[pid]!;
    for (const i of e.instances) {
      const target = sketchupDefs.get(i.definition);
      if (!target) continue;
      const transform = transformOf(i.transform);
      if (!transform) {
        issues.add(where, `instances skipped: transform of ${i.name || target.name} is skewed`);
        continue;
      }
      if (i.hidden) issues.add(where, 'hidden groups and components shown (Pushform hides only by tag)');
      const child = place(target, i.name);
      def.instances[sid('i')] = { definition: child, name: i.name, transform, ...tagOf(i.layer), ...(materialId(i.material) ? { material: materialId(i.material)! } : {}) };
      counts.instances++;
    }
    const guides: NonNullable<(typeof def)['guides']> = {};
    for (const g of e.guides) {
      if (g.kind === 'line') {
        const d = unit(direction(g.direction));
        if (d) guides[sid('g')] = { kind: 'line', point: point(g.point), direction: d, ...tagOf(g.layer) };
      } else guides[sid('g')] = { kind: 'point', point: point(g.point), ...tagOf(g.layer) };
    }
    const annotations: NonNullable<(typeof def)['annotations']> = {};
    for (const d of e.dimensions) annotations[sid('a')] = { kind: 'dimension', start: { point: point(d.start) }, end: { point: point(d.end) }, offset: vector(d.offset), ...tagOf(d.layer) };
    for (const x of e.texts) {
      if (!x.hasLeader) {
        issues.add(where, 'screen text skipped');
        continue;
      }
      annotations[sid('a')] = { kind: 'text', anchor: { point: point(x.point) }, leader: vector(x.leader), text: x.text, ...tagOf(x.layer) };
    }
    counts.guides += Object.keys(guides).length;
    counts.dimensions += e.dimensions.length;
    counts.texts += Object.values(annotations).filter((a) => a.kind === 'text').length;
    if (Object.keys(guides).length) def.guides = guides;
    if (Object.keys(annotations).length) def.annotations = annotations;
    for (const [kind, n] of Object.entries(e.other)) issues.add(where, `${kind} skipped`, n);
  };

  /** The Pushform definition for a SketchUp definition: one per component, a new one for every placed group. */
  const place = (d: Dump['definitions'][number], instanceName: string): string => {
    if (!d.group && componentIds.has(d.id)) return componentIds.get(d.id)!;
    const pid = sid('d');
    const where = d.group ? `Group ${instanceName || d.name}` : `Component ${d.name}`;
    if (!d.group) componentIds.set(d.id, pid);
    const b = geometry(d.id, d.entities, where);
    definitions[pid] = { kind: d.group ? 'group' : 'component', name: d.group ? '' : d.name, model: b.topology, instances: {} };
    if (d.group) counts.groups++;
    else counts.components++;
    fill(pid, d.entities, where);
    return pid;
  };

  const rootId = sid('d');
  const root = geometry('root', dump.root, 'Model');
  definitions[rootId] = { kind: 'root', name: '', model: root.topology, instances: {} };
  fill(rootId, dump.root, 'Model');
  if (dump.unused) issues.add('Model', 'unused component definitions left out', dump.unused);

  const units = unitsOf(dump.units, issues);
  const data: SerializedDocument = {
    format: 'pushform',
    version: 6,
    units,
    workspace: 'general',
    scene: { root: rootId, next, ...(Object.keys(tags).length ? { tags } : {}), ...(Object.keys(materials).length ? { materials } : {}), definitions },
  };
  const document = documentFromText(JSON.stringify(data));
  if (!document) throw new Error('the converted document did not load');
  for (const def of document.scene.definitions.values()) {
    const problems = checkModel(def.model);
    if (problems.length) throw new Error(`definition ${def.name || def.id} fails the checker: ${problems[0]}`);
  }

  const topologies = [...built.values()];
  const report: Report = {
    converted: {
      'faces (in distinct definitions)': topologies.reduce((s, b) => s + b.faces, 0),
      'edges (in distinct definitions)': topologies.reduce((s, b) => s + b.edges, 0),
      curves: topologies.reduce((s, b) => s + b.curves, 0),
      components: counts.components,
      groups: counts.groups,
      'placed groups and components': counts.instances,
      materials: Object.keys(materials).length,
      tags: Object.keys(tags).length,
      guides: counts.guides,
      dimensions: counts.dimensions,
      texts: counts.texts,
    },
    issues: issues.list(),
  };
  return { document, text: documentToText(document), report };
}
