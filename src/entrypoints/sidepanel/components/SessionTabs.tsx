import { useState } from 'preact/hooks';
import type { CurrentTab } from '@/shared/current-tab';
import { extractionFailureMessage } from '@/shared/extract/messages';
import { t, type MessageKey } from '@/shared/i18n';
import type { Pin, PinKind, PinStatus } from '@/shared/model';
import { findPinByUrl } from '@/shared/pins';
import {
  ChevronIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  OpenIcon,
  PinFilledIcon,
  PinIcon,
  RefreshIcon,
} from './icons';

interface Props {
  /** The session's pins in pin order. */
  pins: Pin[];
  currentTab: CurrentTab;
  /** The eye toggle excluded the current tab (D9). */
  currentTabExcluded: boolean;
  /** Whether a pinned page is open in a tab, so it can be refreshed (D3). */
  isOpen: (pin: Pin) => boolean;
  /** The pin that an "Already pinned" notice is about, if any (spec 5.4). */
  alreadyPinned: Pin | null;
  expanded: boolean;
  onToggle: () => void;
  onPinCurrent: () => void;
  onToggleExcluded: () => void;
  onOpen: (pin: Pin) => void;
  onRefresh: (pin: Pin) => void;
  onUnpin: (pin: Pin) => void;
  onDismissNotice: () => void;
  /** Opens the Page access section in settings. */
  onOpenPageAccess: () => void;
}

const KIND: Record<PinKind, MessageKey> = {
  page: 'kindPage',
  youtube: 'kindYoutube',
  pdf: 'kindPdf',
};

const STATUS: Record<PinStatus, MessageKey> = {
  extracting: 'pinStatusExtracting',
  ready: 'pinStatusReady',
  failed: 'pinStatusFailed',
};

function domain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The page's favicon, or a globe. Only web and data URLs are loaded; the
 * request carries no referrer. A favicon that fails to load shows the globe.
 */
