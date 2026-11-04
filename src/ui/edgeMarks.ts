import { EDGES, type Bands } from '../cutlist';
import { t, type MessageKey } from '../i18n';
import type { Scene } from '../scene';

const SVG = 'http://www.w3.org/2000/svg';

/** What a part's banding is, in words: each banded edge with its band, or none. */
export function bandsText(bands: Bands, scene: Scene): string {
  const banded = EDGES.filter((e) => bands[e]).map((e) => t('cutlist.edge.band', { edge: t(`cutlist.edge.${e}` as MessageKey), band: scene.materials.get(bands[e]!)?.name ?? '' }));
  return banded.length ? banded.join(t('cutlist.separator')) : t('cutlist.edge.none');
}

/**
 * A part drawn small, its length across: a thick line on each banded edge,
 * the length edges along the top (1) and bottom (2), the width edges at the
 * start (1) and end (2). Labelled with the banding in words.
 */
export function edgeMarks(bands: Bands, scene: Scene, width = 36, height = 18): SVGSVGElement {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', `0 0 ${width} ${height}`);
  s.setAttribute('width', String(width));
  s.setAttribute('height', String(height));
  s.setAttribute('class', 'edge-marks');
  s.setAttribute('role', 'img');
  s.setAttribute('aria-label', bandsText(bands, scene));
  const line = (x1: number, y1: number, x2: number, y2: number, cls: string) => {
    const l = document.createElementNS(SVG, 'line');
    for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) l.setAttribute(k, String(v));
    l.setAttribute('class', cls);
    s.append(l);
  };
  const inset = 2;
  const [x0, y0, x1, y1] = [inset, inset, width - inset, height - inset];
  const sides: Record<(typeof EDGES)[number], [number, number, number, number]> = {
    length1: [x0, y0, x1, y0],
    length2: [x0, y1, x1, y1],
    width1: [x0, y0, x0, y1],
    width2: [x1, y0, x1, y1],
  };
  for (const e of EDGES) line(...sides[e], bands[e] ? 'edge-marks-band' : 'edge-marks-plain');
  return s;
}
