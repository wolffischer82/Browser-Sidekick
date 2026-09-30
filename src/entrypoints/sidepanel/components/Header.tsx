import type { Ref } from 'preact';
import { t } from '@/shared/i18n';
import { GearIcon, MenuIcon, PlusIcon } from './icons';
import { SessionTitle } from './SessionTitle';

interface Props {
  title: string;
  drawerOpen: boolean;
  drawerButtonRef: Ref<HTMLButtonElement>;
  onOpenDrawer: () => void;
  onRename: (title: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
}

/**
 * Sidebar header (spec 5.2 item 1): sessions drawer, title with inline
 * rename, New session and settings. The session model dropdown (D15) is
 * added by T05.
 */
export function Header(props: Props) {
  return (
    <header class="header">
      <button
        ref={props.drawerButtonRef}
        type="button"
        class="icon-button"
        aria-label={t('sessions')}
        title={t('sessions')}
        aria-haspopup="dialog"
        aria-expanded={props.drawerOpen}
        onClick={props.onOpenDrawer}
      >
        <MenuIcon />
      </button>
      <div class="header-title">
        <SessionTitle title={props.title} onRename={props.onRename} />
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label={t('newSession')}
        title={t('newSession')}
        onClick={props.onNewSession}
      >
        <PlusIcon />
      </button>
      <button
        id="settings-button"
        type="button"
        class="icon-button"
        aria-label={t('settings')}
        title={t('settings')}
        onClick={props.onOpenSettings}
      >
        <GearIcon />
      </button>
    </header>
  );
}
