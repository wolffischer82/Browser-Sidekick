import { useEffect, useRef, useState } from 'preact/hooks';
import { t, uiLanguage } from '@/shared/i18n';
import type { Session } from '@/shared/model';
import { formatRelativeTime } from '../relative-time';
import { CloseIcon, TrashIcon } from './icons';

export interface SessionSummary {
  session: Session;
  title: string;
  pinCount: number;
}

interface Props {
  sessions: SessionSummary[];
  activeId: string;
  now: number;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function pinCount(count: number): string {
  return count === 1 ? t('pinCountOne') : t('pinCountOther', String(count));
}

/**
 * Sessions drawer (spec 5.2 item 2), sliding over the sidebar. Rows are
 * sorted by last activity; each switches on click and can be deleted after a
 * confirmation. Escape closes the drawer (or cancels a pending delete).
 */
export function SessionsDrawer({ sessions, activeId, now, onSelect, onDelete, onClose }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Id of the element to focus once the next render is on screen. */
  const focusNext = useRef<string | null>('drawer-close');
  const locale = uiLanguage();

  useEffect(() => {
    if (!focusNext.current) return;
    // The target may not be rendered yet if state changed before this effect ran.
    const target = document.getElementById(focusNext.current);
    if (!target) return;
    target.focus();
    focusNext.current = null;
  });

  const confirm = (id: string | null, focusId: string) => {
    focusNext.current = focusId;
    setConfirming(id);
  };

  const cancelConfirm = (id: string) => {
    confirm(null, `delete-${id}`);
  };

  return (
    <div class="drawer-layer">
      <div class="drawer-backdrop" onClick={onClose} />
      <div
        class="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-heading"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          if (confirming) cancelConfirm(confirming);
          else onClose();
        }}
      >
        <div class="drawer-header">
          <h2 id="drawer-heading" class="drawer-heading">
            {t('sessions')}
          </h2>
          <button
            id="drawer-close"
            type="button"
            class="icon-button"
            aria-label={t('close')}
            title={t('close')}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <ul class="session-list">
          {sessions.map(({ session, title, pinCount: count }) => (
            <li key={session.id} class="session-row">
              {confirming === session.id ? (
                <div class="session-confirm" role="group" aria-label={title}>
                  <p class="session-confirm-title">{title}</p>
                  <p class="session-confirm-text">{t('deleteSessionConfirm')}</p>
                  <div class="session-confirm-actions">
                    <button
                      id="drawer-confirm-cancel"
                      type="button"
                      class="button"
                      onClick={() => {
                        cancelConfirm(session.id);
                      }}
                    >
                      {t('cancel')}
                    </button>
                    <button
                      type="button"
                      class="button button-danger"
                      onClick={() => {
                        confirm(null, 'drawer-close');
                        onDelete(session.id);
                      }}
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    class="session-item"
                    aria-current={session.id === activeId ? 'true' : undefined}
                    onClick={() => {
                      onSelect(session.id);
                    }}
                  >
                    <span class="session-item-title">{title}</span>
                    <span class="session-item-meta">
                      {formatRelativeTime(session.updatedAt, now, locale)} · {pinCount(count)}
                    </span>
                  </button>
                  <button
                    id={`delete-${session.id}`}
                    type="button"
                    class="icon-button"
                    aria-label={t('deleteSessionNamed', title)}
                    title={t('deleteSessionNamed', title)}
                    onClick={() => {
                      confirm(session.id, 'drawer-confirm-cancel');
                    }}
                  >
                    <TrashIcon />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
