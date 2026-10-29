import { BackSide, FrontSide, MeshLambertMaterial, RepeatWrapping, Texture, type Side } from 'three';
import { faceTextureFrame, type FaceMesh, type FaceSide, type Model } from '../kernel';
import type { Material, Texture as SceneTexture } from '../scene';

/** The front face color, which Untagged also shows with Color by Tag. */
export const FACE_COLOR = 0xf3f2ee;
/** Unpainted back faces, as in the prototype (and SketchUp's blue-grey). */
export const BACK_COLOR = 0x8e9fb2;
/** Geometry outside the editing context is drawn faded, as in SketchUp. */
export const FADED_OPACITY = 0.3;

export function faceMaterial(color: number, side: Side, faded = false, map: Texture | null = null): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color,
    side,
    map,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    transparent: faded,
    opacity: faded ? FADED_OPACITY : 1,
    depthWrite: !faded,
  });
}

/**
 * three.js materials for scene materials, made once per look: the color, or
 * the image tiled at its size in mm (face texture coordinates are in mm, see
 * faceUVs), on the front or the back, normal or faded. Images load in the
 * background; `loaded` asks for a new frame when one arrives.
 */
export class MaterialLibrary {
  private readonly materials = new Map<string, MeshLambertMaterial>();
  private readonly textures = new WeakMap<SceneTexture, { texture: Texture; key: number }>();
  private nextKey = 1;

  constructor(private readonly loaded: () => void = () => {}) {}

  /** The look of an unpainted side: the usual front color, or blue-grey behind (a neutral ghost when faded). */
  plain(side: FaceSide, faded: boolean): MeshLambertMaterial {
    return this.cached(`plain:${side}:${faded}`, () => faceMaterial(side === 'back' && !faded ? BACK_COLOR : FACE_COLOR, side === 'front' ? FrontSide : BackSide, faded));
  }

  /** The look of a side painted with a material (or unpainted, for undefined). */
  get(material: Material | undefined, side: FaceSide, faded: boolean): MeshLambertMaterial {
    if (!material) return this.plain(side, faded);
    const tex = material.texture ? this.texture(material.texture) : null;
    const key = `${material.color}:${tex?.key ?? 0}:${side}:${faded}`;
    // A texture shows its own colors, untinted.
    return this.cached(key, () => faceMaterial(tex ? 0xffffff : parseInt(material.color.slice(1), 16), side === 'front' ? FrontSide : BackSide, faded, tex?.texture ?? null));
  }

  private cached(key: string, make: () => MeshLambertMaterial): MeshLambertMaterial {
    let m = this.materials.get(key);
    if (!m) this.materials.set(key, (m = make()));
    return m;
  }

  private texture(t: SceneTexture): { texture: Texture; key: number } {
    let entry = this.textures.get(t);
    if (!entry) {
      const texture = new Texture();
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.repeat.set(1 / t.width, 1 / t.height);
      // Without a DOM (tests, export) there is no image to load; the material still has its place.
      if (typeof Image !== 'undefined') {
        const image = new Image();
        image.onload = () => {
          texture.image = image;
          texture.needsUpdate = true;
          this.loaded();
        };
        image.src = `data:${t.mime};base64,${t.data}`;
      }
      this.textures.set(t, (entry = { texture, key: this.nextKey++ }));
    }
    return entry;
  }
}

/** Texture coordinates (mm along each face's texture frame) for the vertices of a face mesh. */
export function faceUVs(model: Model, mesh: FaceMesh): number[] {
  const frame = faceTextureFrame(model, mesh.faceId);
  const out: number[] = [];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (!frame) {
      out.push(0, 0);
      continue;
    }
    const d = [p[i]! - frame.origin[0], p[i + 1]! - frame.origin[1], p[i + 2]! - frame.origin[2]];
    out.push(d[0]! * frame.u[0] + d[1]! * frame.u[1] + d[2]! * frame.u[2], d[0]! * frame.v[0] + d[1]! * frame.v[1] + d[2]! * frame.v[2]);
  }
  return out;
}
