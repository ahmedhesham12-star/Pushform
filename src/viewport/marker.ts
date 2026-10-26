import { t } from '../i18n';

export type MarkerKind =
  | 'end'
  | 'mid'
  | 'edge'
  | 'face'
  | 'ground'
  | 'plane'
  | 'axisX'
  | 'axisY'
  | 'axisZ'
  | 'guide'
  | 'guidePoint'
  | 'intersection';

const LABELS: Record<MarkerKind, (() => string) | null> = {
  end: () => t('snap.endpoint'),
  mid: () => t('snap.midpoint'),
  edge: () => t('snap.onEdge'),
  face: () => t('snap.onFace'),
  ground: null,
  plane: () => t('snap.onPlane'),
  axisX: () => t('snap.onRedAxis'),
  axisY: () => t('snap.onBlueAxis'),
  axisZ: () => t('snap.onGreenAxis'),
  guide: () => t('snap.onGuide'),
  guidePoint: () => t('snap.guidePoint'),
  intersection: () => t('snap.intersection'),
};

const COLORS: Record<MarkerKind, string> = {
  end: 'var(--end)',
  mid: 'var(--mid)',
  edge: 'var(--edge-snap)',
  face: 'var(--accent)',
  ground: 'var(--accent)',
  plane: 'var(--accent)',
  axisX: 'var(--axis-x)',
  axisY: 'var(--axis-y)',
  axisZ: 'var(--axis-z)',
  guide: 'var(--edge-snap)',
  guidePoint: 'var(--end)',
  intersection: 'var(--end)',
};

/** The inference marker drawn over the canvas at a snapped point. */
export class SnapMarker {
  readonly element: HTMLDivElement;
  private readonly dot: HTMLElement;
  private readonly label: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'snap-marker';
    this.dot = document.createElement('i');
    this.label = document.createElement('span');
    this.element.append(this.dot, this.label);
  }

  /** x and y are canvas pixel coordinates, which are physical, not logical. */
  show(x: number, y: number, kind: MarkerKind): void {
    this.element.style.display = 'block';
    this.element.style.transform = `translate(${x}px, ${y}px)`;
    this.dot.style.color = COLORS[kind];
    const text = LABELS[kind]?.() ?? '';
    this.label.textContent = text;
    this.label.style.display = text ? '' : 'none';
  }

  hide(): void {
    this.element.style.display = 'none';
  }
}
