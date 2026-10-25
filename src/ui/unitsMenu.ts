import { t } from '../i18n';
import { formatNumber, isFractional, LENGTH_UNITS, precisionOptions, type LengthUnit, type UnitSettings } from '../units';
import { el } from './dom';

/** Unit and precision pickers for the current file. */
export class UnitsMenu {
  readonly element = el('div', 'units');
  private readonly unitSelect = el('select');
  private readonly precisionSelect = el('select');
  private current: UnitSettings | null = null;

  constructor(onChange: (unit: LengthUnit, precision: number | null) => void) {
    const label = el('span', undefined, t('units.label'));
    label.id = 'units-label';
    this.unitSelect.setAttribute('aria-labelledby', 'units-label');
    this.precisionSelect.setAttribute('aria-label', t('units.precisionLabel'));
    for (const u of LENGTH_UNITS) {
      const o = el('option', undefined, t(`units.name.${u}`));
      o.value = u;
      this.unitSelect.append(o);
    }
    this.unitSelect.addEventListener('change', () => onChange(this.unitSelect.value as LengthUnit, null));
    this.precisionSelect.addEventListener('change', () =>
      onChange(this.unitSelect.value as LengthUnit, Number(this.precisionSelect.value)),
    );
    this.element.append(label, this.unitSelect, this.precisionSelect);
  }

  /** Reflect the document's settings (after load, undo or a change). */
  sync(settings: UnitSettings): void {
    if (this.current?.unit === settings.unit && this.current.precision === settings.precision) return;
    const unitChanged = this.current?.unit !== settings.unit;
    this.current = { ...settings };
    this.unitSelect.value = settings.unit;
    if (unitChanged) {
      this.precisionSelect.replaceChildren(
        ...precisionOptions(settings.unit).map((p) => {
          const o = el('option', undefined, precisionLabel(settings.unit, p));
          o.value = String(p);
          return o;
        }),
      );
    }
    this.precisionSelect.value = String(settings.precision);
  }
}

/** "0.00" for decimal places, 1/16" for fraction denominators. */
function precisionLabel(unit: LengthUnit, precision: number): string {
  if (!isFractional(unit)) return formatNumber(0, precision);
  const one = formatNumber(1);
  const fraction = precision === 1 ? one : `${one}/${formatNumber(precision)}`;
  return fraction + t('units.symbol.in');
}
