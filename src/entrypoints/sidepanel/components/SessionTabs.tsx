import { Fragment, type ComponentChildren, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { citationNumber, currentTabCitationNumber } from '@/shared/chat/citation';
import type { CurrentTab } from '@/shared/current-tab';
import { extractionFailureMessage } from '@/shared/extract/messages';
import { t, type MessageKey } from '@/shared/i18n';
import type { Pin, PinKind } from '@/shared/model';
import { findPinByUrl } from '@/shared/pins';
import {
  ChevronIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  GlobeIcon,
  OpenIcon,
  PinFilledIcon,
  PinIcon,
  PlayIcon,
  RefreshIcon,
  SpinnerIcon,
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

/** Stands in for a missing favicon, by type (redesign spec 5.2). */
const FALLBACK: Record<PinKind, () => JSX.Element> = {
  page: GlobeIcon,
  youtube: PlayIcon,
  pdf: FileIcon,
};

function domain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The 24 px tile with the page's favicon, or the fallback icon for its type.
 * Only web and data URLs are loaded; the request carries no referrer. A
 * favicon that fails to load shows the fallback.
 */
function Tile({ url, kind }: { url: string | null; kind: PinKind }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed || !/^(https?:|data:image\/)/i.test(url)) {
    const Fallback = FALLBACK[kind];
    return (
      <span class="tab-tile tab-tile-fallback" data-fallback={kind}>
        <Fallback />
      </span>
    );
  }
  return (
    <span class="tab-tile">
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
    </span>
  );
}

/**
 * The meta line (redesign spec 5.2): the citation number, if any, then the
 * parts separated by "·". The separators are decoration.
 */
function Meta({ number, parts }: { number: number | null; parts: ComponentChildren[] }) {
  const shown = parts.filter((part) => part !== null && part !== false && part !== '');
  return (
    <span class="tab-row-meta">
      {number !== null && <span class="citation-number">{number}</span>}
      {shown.map((part, i) => (
        // The parts are fixed per row, so their position is a stable key.
        <Fragment key={i}>
          {i > 0 && (
            <span class="meta-separator" aria-hidden="true">
              ·
            </span>
          )}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** Ready, extracting or failed, at the right of a pin row (redesign spec 5.2). */
function PinStatus({ pin }: { pin: Pin }) {
  if (pin.status === 'ready') {
    return (
      <span class="pin-status pin-status-ready">
        <span class="status-dot" aria-hidden="true" />
        <span class="visually-hidden">{t('pinStatusReady')}</span>
      </span>
    );
  }
  if (pin.status === 'extracting') {
    return (
      <span class="pin-status pin-status-extracting">
        <span class="spinner">
          <SpinnerIcon />
        </span>
        {t('pinStatusExtracting')}
      </span>
    );
  }
  return <span class="pin-status pin-status-failed">{t('pinStatusFailed')}</span>;
}

/**
 * A pinned page (spec 5.2 item 3, redesign spec 5.2): tile, title, the meta
 * line with its citation number, and the status, which the actions (open,
 * refresh while the tab is open, unpin) replace on hover and focus. A failed
 * pin shows its reason under the row.
 */
function PinRow({
  pin,
  number,
  isCurrent,
  open,
  onOpen,
  onRefresh,
  onUnpin,
}: {
  pin: Pin;
  number: number;
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
        <Tile url={pin.faviconUrl} kind={pin.kind} />
        <div class="tab-row-text">
          <span class="tab-row-title" title={pin.title}>
            {pin.title}
          </span>
          <Meta
            number={number}
            parts={[
              domain(pin.url) && <span class="tab-row-domain">{domain(pin.url)}</span>,
              <span class="tab-row-kind">{t(KIND[pin.kind])}</span>,
              isCurrent && <span class="tab-row-current">{t('currentTabMarker')}</span>,
              pin.truncated && pin.status === 'ready' && (
                <span class="pin-truncated">{t('pinTruncated')}</span>
              ),
            ]}
          />
        </div>
        <PinStatus pin={pin} />
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
 * The unpinned current tab (spec 5.2 item 3, D9; redesign spec 5.2): its own
 * card, with the number it will be cited with, the eye toggle and the Pin
 * button. A tab that can't be read says why and has neither.
 */
function CurrentTabRow({
  tab,
  number,
  excluded,
  onPin,
  onToggleExcluded,
  onOpenPageAccess,
}: {
  tab: Exclude<CurrentTab, { state: 'none' }>;
  number: number;
  excluded: boolean;
  onPin: () => void;
  onToggleExcluded: () => void;
  onOpenPageAccess: () => void;
}) {
  if (tab.state === 'noAccess') {
    // The URL is hidden, so no per-site request is possible (decisions.md
    // T06-4, T06-15): point to the two paths that work.
    return (
      <li class="tab-row current-row tab-row-unavailable" data-state="noAccess" data-current="">
        <div class="tab-row-main">
          <Tile url={null} kind="page" />
          <div class="tab-row-text">
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
          </div>
        </div>
      </li>
    );
  }
  if (tab.state === 'restricted') {
    return (
      <li class="tab-row current-row tab-row-unavailable" data-state="restricted" data-current="">
        <div class="tab-row-main">
          <Tile url={null} kind="page" />
          <div class="tab-row-text">
            <span class="tab-row-title">{t('pageCantBeRead')}</span>
            <Meta
              number={null}
              parts={[
                <span>{t('currentTabMarker')}</span>,
                tab.title && <span class="tab-row-domain">{tab.title}</span>,
              ]}
            />
          </div>
        </div>
      </li>
    );
  }
  return (
    <li
      class={excluded ? 'tab-row current-row tab-row-excluded' : 'tab-row current-row'}
      data-state="readable"
      data-current=""
    >
      <div class="tab-row-main">
        <Tile url={tab.faviconUrl} kind="page" />
        <div class="tab-row-text">
          <span class="tab-row-title" title={tab.title}>
            {tab.title}
          </span>
          <Meta
            number={excluded ? null : number}
            parts={[
              <span class="tab-row-current">{t('currentTabMarker')}</span>,
              domain(tab.url) && <span class="tab-row-domain">{domain(tab.url)}</span>,
              excluded && <span>{t('currentTabExcluded')}</span>,
            ]}
          />
        </div>
        <div class="current-row-actions">
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
            class="button pin-button"
            title={t('pinToSession')}
            aria-label={t('pinToSession')}
            onClick={onPin}
          >
            <PinIcon />
            {t('pinButton')}
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
 * citation numbers (`citation.ts`). The count covers every listed row.
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
          <span class="session-tabs-label">{t('sessionTabsLabel')}</span>{' '}
          <span class="count-pill">{count}</span>
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
            {pins.map((pin, i) => (
              <PinRow
                key={pin.id}
                pin={pin}
                number={citationNumber(i)}
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
                number={currentTabCitationNumber(pins.length)}
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
