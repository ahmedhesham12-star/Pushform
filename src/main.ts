import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import './ui/styles.css';
import { App } from './app';
import { newDocument } from './commands';
import { applyLocaleToDocument, browserRegion, t } from './i18n';
import { loadAutosave, loadFileState, loadViewSettings } from './storage';
import { applyTheme } from './ui/theme';

applyLocaleToDocument(document.documentElement);
applyTheme(document.documentElement, loadViewSettings().theme);
document.title = t('app.title');

// The autosave is the recovery copy: the model as it was, with the file name it had.
// Without one, an empty model for the workspace last chosen; the first run asks which.
void loadAutosave().then((recovered) => {
  const workspace = loadViewSettings().workspace;
  const app = new App(document.body, recovered ?? newDocument(workspace ?? 'general', browserRegion()), recovered ? loadFileState() : { name: null, unsaved: false });
  if (!recovered && !workspace) app.askFirstWorkspace();
  // Exposed for debugging and automated checks in development builds only.
  if (import.meta.env.DEV) (window as unknown as { pushform: App }).pushform = app;
});
