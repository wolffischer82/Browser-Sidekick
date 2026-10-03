import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/shared/i18n';
import type { ModelGroup } from '@/shared/providers';
import { ChevronDownIcon } from './icons';
import { useUpwardList } from './upward-list';

interface Props {
  groups: ModelGroup[];
  providerId: string | null;
  model: string | null;
  /** Label of the session's provider, for the button's accessible name. */
  providerLabel: string | null;
  onChoose: (providerId: string, model: string) => void;
}

interface Option {
  id: string;
  providerId: string;
  model: string;
}

/**
 * The session's model (spec 5.2 item 1, D15) in the composer's toolbar
 * (redesign spec 5.4): a pill that opens a listbox of every usable
 * provider's models, grouped by provider, upward from the composer. Arrow
 * keys, Home and End move, Enter or Space choose, Escape or Tab close.
 */
export function ModelMenu({ groups, providerId, model, providerLabel, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useUpwardList(open, buttonRef, listRef);

  const options: Option[] = groups.flatMap((group, g) =>
    group.models.map((m, i) => ({
      id: `model-option-${String(g)}-${String(i)}`,
      providerId: group.providerId,
      model: m,
    })),
  );
  const selectedIndex = options.findIndex((o) => o.providerId === providerId && o.model === model);

  const focusOption = (index: number) => {
    const option = options[Math.max(0, Math.min(options.length - 1, index))];
    if (option) document.getElementById(option.id)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusOption(selectedIndex === -1 ? 0 : selectedIndex);
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

  const choose = (option: Option) => {
    close(true);
    if (option.providerId !== providerId || option.model !== model) {
      onChoose(option.providerId, option.model);
    }
  };

  const onListKeyDown = (event: KeyboardEvent) => {
    const current = options.findIndex((o) => o.id === (event.target as HTMLElement).id);
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
        focusOption(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const option = options[current];
        if (option) choose(option);
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

  const name = model ?? t('noModel');
  const fullName = providerLabel && model ? `${providerLabel} · ${model}` : name;

  return (
    <div class="model-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        id="model-button"
        type="button"
        class="model-button"
        data-empty={model === null ? '' : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('modelMenuLabel', fullName)}
        title={t('modelMenuLabel', fullName)}
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
        {model !== null && <span class="model-dot" aria-hidden="true" />}
        <span class="model-button-text">{name}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <div
          ref={listRef}
          class="model-list"
          role="listbox"
          aria-label={t('model')}
          onKeyDown={onListKeyDown}
        >
          {groups.map((group, g) => (
            <div
              key={group.providerId}
              role="group"
              aria-labelledby={`model-group-${String(g)}`}
              class="model-group"
            >
              <div id={`model-group-${String(g)}`} class="model-group-label" role="presentation">
                {group.label}
              </div>
              {group.models.map((m, i) => {
                const id = `model-option-${String(g)}-${String(i)}`;
                const selected = group.providerId === providerId && m === model;
                return (
                  <div
                    key={id}
                    id={id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    class="model-option"
                    onClick={() => {
                      choose({ id, providerId: group.providerId, model: m });
                    }}
                  >
                    {m}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