function Favicon({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed || !/^(https?:|data:image\/)/i.test(url)) {
    return (
      <span class="favicon favicon-placeholder">
        <GlobeIcon />
      </span>
    );
  }
  return (
    <img
      class="favicon"
      src={url}
      alt=""
      width={16}
      height={16}
      referrerpolicy="no-referrer"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}

/**
 * A pinned page (spec 5.2 item 3): favicon, title, domain, kind badge,
 * status and "truncated"; open, refresh (tab open only) and unpin. A failed
 * pin shows its reason. The current tab, when pinned, carries the marker.
 */
function PinRow({
  pin,
  isCurrent,
  open,
  onOpen,
  onRefresh,
  onUnpin,
}: {
  pin: Pin;
  isCurrent: boolean;
  open: boolean;
  onOpen: () => void;
  onRefresh: () => void;
  onUnpin: () => void;
}) {
  return (
    <li
      class="tab-row pin-row"
      data-pin-id={pin.id}
      data-status={pin.status}
      data-current={isCurrent ? '' : undefined}
    >
      <div class="tab-row-main">
        <Favicon url={pin.faviconUrl} />
        <div class="tab-row-text">
          <span class="tab-row-title" title={pin.title}>
            {pin.title}
          </span>
          <span class="tab-row-meta">
            {isCurrent && <span class="badge">{t('currentTabMarker')}</span>}
            <span class="tab-row-domain">{domain(pin.url)}</span>
            <span class="badge badge-muted">{t(KIND[pin.kind])}</span>
            <span class={`pin-status pin-status-${pin.status}`}>{t(STATUS[pin.status])}</span>
            {pin.truncated && pin.status === 'ready' && (
              <span class="pin-truncated">{t('pinTruncated')}</span>
            )}
          </span>
        </div>
        <div class="tab-row-actions">
          <button
            type="button"
            class="icon-button"
            title={t('openPage')}
            aria-label={t('openPageNamed', pin.title)}
            onClick={onOpen}
          >
            <OpenIcon />
          </button>
          {open && (
            <button
              type="button"
              class="icon-button"
              title={t('refreshPin')}
              aria-label={t('refreshPinNamed', pin.title)}
              disabled={pin.status === 'extracting'}
              onClick={onRefresh}
            >
              <RefreshIcon />
            </button>
          )}
          <button
            type="button"
            class="icon-button unpin-button"
            title={t('unpin')}
            aria-label={t('unpinNamed', pin.title)}
            onClick={onUnpin}
          >
            <PinFilledIcon />
          </button>
        </div>
      </div>
      {pin.status === 'failed' && (
        <p class="tab-row-error">{extractionFailureMessage(pin.failureReason ?? '')}</p>
      )}
    </li>
  );
}

/**
 * The unpinned current tab (spec 5.2 item 3, D9): marked "Current tab",
 * with the outline needle that pins it and the eye toggle. A tab that can't
 * be read says why and has neither.
 */
function CurrentTabRow({
  tab,
  excluded,
  onPin,
  onToggleExcluded,
  onOpenPageAccess,
}: {
  tab: Exclude<CurrentTab, { state: 'none' }>;
  excluded: boolean;
  onPin: () => void;
  onToggleExcluded: () => void;
  onOpenPageAccess: () => void;
}) {
  if (tab.state === 'noAccess') {
    // The URL is hidden, so no per-site request is possible (decisions.md
    // T06-4, T06-15): point to the two paths that work.
    return (
      <li class="tab-row tab-row-unavailable" data-state="noAccess" data-current="">
        <span class="tab-row-title">{t('currentTabNotAccessible')}</span>
        <p class="tab-row-hint">
          {t('currentTabNoAccessHint')}{' '}
          <button
            id="page-access-link"
            type="button"
            class="link-button"
            onClick={onOpenPageAccess}
          >
            {t('accessBannerAllow')}
          </button>
        </p>
      </li>
    );
  }
  if (tab.state === 'restricted') {
    return (
      <li class="tab-row tab-row-unavailable" data-state="restricted" data-current="">
        <span class="tab-row-title">{t('pageCantBeRead')}</span>
        <span class="tab-row-meta">
          <span class="badge">{t('currentTabMarker')}</span>
          {tab.title}
        </span>
      </li>
    );
  }
  return (
    <li
      class={excluded ? 'tab-row tab-row-excluded' : 'tab-row'}
      data-state="readable"
      data-current=""
    >
      <div class="tab-row-main">
        <Favicon url={tab.faviconUrl} />
        <div class="tab-row-text">
          <span class="tab-row-title" title={tab.title}>
            {tab.title}
          </span>
          <span class="tab-row-meta">
            <span class="badge">{t('currentTabMarker')}</span>
            <span class="tab-row-domain">{domain(tab.url)}</span>
            {excluded && <span>{t('currentTabExcluded')}</span>}
          </span>
        </div>
        <div class="tab-row-actions">
          <button
            type="button"
            class="icon-button eye-button"
            title={t(excluded ? 'includeInQuestions' : 'excludeFromQuestions')}
            aria-label={t(excluded ? 'includeInQuestions' : 'excludeFromQuestions')}
            onClick={onToggleExcluded}
          >
            {excluded ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            type="button"
            class="icon-button needle-button"
            title={t('pinToSession')}
            aria-label={t('pinToSession')}
            onClick={onPin}
          >
            <PinIcon />
          </button>
        </div>
      </div>
    </li>
  );
}

/** The pin the readable current tab shows, if it is pinned (fragment ignored). */
export function pinnedCurrent(pins: readonly Pin[], tab: CurrentTab): Pin | undefined {
  return tab.state === 'readable' ? findPinByUrl(pins, tab.url) : undefined;
}

/**
 * Session tabs section (spec 5.2 item 3, D9): the pinned pages in pin order,
 * then the current tab unless it is pinned. Their order defines the
 * citation numbers. The count covers every listed row.
 */
export function SessionTabs(props: Props) {
  const { pins, currentTab, expanded } = props;
  const current = pinnedCurrent(pins, currentTab);
  const showCurrent = currentTab.state !== 'none' && !current;
  const count = pins.length + (showCurrent ? 1 : 0);
  const notice = props.alreadyPinned;
  return (
    <section class="session-tabs">
      <h2 class="session-tabs-heading">
        <button
          type="button"
          class="session-tabs-toggle"
          aria-expanded={expanded}
          aria-controls="session-tabs-body"
          onClick={props.onToggle}
        >
          <span class="chevron">
            <ChevronIcon />
          </span>
          {t('sessionTabsHeading', String(count))}
        </button>
      </h2>
      <div id="session-tabs-body" class="session-tabs-body" hidden={!expanded}>
        {notice && (
          <div class="tab-notice" role="status">
            <span class="tab-notice-text">{t('alreadyPinned')}</span>
            {props.isOpen(notice) && (
              <button
                type="button"
                class="link-button"
                onClick={() => {
                  props.onRefresh(notice);
                }}
              >
                {t('refreshPin')}
              </button>
            )}
            <button
              type="button"
              class="icon-button"
              title={t('dismissNotice')}
              aria-label={t('dismissNotice')}
              onClick={props.onDismissNotice}
            >
              <CloseIcon />
            </button>
          </div>
        )}
        {pins.length === 0 && <p class="muted">{t('sessionTabsEmpty')}</p>}
        {(pins.length > 0 || showCurrent) && (
          <ul class="tab-rows" aria-label={t('sessionTabsList')}>
            {pins.map((pin) => (
              <PinRow
                key={pin.id}
                pin={pin}
                isCurrent={pin.id === current?.id}
                open={props.isOpen(pin)}
                onOpen={() => {
                  props.onOpen(pin);
                }}
                onRefresh={() => {
                  props.onRefresh(pin);
                }}
                onUnpin={() => {
                  props.onUnpin(pin);
                }}
              />
            ))}
            {showCurrent && (
              <CurrentTabRow
                tab={currentTab}
                excluded={props.currentTabExcluded}
                onPin={props.onPinCurrent}
                onToggleExcluded={props.onToggleExcluded}
                onOpenPageAccess={props.onOpenPageAccess}
              />
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
