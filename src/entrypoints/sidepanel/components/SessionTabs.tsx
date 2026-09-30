import type { CurrentTab } from '@/shared/current-tab';
import { t } from '@/shared/i18n';
import { ChevronIcon } from './icons';

interface Props {
  pinCount: number;
  currentTab: CurrentTab;
  expanded: boolean;
  onToggle: () => void;
}

function domain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The current-tab row (spec 5.2 item 3): title and domain when readable,
 * otherwise why it can't be read. T07 adds the pin needle and the eye toggle.
 */
function CurrentTabRow({ tab }: { tab: Exclude<CurrentTab, { state: 'none' }> }) {
  if (tab.state === 'noAccess') {
    return (
      <li class="tab-row tab-row-unavailable" data-state="noAccess">
        <span class="tab-row-title">{t('currentTabNotAccessible')}</span>
      </li>
    );
  }
  const readable = tab.state === 'readable';
  return (
    <li class={readable ? 'tab-row' : 'tab-row tab-row-unavailable'} data-state={tab.state}>
      <span class="tab-row-title">{readable ? tab.title : t('pageCantBeRead')}</span>
      <span class="tab-row-meta">
        <span class="badge">{t('currentTabMarker')}</span>
        {readable ? <span class="tab-row-domain">{domain(tab.url)}</span> : tab.title}
      </span>
    </li>
  );
}

/**
 * Session tabs section (spec 5.2 item 3, D9): the pinned pages (T07) and
 * the current tab. The count covers every listed row.
 */
export function SessionTabs({ pinCount, currentTab, expanded, onToggle }: Props) {
  const count = pinCount + (currentTab.state === 'none' ? 0 : 1);
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
        {pinCount === 0 && <p class="muted">{t('sessionTabsEmpty')}</p>}
        {currentTab.state !== 'none' && (
          <ul class="tab-rows" aria-label={t('currentTabMarker')}>
            <CurrentTabRow tab={currentTab} />
          </ul>
        )}
      </div>
    </section>
  );
}
