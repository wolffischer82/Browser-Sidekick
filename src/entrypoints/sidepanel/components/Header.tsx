import type { ComponentChildren, Ref } from 'preact';
import { t } from '@/shared/i18n';
import { SlidersIcon, MenuIcon, PlusIcon } from './icons';
import { SessionTitle } from './SessionTitle';

interface Props {
  title: string;
  drawerOpen: boolean;
  drawerButtonRef: Ref<HTMLButtonElement>;
  onOpenDrawer: () => void;
  onRename: (title: string) => void;
  onNewSession: () => void;
  onOpenSettings: () => void;
  /** The session model dropdown (D15), shown after the title. */
  modelMenu?: ComponentChildren;
  /** The session's thinking level (specs/thinking-levels.md 4.1), next to the model. */
  thinkingMenu?: ComponentChildren;
}

/**
 * Sidebar header (spec 5.2 item 1): sessions drawer, title with inline
 * rename, the session model dropdown (D15) with the thinking level next to
 * it, New session and settings. In a narrow sidebar the thinking level sits
 * below the model instead of beside it (`style.css`).
 */
export function Header(props: Props) {
  const menus = [props.modelMenu, props.thinkingMenu].filter(Boolean).length;
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
      {menus > 0 && (
        <div class="header-menus" data-menus={menus}>
          {props.modelMenu}
          {props.thinkingMenu}
        </div>
      )}
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
        <SlidersIcon />
      </button>
    </header>
  );
}
