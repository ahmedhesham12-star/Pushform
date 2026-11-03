import { t, tCount, type MessageKey } from '../i18n';
import { formatNumber } from '../units';

/**
 * The status bar after Flip, so a flip that leaves a symmetric part looking
 * the same still shows it happened: along a lone group's or component's own
 * axis, as the menu said, and with the count when several items flipped.
 */
export function flipMessage(axis: 'red' | 'green' | 'blue', lone: 'group' | 'component' | null, count: number): string {
  const name = t(`flip.axis.${axis}` as MessageKey);
  const along = lone ? t(lone === 'group' ? 'flip.axis.group' : 'flip.axis.component', { axis: name }) : name;
  return count > 1 ? tCount('message.flippedCount', count, formatNumber(count), { axis: along }) : t('message.flipped', { axis: along });
}
