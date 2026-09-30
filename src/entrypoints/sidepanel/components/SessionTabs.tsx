import { t } from '@/shared/i18n';
import { ChevronIcon } from './icons';

interface Props {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Session tabs section (spec 5.2 item 3, D9). T03 renders the collapsible
 * frame; the pinned rows and the current-tab row arrive with T07.
 */
export function SessionTabs({ count, expanded, onToggle }: Props) {
  return (
    <section class="session-tabs">
      <h2 class="session-tabs-heading">
        <button
          type="button"
          class="session-tabs-toggle"
          aria-expanded={expanded}
          aria-controls="session-tabs-body"
          onClick={onToggle}
        >
          <span class="chevron">
            <ChevronIcon />
          </span>
          {t('sessionTabsHeading', String(count))}
        </button>
      </h2>
      <div id="session-tabs-body" class="session-tabs-body" hidden={!expanded}>
        {count === 0 && <p class="muted">{t('sessionTabsEmpty')}</p>}
      </div>
    </section>
  );
}
