import { t } from '../i18n';
import { el } from './dom';

/** Getting-started note over the empty viewport. */
export class Intro {
  readonly element = el('div', 'intro');

  constructor() {
    this.element.append(el('p', undefined, t('intro.start')), el('p', undefined, t('intro.navigate')));
  }

  setVisible(visible: boolean): void {
    this.element.style.display = visible ? '' : 'none';
  }
}
