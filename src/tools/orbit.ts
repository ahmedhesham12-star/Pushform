import { t } from '../i18n';
import type { Tool } from './tool';

/** Left-drag orbits. Middle-drag (or right-drag) orbits with any tool (handled by the app). */
export function createOrbitTool(): Tool {
  return {
    id: 'orbit',
    cursor: 'grab',
    navigation: 'orbit',
    hint: () => t('status.orbit'),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => false,
    reset: () => false,
  };
}
