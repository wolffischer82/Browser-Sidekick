import { render } from 'preact';
import { openRepository } from '@/shared/db/repository';
import { t } from '@/shared/i18n';
import { App } from './App';

document.documentElement.lang = browser.i18n.getUILanguage();
document.title = t('extName');

// The sidebar opens one repository for its lifetime (decisions.md T03).
const repository = openRepository();

const root = document.getElementById('app');
if (root) {
  render(<App repository={repository} />, root);
}
