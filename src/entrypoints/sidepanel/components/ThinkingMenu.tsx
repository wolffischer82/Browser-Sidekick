import { useEffect, useRef, useState } from 'preact/hooks';
import { t, type MessageKey } from '@/shared/i18n';
import type { ThinkingLevel } from '@/shared/model';
import { THINKING_OPTIONS } from '@/shared/thinking';
import { ChevronDownIcon } from './icons';

interface Props {
  /** The session's level; `null` is Default. */
  level: ThinkingLevel | null;
  onChoose: (level: ThinkingLevel | null) => void;
}

const LABELS: Record<ThinkingLevel | 'default', MessageKey> = {
  default: 'thinkingDefault',
  low: 'thinkingLow',
  medium: 'thinkingMedium',
  high: 'thinkingHigh',
};

const labelOf = (level: ThinkingLevel | null) => t(LABELS[level ?? 'default']);
const optionId = (level: ThinkingLevel | null) => `thinking-option-${level ?? 'default'}`;

/**
 * The session's thinking level (specs/thinking-levels.md 4.1): a button
 * reading "Thinking: <level>" that opens a listbox of Default, Low, Medium
 * and High. It works like the model menu next to it: arrow keys, Home and
 * End move, Enter or Space choose, Escape or Tab close. The parent leaves it
 * out when the session's model is known not to take a level.
 */
export function ThinkingMenu({ level, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const focusOption = (index: number) => {
    const option = THINKING_OPTIONS[Math.max(0, Math.min(THINKING_OPTIONS.length - 1, index))];
    if (option !== undefined) document.getElementById(optionId(option))?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusOption(THINKING_OPTIONS.indexOf(level));
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
    if (refocus) buttonRef.current?.focus();
  };

  const choose = (option: ThinkingLevel | null) => {
    close(true);
    if (option !== level) onChoose(option);
  };

  const onListKeyDown = (event: KeyboardEvent) => {
    const current = THINKING_OPTIONS.findIndex(
      (o) => optionId(o) === (event.target as HTMLElement).id,
    );
    switch (event.key) {
      case 'ArrowDown':
        focusOption(current + 1);
        break;
      case 'ArrowUp':
        focusOption(current - 1);
        break;
      case 'Home':
        focusOption(0);
        break;
      case 'End':
        focusOption(THINKING_OPTIONS.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const option = THINKING_OPTIONS[current];
        if (option !== undefined) choose(option);
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

  const value = labelOf(level);

  return (
    <div class="thinking-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        id="thinking-button"
        type="button"
        class="model-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('thinkingMenuLabel', value)}
        title={t('thinkingMenuLabel', value)}
        onClick={() => {
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span class="model-button-text">{t('thinkingButton', value)}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div
          class="model-list thinking-list"
          role="listbox"
          aria-label={t('thinkingLevel')}
          onKeyDown={onListKeyDown}
        >
          {THINKING_OPTIONS.map((option) => (
            <div
              key={optionId(option)}
              id={optionId(option)}
              role="option"
              tabIndex={-1}
              aria-selected={option === level}
              class="model-option"
              onClick={() => {
                choose(option);
              }}
            >
              {labelOf(option)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
