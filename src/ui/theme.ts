/** Light, Dark, or following the system's setting (the default); dark-grey is on trial (a grey view in the dark interface). */
export const THEMES = ['light', 'dark', 'dark-grey', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Show the interface and the 3D view in a theme. The stylesheet picks the
 * colors from data-theme, or from the system's setting when it is absent;
 * the viewport follows the stylesheet.
 */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
