import { t } from '../i18n';
import type { Tool } from './tool';

/** Left-drag pans. Shift + right-drag pans with any tool (handled by the app). */
export function createPanTool(): Tool {
  return {
    id: 'pan',
    cursor: 'grab',
    navigation: 'pan',
    hint: () => t('status.pan'),
    measurementLabel: () => t('measure.dimensions'),
    busy: () => false,
    reset: () => false,
  };
}
