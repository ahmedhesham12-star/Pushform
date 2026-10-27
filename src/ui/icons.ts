/** Inline SVG icons. Pure geometry: no text, so nothing needs translating. */

const svg = (body: string, attrs = '') =>
  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ${attrs} aria-hidden="true">${body}</svg>`;

export const ICONS = {
  brand: svg(
    '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.5 7.5 12 12.2l8.5-4.7M12 12.2v9"/>',
    'stroke-width="1.7" stroke-linejoin="round"',
  ),
  select: svg('<path d="M6 3.5 18 11l-5.6 1.4L9.3 18z"/>', 'stroke-linejoin="round"'),
  line: svg(
    '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.4" fill="currentColor"/><circle cx="19" cy="5" r="1.4" fill="currentColor"/>',
    'stroke-linecap="round"',
  ),
  rectangle: svg(
    '<rect x="4" y="6.5" width="16" height="11"/><circle cx="4" cy="6.5" r="1.4" fill="currentColor"/><circle cx="20" cy="17.5" r="1.4" fill="currentColor"/>',
  ),
  circle: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><path d="M12 12h8"/>'),
  polygon: svg(
    '<path d="M12 4 19 8v8l-7 4-7-4V8z"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    'stroke-linejoin="round"',
  ),
  move: svg(
    '<path d="M12 3v18M3 12h18"/><path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    'stroke-linejoin="round" stroke-linecap="round"',
  ),
  rotate: svg(
    '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.5v3.7h-3.7"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    'stroke-linejoin="round" stroke-linecap="round"',
  ),
  pushPull: svg(
    '<path d="M4 15.5 9 13h11l-5 2.5z"/><path d="M4 15.5V20h11v-4.5M20 13v4.5L15 20"/><path d="M12 10.5V3M9 6l3-3 3 3"/>',
    'stroke-linejoin="round" stroke-linecap="round"',
  ),
  offset: svg('<rect x="3.5" y="5" width="17" height="14"/><rect x="7.5" y="9" width="9" height="6" stroke-dasharray="2 1.6"/>'),
  erase: svg(
    '<path d="M4 15.5 12.5 7l5.5 5.5-6.5 6.5H8z"/><path d="M8.5 11 14 16.5M13 19.5h7"/>',
    'stroke-linejoin="round" stroke-linecap="round"',
  ),
  tape: svg(
    '<rect x="3" y="6" width="12" height="12" rx="3"/><circle cx="9" cy="12" r="2.2"/><path d="M15 15.5h6v2.5h-6M18 15.5v1.2"/>',
    'stroke-linejoin="round"',
  ),
  protractor: svg(
    '<path d="M3.5 17.5a8.5 8.5 0 0 1 17 0z"/><path d="M12 17.5 17.5 9.5"/><circle cx="12" cy="17.5" r="1.3" fill="currentColor"/>',
    'stroke-linejoin="round" stroke-linecap="round"',
  ),
  dimension: svg(
    '<path d="M4 9v9M20 9v9M4 13.5h16"/><path d="m5.5 15 3-3M15.5 15l3-3"/><path d="M9 7.5h6" stroke-dasharray="1.6 1.4"/>',
    'stroke-linecap="round"',
  ),
  orbit: svg(
    '<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3a4 9 0 0 1 0 18"/><path d="m18.5 6.2 2 2.4-3 .6"/>',
    'stroke-linecap="round" stroke-linejoin="round"',
  ),
  pan: svg(
    '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
    'stroke-linecap="round" stroke-linejoin="round"',
  ),
} as const;

export type IconName = keyof typeof ICONS;
