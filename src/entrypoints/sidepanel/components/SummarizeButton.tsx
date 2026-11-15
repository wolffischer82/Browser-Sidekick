import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/shared/i18n';
import { summaryLevelNameKey, type SummarizeState } from '@/shared/chat/summarize';
import { SUMMARY_LEVELS, type SummaryLevel } from '@/shared/model';
import { ChevronDownIcon, LinesIcon } from './icons';
import { useUpwardList } from './upward-list';

interface Props {
  /** Whether Summarize can be used, or why not. */
  state: SummarizeState;
  /** The remembered level (specs/summary-levels.md O3). */
  level: SummaryLevel;
  /** The main part: summarize at the remembered level. */
  onSummarize: () => void;
  /** A level picked in the menu: remember it and summarize at it. */
  onPickLevel: (level: SummaryLevel) => void;
}

/** Why Summarize is unavailable, as its tooltip. */
function reason(state: SummarizeState): string | null {
  switch (state.kind) {
    case 'ready':
      return null;
    case 'noProvider':
      return t('summarizeNoProvider');
    case 'noAccess':
      return t('summarizeNoAccess', state.providerLabel);
    case 'busy':
      return t('summarizeBusy');
    case 'nothing':
      return t('summarizeUnavailable');
  }
}

const nameOf = (level: SummaryLevel) => t(summaryLevelNameKey(level));
const itemId = (level: SummaryLevel) => `summary-level-${level}`;

/**
 * Summarize (spec 5.2 item 5) in the composer's toolbar (redesign spec 5.4)
 * as a split button (specs/summary-levels.md 4.2, O5, O6). The main part
 * summarizes at the remembered level and shows it as a muted suffix; the
 * arrow opens a menu of the levels upward, the remembered one checked, and
 * picking one summarizes at it. Keyboard handling follows the thinking-level
 * menu. While Summarize is unavailable both parts are `aria-disabled` rather
 * than `disabled`, so they stay focusable and share one tooltip saying why;
 * the tooltip is drawn by the page instead of a `title`, so it also shows on
 * keyboard focus (decisions.md T11). In a narrow panel only the icon shows;
 * the accessible name always carries the level (`style.css`).
 */
export function SummarizeButton({ state, level, onSummarize, onPickLevel }: Props) {
  const hint = reason(state);
  const unavailable = hint !== null;
  const [menuOpen, setOpen] = useState(false);
  // The menu can't be open while Summarize is unavailable (O6).
  const open = menuOpen && !unavailable;
  const arrowRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useUpwardList(open, arrowRef, listRef);

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  const focusItem = (index: number) => {
    const item = SUMMARY_LEVELS[Math.max(0, Math.min(SUMMARY_LEVELS.length - 1, index))];
    if (item !== undefined) document.getElementById(itemId(item))?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(SUMMARY_LEVELS.indexOf(level));
    const onPointerDown = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
    // Focus once per opening, not on every render.
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) arrowRef.current?.focus();
  };

  const pick = (item: SummaryLevel) => {
    close(true);
    onPickLevel(item);
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const current = SUMMARY_LEVELS.findIndex(
      (item) => itemId(item) === (event.target as HTMLElement).id,
    );
    switch (event.key) {
      case 'ArrowDown':
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        focusItem(current - 1);
        break;
      case 'Home':
        focusItem(0);
        break;
      case 'End':
        focusItem(SUMMARY_LEVELS.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const item = SUMMARY_LEVELS[current];
        if (item !== undefined) pick(item);
        break;
      }
      case 'Escape':
        // Keep the settings/drawer Escape handlers out of it.
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  const describedBy = unavailable ? 'summarize-hint' : undefined;

  return (
    <span class="tooltip-anchor summarize-anchor" ref={rootRef}>
      <button
        id="summarize-button"
        type="button"
        class="button summarize-button"
        aria-label={t('summarizeWithLevel', nameOf(level))}
        aria-disabled={unavailable}
        aria-describedby={describedBy}
        onClick={() => {
          if (!unavailable) onSummarize();
        }}
      >
        <LinesIcon />
        <span class="summarize-label">
          {t('summarize')}
          <span class="summarize-level">{nameOf(level)}</span>
        </span>
      </button>
      <button
        ref={arrowRef}
        id="summary-level-button"
        type="button"
        class="button summary-level-button"
        aria-label={t('summaryLevelMenu')}
        title={unavailable ? undefined : t('summaryLevelMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={unavailable}
        aria-describedby={describedBy}
        onClick={() => {
          if (!unavailable) setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (unavailable) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ChevronDownIcon />
      </button>
      {unavailable && (
        <span id="summarize-hint" class="tooltip" role="tooltip">
          {hint}
        </span>
      )}
      {open && (
        <div
          ref={listRef}
          class="model-list summary-level-list"
          role="menu"
          aria-label={t('summaryLevelMenu')}
          onKeyDown={onMenuKeyDown}
        >
          {SUMMARY_LEVELS.map((item) => (
            <div
              key={item}
              id={itemId(item)}
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={item === level}
              class="model-option"
              onClick={() => {
                pick(item);
              }}
            >
              {nameOf(item)}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
