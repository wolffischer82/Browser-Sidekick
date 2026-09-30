import { render } from 'preact';
import { App } from './App';
import { t } from '@/shared/i18n';

document.documentElement.lang = browser.i18n.getUILanguage();
document.title = t('extName');

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
