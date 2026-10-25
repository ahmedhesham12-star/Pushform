import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import './ui/styles.css';
import { App } from './app';
import { newDocument } from './commands';
import { applyLocaleToDocument, t } from './i18n';
import { loadAutosave } from './storage';

applyLocaleToDocument(document.documentElement);
document.title = t('app.title');

const app = new App(document.body, loadAutosave() ?? newDocument());

// Exposed for debugging and automated checks in development builds only.
if (import.meta.env.DEV) (window as unknown as { pushform: App }).pushform = app;
