import type { Ref } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t, uiLanguage } from '@/shared/i18n';
import { formatRelativeTime } from '../relative-time';
import { SlidersIcon, MenuIcon } from './icons';
import { SessionTitle } from './SessionTitle';

interface Props {
  title: string;
  /** The session's pin count, for the subtitle. */
  pinCount: number;
  /** The session's last activity (`Session.updatedAt`, as the drawer sorts by). */
  updatedAt: number;
  drawerOpen: boolean;
  drawerButtonRef: Ref<HTMLButtonElement>;
  onOpenDrawer: () => void;
  onRename: (title: string) => void;
  onOpenSettings: () => void;
}

/** How often the subtitle's relative time is brought up to date, in ms. */
export const SUBTITLE_REFRESH_MS = 30_000;

/**
 * The subtitle (redesign spec 5.1): "4 pins · active 2 minutes ago", or
 * "No pins yet" for a session without pins.
 */
export function headerSubtitle(pinCount: number, updatedAt: number, now: number): string {
  if (pinCount === 0) return t('headerNoPins');
  const pins = pinCount === 1 ? t('pinCountOne') : t('pinCountOther', String(pinCount));
  const active = t('headerActive', formatRelativeTime(updatedAt, now, uiLanguage()));
  return `${pins} · ${active}`;
}

/**
 * Sidebar header (spec 5.2 item 1, redesign spec 5.1): sessions drawer,
 * title with inline rename and the subtitle below it, and settings. New
 * session lives in the composer (redesign spec O4). The subtitle sits outside the rename button, so it is not part
 * of its name, and is re-rendered twice a minute while shown.
 */
export function Header(props: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((n) => n + 1);
    }, SUBTITLE_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return (
    <header class="header">
      <button
        ref={props.drawerButtonRef}
        type="button"
        class="icon-button header-button"
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
        <p class="header-subtitle">{headerSubtitle(props.pinCount, props.updatedAt, Date.now())}</p>
      </div>
      <button
        id="settings-button"
        type="button"
        class="icon-button header-button"
        aria-label={t('settings')}
        title={t('settings')}
        onClick={props.onOpenSettings}
      >
        <SlidersIcon />
      </button>
    </header>
  );
}
